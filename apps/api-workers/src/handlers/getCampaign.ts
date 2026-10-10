import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { campaigns } from '../db/schema';
import type { Env } from '../types/env';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/campaigns/:id
 * Devuelve la campaña del tenant autenticado (incluye design_json para cargar
 * el editor en el cliente, §9.4). El user_id proviene del JWT (§12.2).
 */
export async function handleGetCampaign(
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
    return json({ error: { code: 'CAMPAIGN_NOT_FOUND', message: 'La campaña no existe.' } }, 404);
  }

  return json({ campaign }, 200);
}
