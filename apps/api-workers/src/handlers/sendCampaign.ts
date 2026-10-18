import { CampaignSendError, sendCampaign } from '../services/campaignSender';
import type { Env } from '../types/env';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/campaigns/:id/send
 *
 * Wrapper HTTP del motor de envío. La autenticación la resuelve el middleware;
 * este handler solo extrae el campaign_id del path y delega en el service
 * reutilizable `sendCampaign` (mismo flujo que el cron programado).
 */
export async function handleSendCampaign(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const campaignId = new URL(request.url).pathname.split('/')[3];

  try {
    const result = await sendCampaign(env, campaignId, userId, { mode: 'immediate' });
    return json({ message: 'Campaign processing started', enqueued: result.enqueued }, 202);
  } catch (err) {
    if (err instanceof CampaignSendError) {
      if (err.code === 'QUOTA_EXCEEDED') {
        return json(
          {
            error: 'QUOTA_EXCEEDED',
            quota: err.details?.quota ?? 0,
            used: err.details?.used ?? 0,
            message: err.message,
          },
          402
        );
      }

      if (err.code === 'SUBSCRIPTION_REQUIRED') {
        return json(
          {
            error: 'SUBSCRIPTION_REQUIRED',
            code: 'SUBSCRIPTION_REQUIRED',
            message: err.message,
          },
          402
        );
      }

      return json({ error: { code: err.code, message: err.message } }, err.status);
    }

    console.error('Error encolando campaña:', err);
    return json(
      { error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar el envío.' } },
      500
    );
  }
}
