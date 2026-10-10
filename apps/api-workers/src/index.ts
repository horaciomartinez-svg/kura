import type { MessageBatch } from '@cloudflare/workers-types';
import { handleGetAsset, handleUploadAsset } from './handlers/assets';
import { handleGetCampaign } from './handlers/getCampaign';
import { handleSendCampaign } from './handlers/sendCampaign';
import { handleAutosave, handleCompile, handleSaveDesign } from './handlers/saveDesign';
import { processEmailQueue } from './queues/emailConsumer';
import { processTrackingQueue } from './queues/trackingConsumer';
import tracker from './tracking';
import { authenticateRequest, isPublicPath } from './middleware/auth';
import type { Env } from './types/env';
import type { QueuePayload, TrackingPayload } from '@kura/core';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** Añade las cabeceras CORS (necesarias para el frontend en localhost:3000). */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  // Manejador de tráfico web (API + Edge Tracking).
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Preflight CORS.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Healthcheck público (§8.1).
    if (url.pathname === '/health') {
      return withCors(json({ status: 'ok' }, 200));
    }

    // Rutas públicas: Edge Tracker (opens/clicks/unsubscribe).
    if (url.pathname.startsWith('/o/') || url.pathname.startsWith('/c/')) {
      return withCors(await tracker.fetch(request, env, ctx));
    }

    // Assets: servido público del binario desde R2 (solo dev; en producción lo
    // hace el CDN, §12.5).
    if (request.method === 'GET' && url.pathname.startsWith('/api/assets/')) {
      return withCors(await handleGetAsset(request, env));
    }

    // TODO(webhooks): verificar firma SNS/Stripe antes de procesar (§11.2, §12.3).
    if (url.pathname.startsWith('/webhooks/')) {
      return withCors(new Response('Not Found', { status: 404 }));
    }

    // API protegida: exige JWT de Supabase salvo rutas públicas (§8.2, §12.1).
    if (url.pathname.startsWith('/api/') && !isPublicPath(url.pathname)) {
      const auth = await authenticateRequest(request, env);
      if (!auth.ok) return withCors(auth.response);
      const userId = auth.user.id;

      // Subida de imágenes del editor a R2 (§12.5).
      if (request.method === 'POST' && url.pathname === '/api/assets') {
        return withCors(await handleUploadAsset(request, env, userId));
      }

      // Detalle de campaña: carga del AST en el editor (§9.4).
      if (request.method === 'GET' && url.pathname.match(/^\/api\/campaigns\/[^/]+$/)) {
        return withCors(await handleGetCampaign(request, env, userId));
      }

      if (request.method === 'POST' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/send$/)) {
        return withCors(await handleSendCampaign(request, env, userId));
      }

      // Autosave del AST de Easy-Email (§9.4).
      if (request.method === 'PATCH' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/autosave$/)) {
        return withCors(await handleAutosave(request, env, userId));
      }

      // Guardado del AST + HTML compilado (§9.4).
      if (request.method === 'PUT' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/compile$/)) {
        return withCors(await handleCompile(request, env, userId));
      }

      if (request.method === 'PUT' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/design$/)) {
        return withCors(await handleSaveDesign(request, env, userId));
      }

      return withCors(new Response('Not Found', { status: 404 }));
    }

    return withCors(new Response('Not Found', { status: 404 }));
  },

  // Manejador de los suscriptores de cola (envíos y telemetría).
  async queue(
    batch: MessageBatch<QueuePayload | TrackingPayload>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    if (batch.queue === 'kura-tracking-queue') {
      await processTrackingQueue(batch as MessageBatch<TrackingPayload>, env);
      return;
    }

    await processEmailQueue(batch as MessageBatch<QueuePayload>, env);
  },
};
