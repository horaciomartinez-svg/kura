import type { Env } from '../types/env';
import type { TrackingPayload } from '@kura/core';

// Buffer binario estático: GIF transparente de 1x1 píxel.
const PIXEL = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0)
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';

    // Detección de AMPP y bots de seguridad (ej. Mimecast, Barracuda).
    const isMachineOpen = userAgent.includes('CFNetwork') || userAgent.includes('Barracuda');

    // 1. Rastreo de aperturas (Open Tracking).
    if (request.method === 'GET' && url.pathname.startsWith('/o/')) {
      const payload = url.pathname.replace('/o/', '').replace('.gif', '');

      ctx.waitUntil(logEvent(env, payload, 'open', undefined, isMachineOpen));

      return new Response(PIXEL, {
        status: 200,
        headers: {
          'Content-Type': 'image/gif',
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        },
      });
    }

    // 2. Rastreo de clics (Click Tracking).
    if (request.method === 'GET' && url.pathname.startsWith('/c/')) {
      const payload = url.pathname.replace('/c/', '');
      const decoded = JSON.parse(atob(payload)); // { cmp, cnt, url }

      ctx.waitUntil(logEvent(env, payload, 'click', decoded.url, false));

      return Response.redirect(decoded.url, 302);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// Despacho a Cloudflare Queues.
async function logEvent(
  env: Env,
  payloadBase64: string,
  type: TrackingPayload['event_type'],
  url?: string,
  isMachineOpen?: boolean
): Promise<void> {
  const decoded = JSON.parse(atob(payloadBase64));

  await env.TRACKING_QUEUE.send({
    campaign_id: decoded.cmp,
    contact_id: decoded.cnt,
    event_type: type,
    url_clicked: url || null,
    is_machine_open: isMachineOpen || false,
  });
}
