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

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Resuelve el origen permitido para CORS.
 *
 * - Producción (`ENVIRONMENT = 'production'`): solo el dominio oficial de
 *   `APP_ORIGIN` (p. ej. `https://app.kura.app`). Cualquier otro origen recibe
 *   ese valor en `Access-Control-Allow-Origin`, por lo que el navegador lo
 *   bloquea.
 * - Desarrollo / tests: se refleja cualquier puerto de `localhost` o
 *   `127.0.0.1` (p. ej. `http://localhost:3000`); si no hay origen local se cae
 *   a `*` para no bloquear herramientas locales.
 */
function resolveAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin') ?? '';
  const configured = (env.APP_ORIGIN ?? '').replace(/\/$/, '');

  if (env.ENVIRONMENT === 'production') {
    return configured || origin;
  }

  if (LOCALHOST_ORIGIN.test(origin)) return origin;
  if (configured && origin === configured) return origin;
  return configured || '*';
}

/** Cabeceras CORS que se aplican a TODA respuesta (éxito o error). */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowedOrigin = resolveAllowedOrigin(request, env);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '86400',
  };
  if (allowedOrigin !== '*') headers.Vary = 'Origin';
  return headers;
}

/**
 * Añade las cabeceras CORS a cualquier respuesta. Garantiza que las respuestas
 * de error (401 del middleware de auth, 404, 500 de excepciones) también las
 * incluyan, evitando que el navegador las reporte como fallo de CORS.
 */
function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(key, value);
  }
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

/** Enruta la petición. Toda respuesta se envuelve con CORS en `fetch`. */
async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  // Healthcheck público (§8.1).
  if (url.pathname === '/health') {
    return json({ status: 'ok' }, 200);
  }

  // Rutas públicas: Edge Tracker (opens/clicks/unsubscribe).
  if (url.pathname.startsWith('/o/') || url.pathname.startsWith('/c/')) {
    return tracker.fetch(request, env, ctx);
  }

  // Assets: servido público del binario desde R2 (solo dev; en producción lo
  // hace el CDN, §12.5).
  if (request.method === 'GET' && url.pathname.startsWith('/api/assets/')) {
    return handleGetAsset(request, env);
  }

  // TODO(webhooks): verificar firma SNS/Stripe antes de procesar (§11.2, §12.3).
  if (url.pathname.startsWith('/webhooks/')) {
    return new Response('Not Found', { status: 404 });
  }

  // API protegida: exige JWT de Supabase salvo rutas públicas (§8.2, §12.1).
  if (url.pathname.startsWith('/api/') && !isPublicPath(url.pathname)) {
    const auth = await authenticateRequest(request, env);
    if (!auth.ok) return auth.response;
    const userId = auth.user.id;

    // Subida de imágenes del editor a R2 (§12.5).
    if (request.method === 'POST' && url.pathname === '/api/assets') {
      return handleUploadAsset(request, env, userId);
    }

    // Detalle de campaña: carga del AST en el editor (§9.4).
    if (request.method === 'GET' && url.pathname.match(/^\/api\/campaigns\/[^/]+$/)) {
      return handleGetCampaign(request, env, userId);
    }

    if (request.method === 'POST' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/send$/)) {
      return handleSendCampaign(request, env, userId);
    }

    // Autosave del AST de Easy-Email (§9.4).
    if (request.method === 'PATCH' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/autosave$/)) {
      return handleAutosave(request, env, userId);
    }

    // Guardado del AST + HTML compilado (§9.4).
    if (request.method === 'PUT' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/compile$/)) {
      return handleCompile(request, env, userId);
    }

    if (request.method === 'PUT' && url.pathname.match(/^\/api\/campaigns\/[^/]+\/design$/)) {
      return handleSaveDesign(request, env, userId);
    }

    return new Response('Not Found', { status: 404 });
  }

  return new Response('Not Found', { status: 404 });
}

export default {
  // Manejador de tráfico web (API + Edge Tracking).
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Preflight CORS: 204 con cabeceras para cualquier ruta.
      if (request.method === 'OPTIONS') {
        return withCors(new Response(null, { status: 204 }), request, env);
      }

      const response = await route(request, env, ctx);
      return withCors(response, request, env);
    } catch (err) {
      // Una excepción no controlada también debe responder con CORS; de lo
      // contrario el navegador la reporta como error de CORS en lugar de 500.
      console.error('Error no controlado en el Worker:', err);
      return withCors(
        json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' } }, 500),
        request,
        env
      );
    }
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
