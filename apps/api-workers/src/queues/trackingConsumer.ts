import type { MessageBatch } from '@cloudflare/workers-types';
import type { TrackingPayload } from '@kura/core';
import { getDb } from '../db/client';
import { campaignEvents } from '../db/schema';
import type { Env } from '../types/env';

/**
 * Consumidor de telemetría: retira eventos de la cola en lotes y ejecuta un
 * INSERT masivo parametrizado vía Drizzle (§11.3). No se interpola SQL con
 * datos de la cola.
 */
export async function processTrackingQueue(
  batch: MessageBatch<TrackingPayload>,
  env: Env
): Promise<void> {
  if (batch.messages.length === 0) {
    batch.ackAll();
    return;
  }

  const db = getDb(env);

  const rows = batch.messages.map((message) => ({
    campaignId: message.body.campaign_id,
    contactId: message.body.contact_id,
    eventType: message.body.event_type,
    urlClicked: message.body.url_clicked,
    isMachineOpen: message.body.is_machine_open,
  }));

  try {
    await db.insert(campaignEvents).values(rows);
    console.log(`Eventos de tracking insertados: ${rows.length}`);
    // Confirmar a la cola solo tras el éxito del INSERT.
    batch.ackAll();
  } catch (error) {
    console.error('Error insertando eventos de tracking:', error);
    batch.retryAll();
  }
}
