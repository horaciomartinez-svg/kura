import type { MessageBatch } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import type { TrackingPayload } from '@kura/core';
import { getDb } from '../db/client';
import type { Database } from '../db/client';
import { campaignEvents, contacts, suppressionList } from '../db/schema';
import type { Env } from '../types/env';

/**
 * Consumidor de telemetría: retira eventos de la cola en lotes y ejecuta un
 * INSERT masivo parametrizado vía Drizzle (§11.3). No se interpola SQL con
 * datos de la cola. Para rebotes y quejas aplica además los efectos colaterales
 * de entregabilidad (§11.2).
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
    sesMessageId: message.body.ses_message_id ?? null,
  }));

  try {
    await db.insert(campaignEvents).values(rows);

    // Efectos de entregabilidad para rebotes y quejas (idempotentes).
    for (const message of batch.messages) {
      await applyDeliverabilityEvent(db, message.body);
    }

    console.log(`Eventos de tracking insertados: ${rows.length}`);
    // Confirmar a la cola solo tras el éxito del INSERT.
    batch.ackAll();
  } catch (error) {
    console.error('Error insertando eventos de tracking:', error);
    batch.retryAll();
  }
}

/**
 * Aplica los efectos de un rebote o una queja sobre el contacto (§11.2):
 * actualiza `contacts.status` y lo añade a la `suppression_list`.
 *
 * TODO(deliverabilidad): por ahora TODO bounce se trata como permanente.
 * Refinar la clasificación permanent vs. transient (3 transitorios) según §11.2.
 */
async function applyDeliverabilityEvent(db: Database, body: TrackingPayload): Promise<void> {
  const isBounce = body.event_type === 'bounce';
  const isComplaint = body.event_type === 'complaint';
  if (!isBounce && !isComplaint) return;

  const [contact] = await db
    .select({ id: contacts.id, userId: contacts.userId, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, body.contact_id))
    .limit(1);

  if (!contact) return;

  await db
    .update(contacts)
    .set({ status: isBounce ? 'bounced' : 'complained' })
    .where(eq(contacts.id, contact.id));

  await db
    .insert(suppressionList)
    .values({
      userId: contact.userId,
      email: contact.email,
      reason: isBounce ? 'bounce' : 'complaint',
      sourceCampaignId: body.campaign_id,
    })
    .onConflictDoNothing({ target: [suppressionList.userId, suppressionList.email] });
}
