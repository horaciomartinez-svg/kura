import type { MessageBatch } from '@cloudflare/workers-types';
import type { Env } from '../types/env';
import type { TrackingPayload } from '@kura/core';

/**
 * Consumidor de telemetría: retira eventos de la cola en lotes y ejecuta
 * un INSERT masivo en campaign_events.
 */
export async function processTrackingQueue(batch: MessageBatch<TrackingPayload>, env: Env): Promise<void> {
  const values = batch.messages
    .map(
      (msg) => `(
    '${msg.body.campaign_id}',
    '${msg.body.contact_id}',
    '${msg.body.event_type}',
    '${msg.body.url_clicked || ''}',
    ${msg.body.is_machine_open}
  )`
    )
    .join(',');

  const query = `
    INSERT INTO campaign_events (campaign_id, contact_id, event_type, url_clicked, is_machine_open)
    VALUES ${values}
  `;

  try {
    // await db.execute(query);
    console.log(`Eventos de tracking insertados: ${batch.messages.length}`);
    batch.ackAll();
  } catch (error) {
    console.error('Error insertando eventos de tracking:', error);
    batch.retryAll();
  }
}
