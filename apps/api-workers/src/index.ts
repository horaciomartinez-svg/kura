import type { MessageBatch } from '@cloudflare/workers-types';
import { handleSendCampaign } from './handlers/sendCampaign';
import { handleAutosave, handleCompile, handleSaveDesign } from './handlers/saveDesign';
import { processEmailQueue } from './queues/emailConsumer';
import { processTrackingQueue } from './queues/trackingConsumer';
import tracker from './tracking';
import type { Env } from './types/env';
import type { QueuePayload, TrackingPayload } from '@kura/core';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

export default {
  // Manejador de tráfico web (API + Edge Tracking).
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Preflight CORS.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/send$/)) {
      return withCors(await handleSendCampaign(request, env));
    }

    // Autosave del AST de Easy-Email (§9.4).
    if (request.method === 'PATCH' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/autosave$/)) {
      return withCors(await handleAutosave(request, env));
    }

    // Guardado del AST + HTML compilado (§9.4).
    if (request.method === 'PUT' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/compile$/)) {
      return withCors(await handleCompile(request, env));
    }

    // @deprecated Ruta del builder propio (pre-Easy-Email).
    if (request.method === 'PUT' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/design$/)) {
      return withCors(await handleSaveDesign(request, env));
    }

    if (url.pathname.startsWith('/o/') || url.pathname.startsWith('/c/')) {
      return withCors(await tracker.fetch(request, env, ctx));
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
