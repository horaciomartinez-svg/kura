import { and, eq } from 'drizzle-orm';
import type { QueuePayload } from '@kura/core';
import { getDb } from '../db/client';
import { campaigns, contacts, listMemberships, users } from '../db/schema';
import { assertCampaignCompliance, ComplianceError } from '../services/compliance';
import type { Env } from '../types/env';

const DB_PAGE_SIZE = 500; // Lotes de lectura de contactos (§10.1)
const QUEUE_BATCH_SIZE = 100; // sendBatch admite hasta 100 mensajes por llamada

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

/**
 * Productor: valida la campaña, el trial y el cumplimiento, y encola los
 * envíos en lotes de 500 contactos activos sin bloquear la respuesta (§10.1).
 */
export async function handleSendCampaign(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const url = new URL(request.url);
  const campaignId = url.pathname.split('/')[3];

  // El user_id proviene del JWT verificado en el middleware (§12.2); nunca del
  // cuerpo del cliente. Todas las consultas filtran por user_id (tenant).
  const db = getDb(env);

  try {
    // 1. Campaña existente, del tenant y en estado borrador.
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
      .limit(1);

    if (!campaign) {
      return error('CAMPAIGN_NOT_FOUND', 'La campaña no existe.', 404);
    }

    if (campaign.status !== 'draft') {
      return error('INVALID_STATUS', 'Solo se pueden enviar campañas en estado borrador.', 400);
    }

    // 2. Usuario y límites del trial.
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return error('USER_NOT_FOUND', 'El usuario de la campaña no existe.', 404);
    }

    const maxTrialSends = Number(env.MAX_TRIAL_SENDS ?? 50);
    if ((user.trialSendsCount ?? 0) >= maxTrialSends) {
      return error('TRIAL_EXHAUSTED', 'Se agotó el límite de envíos del plan de prueba.', 402);
    }

    if (user.trialExpiresAt && new Date(user.trialExpiresAt).getTime() < Date.now()) {
      return error('TRIAL_EXPIRED', 'El periodo de prueba expiró.', 402);
    }

    // 3. Cumplimiento anti-spam (el HTML debe existir y ser enviable).
    try {
      assertCampaignCompliance(campaign.htmlContent);
    } catch (err) {
      if (err instanceof ComplianceError) return error(err.code, err.message, 422);
      throw err;
    }

    const listId = campaign.listId;
    if (!listId) {
      return error('SEGMENT_NOT_SUPPORTED', 'El envío por segmentos aún no está disponible.', 400);
    }

    // 4. Contactos activos de la lista, paginados de 500 en 500.
    const basePayload = {
      campaignId,
      fromEmail: campaign.fromEmail,
      designJson: campaign.designJson,
    };

    let enqueued = 0;

    for (let offset = 0; ; offset += DB_PAGE_SIZE) {
      const rows = await db
        .select({
          id: contacts.id,
          email: contacts.email,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
        })
        .from(contacts)
        .innerJoin(listMemberships, eq(listMemberships.contactId, contacts.id))
        .where(
          and(
            eq(listMemberships.listId, listId),
            eq(contacts.userId, userId),
            eq(contacts.status, 'active')
          )
        )
        .limit(DB_PAGE_SIZE)
        .offset(offset);

      if (rows.length === 0) break;

      const messages = rows.map((contact) => ({
        body: {
          ...basePayload,
          contactId: contact.id,
          contactEmail: contact.email,
          contactVars: {
            nombre: contact.firstName ?? '',
            apellido: contact.lastName ?? '',
            email: contact.email,
          },
        } as QueuePayload,
      }));

      // Cloudflare Queues limita sendBatch a 100 mensajes por llamada.
      for (let i = 0; i < messages.length; i += QUEUE_BATCH_SIZE) {
        await env.SENDING_QUEUE.sendBatch(messages.slice(i, i + QUEUE_BATCH_SIZE));
      }

      enqueued += rows.length;
      if (rows.length < DB_PAGE_SIZE) break;
    }

    // 5. Marcar la campaña como en envío.
    await db
      .update(campaigns)
      .set({
        status: 'sending',
        startedAt: new Date(),
        totalRecipients: enqueued,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaignId));

    return json({ message: 'Campaign processing started', enqueued }, 202);
  } catch (err) {
    console.error('Error encolando campaña:', err);
    return error('INTERNAL_ERROR', 'No se pudo iniciar el envío.', 500);
  }
}
