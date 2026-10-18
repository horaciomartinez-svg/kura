import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { campaigns, users } from '../db/schema';
import { resolveEffectivePlan } from '../services/billing';
import { assertCampaignCompliance, ComplianceError } from '../services/compliance';
import type { Env } from '../types/env';

const MIN_SCHEDULE_AHEAD_MS = 2 * 60 * 1000; // 2 minutos

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function invalidScheduleTime(): Response {
  return error(
    'INVALID_SCHEDULE_TIME',
    'La fecha programada debe ser válida y estar al menos 2 minutos en el futuro.',
    400
  );
}

function subscriptionRequired(): Response {
  return json(
    {
      error: 'SUBSCRIPTION_REQUIRED',
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Tu periodo de prueba expiró. Actualiza a un plan para programar envíos.',
    },
    402
  );
}

/**
 * POST /api/campaigns/:id/schedule
 * Body: { scheduled_at: string ISO 8601 UTC }
 */
export async function handleScheduleCampaign(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const campaignId = new URL(request.url).pathname.split('/')[3];

  let body: { scheduled_at?: unknown };
  try {
    body = (await request.json()) as { scheduled_at?: unknown };
  } catch {
    return error('INVALID_PAYLOAD', 'JSON inválido.', 400);
  }

  if (typeof body.scheduled_at !== 'string') {
    return invalidScheduleTime();
  }

  const scheduledAt = new Date(body.scheduled_at);
  if (
    Number.isNaN(scheduledAt.getTime()) ||
    scheduledAt.getTime() < Date.now() + MIN_SCHEDULE_AHEAD_MS
  ) {
    return invalidScheduleTime();
  }

  const db = getDb(env);
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
    .limit(1);

  if (!campaign) {
    return error('CAMPAIGN_NOT_FOUND', 'La campaña no existe.', 404);
  }

  if (!campaign.htmlContent) {
    return error(
      'HTML_NOT_COMPILED',
      'La campaña debe tener el HTML compilado antes de programarse.',
      400
    );
  }

  try {
    assertCampaignCompliance(campaign.htmlContent);
  } catch (err) {
    if (err instanceof ComplianceError) return error(err.code, err.message, 422);
    throw err;
  }

  if (campaign.status !== 'draft' && campaign.status !== 'canceled') {
    return error(
      'INVALID_STATUS',
      'Solo se pueden programar campañas en estado borrador o canceladas.',
      409
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return error('USER_NOT_FOUND', 'El usuario de la campaña no existe.', 404);
  }

  const effectivePlan = await resolveEffectivePlan(db, user);
  if (effectivePlan.plan === 'expired') {
    return subscriptionRequired();
  }

  const [updated] = await db
    .update(campaigns)
    .set({
      status: 'scheduled',
      scheduledAt,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
    .returning();

  if (!updated) {
    return error('INVALID_STATUS', 'La campaña cambió de estado; intenta nuevamente.', 409);
  }

  return json({ campaign: updated }, 200);
}

/**
 * POST /api/campaigns/:id/cancel-schedule
 * Devuelve una campaña programada a borrador y limpia `scheduled_at`.
 */
export async function handleCancelCampaignSchedule(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const campaignId = new URL(request.url).pathname.split('/')[3];
  const db = getDb(env);

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
    .limit(1);

  if (!campaign) {
    return error('CAMPAIGN_NOT_FOUND', 'La campaña no existe.', 404);
  }

  if (campaign.status !== 'scheduled') {
    return error(
      'INVALID_STATUS',
      'Solo se puede cancelar la programación de una campaña programada.',
      409
    );
  }

  const [updated] = await db
    .update(campaigns)
    .set({
      status: 'draft',
      scheduledAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.userId, userId),
        eq(campaigns.status, 'scheduled')
      )
    )
    .returning();

  if (!updated) {
    return error('INVALID_STATUS', 'La campaña cambió de estado; intenta nuevamente.', 409);
  }

  return json({ campaign: updated }, 200);
}
