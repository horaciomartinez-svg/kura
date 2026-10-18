import { and, asc, eq, lte } from 'drizzle-orm';
import { getDb } from '../db/client';
import { campaigns } from '../db/schema';
import { sendCampaign } from './campaignSender';
import type { Env } from '../types/env';

const BATCH_SIZE = 10;

/**
 * Dispatcher de campañas programadas (§8.4).
 *
 * Se ejecuta cada minuto. Reclama de forma atómica hasta 10 campañas vencidas
 * (`status='scheduled' AND scheduled_at <= now()`) y delega el envío real al
 * service reutilizable. Un fallo individual queda registrado en `last_error`
 * y no aborta las demás campañas.
 */
export async function dispatchScheduledCampaigns(
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  let db: ReturnType<typeof getDb>;

  try {
    db = getDb(env);
  } catch (err) {
    console.error('[cron] No se pudo crear el cliente de base de datos:', err);
    return;
  }

  let due: Array<{ id: string; userId: string; scheduledAt: Date | null }>;

  try {
    due = await db
      .select({
        id: campaigns.id,
        userId: campaigns.userId,
        scheduledAt: campaigns.scheduledAt,
      })
      .from(campaigns)
      .where(
        and(eq(campaigns.status, 'scheduled'), lte(campaigns.scheduledAt, new Date()))
      )
      .orderBy(asc(campaigns.scheduledAt))
      .limit(BATCH_SIZE);
  } catch (err) {
    console.error('[cron] Error consultando campañas programadas:', err);
    return;
  }

  if (due.length === 0) {
    console.log('[cron] Sin campañas programadas vencidas.');
    return;
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const tasks = due.map(async (campaign) => {
    try {
      // Claim atómico: solo un proceso puede pasar de scheduled -> sending.
      const claimed = await db
        .update(campaigns)
        .set({
          status: 'sending',
          startedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'scheduled')))
        .returning({ id: campaigns.id });

      if (claimed.length === 0) {
        skipped += 1;
        return;
      }

      try {
        const result = await sendCampaign(env, campaign.id, campaign.userId, {
          mode: 'scheduled',
        });
        sent += 1;
        console.log(
          `[cron] Campaña ${campaign.id} enviada: ${result.enqueued} mensajes encolados.`
        );
      } catch (err) {
        failed += 1;
        console.error(`[cron] Campaña ${campaign.id} falló:`, err);
      }
    } catch (err) {
      failed += 1;
      console.error(`[cron] No se pudo reclamar la campaña ${campaign.id}:`, err);
    }
  });

  // Extiende la vida del Worker hasta terminar y emite el resumen de la corrida.
  const run = Promise.all(tasks).then(() => {
    console.log(
      `[cron] Resumen: procesadas=${due.length} enviadas=${sent} fallidas=${failed} omitidas=${skipped}`
    );
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(run);
  }

  // Se espera también aquí para que la corrida sea determinista (tests y logs).
  await run;
}
