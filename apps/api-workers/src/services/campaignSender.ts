import { and, eq, isNull, sql } from 'drizzle-orm';
import type { QueuePayload } from '@kura/core';
import { getDb } from '../db/client';
import {
  campaigns,
  contacts,
  listMemberships,
  lists,
  suppressionList,
  users,
} from '../db/schema';
import {
  currentPeriodStart,
  getUsage,
  incrementUsage,
  resolveEffectivePlan,
} from './billing';
import { assertCampaignCompliance, ComplianceError } from './compliance';
import type { Env } from '../types/env';

const DB_PAGE_SIZE = 500; // Lotes de lectura de contactos (§10.1)
const QUEUE_BATCH_SIZE = 100; // sendBatch admite hasta 100 mensajes por llamada

export type CampaignSendMode = 'immediate' | 'scheduled';

export interface CampaignSendResult {
  enqueued: number;
}

export class CampaignSendError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: { quota?: number; used?: number }
  ) {
    super(message);
    this.name = 'CampaignSendError';
  }
}

function asSendError(err: unknown): CampaignSendError {
  if (err instanceof CampaignSendError) return err;
  if (err instanceof ComplianceError) {
    return new CampaignSendError(err.code, err.message, 422);
  }
  return new CampaignSendError(
    'INTERNAL_ERROR',
    'No se pudo iniciar el envío.',
    500
  );
}

async function markCampaignFailed(
  db: ReturnType<typeof getDb>,
  campaignId: string,
  message: string
): Promise<void> {
  try {
    await db
      .update(campaigns)
      .set({
        status: 'failed',
        lastError: message.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'sending')));
  } catch (err) {
    console.error(`No se pudo marcar la campaña ${campaignId} como failed:`, err);
  }
}

/**
 * Núcleo reutilizable del motor de envío (§10.1, §12.2, §12.3).
 *
 * - `mode: 'immediate'`: exige una campaña en `draft` (POST /send).
 * - `mode: 'scheduled'`: exige una campaña ya reclamada por el cron en
 *   `sending`; si falla la revalidación de plan/cuota, la marca `failed`.
 *
 * En ambos casos revalida plan, cuota, compliance y suppression_list antes de
 * encolar. Devuelve cuántos mensajes se encolaron.
 */
export async function sendCampaign(
  env: Env,
  campaignId: string,
  userId: string,
  options: { mode?: CampaignSendMode } = {}
): Promise<CampaignSendResult> {
  const mode = options.mode ?? 'immediate';
  const db = getDb(env);

  try {
    // 1. Campaña existente y del tenant.
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
      .limit(1);

    if (!campaign) {
      throw new CampaignSendError('CAMPAIGN_NOT_FOUND', 'La campaña no existe.', 404);
    }

    const allowedStatuses = mode === 'scheduled' ? ['sending'] : ['draft'];
    if (!allowedStatuses.includes(campaign.status ?? '')) {
      throw new CampaignSendError(
        'INVALID_STATUS',
        mode === 'scheduled'
          ? 'La campaña no está lista para ser enviada por el programador.'
          : 'Solo se pueden enviar campañas en estado borrador.',
        400
      );
    }

    // 2. Plan efectivo del usuario y uso del periodo actual (§12.3).
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new CampaignSendError(
        'USER_NOT_FOUND',
        'El usuario de la campaña no existe.',
        404
      );
    }

    const effectivePlan = await resolveEffectivePlan(db, user);
    if (effectivePlan.plan === 'expired') {
      throw new CampaignSendError(
        'SUBSCRIPTION_REQUIRED',
        'Tu periodo de prueba expiró. Actualiza a un plan para seguir enviando.',
        402
      );
    }

    const periodStart = currentPeriodStart();
    const used = await getUsage(db, userId, periodStart);

    // 3. Cumplimiento anti-spam (§9.5).
    assertCampaignCompliance(campaign.htmlContent);

    // 4. Destinatarios elegibles (activos y no suprimidos) antes de encolar.
    //    - list_id NULL: todos los contactos del tenant.
    //    - list_id con valor: solo miembros de esa lista (validando tenant).
    const listId = campaign.listId;

    if (listId) {
      const [list] = await db
        .select({ id: lists.id })
        .from(lists)
        .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
        .limit(1);

      if (!list) {
        throw new CampaignSendError(
          'LIST_NOT_FOUND',
          'La lista no existe o no pertenece al usuario.',
          404
        );
      }
    }

    const suppressionJoin = and(
      eq(suppressionList.userId, userId),
      eq(suppressionList.email, contacts.email)
    );
    const baseFilter = and(
      eq(contacts.userId, userId),
      eq(contacts.status, 'active'),
      isNull(suppressionList.id)
    );
    const recipientsFilter = listId
      ? and(baseFilter, eq(listMemberships.listId, listId))
      : baseFilter;

    const countRow = listId
      ? (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(contacts)
            .innerJoin(listMemberships, eq(listMemberships.contactId, contacts.id))
            .leftJoin(suppressionList, suppressionJoin)
            .where(recipientsFilter)
        )[0]
      : (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(contacts)
            .leftJoin(suppressionList, suppressionJoin)
            .where(recipientsFilter)
        )[0];

    const recipients = Number(countRow?.count ?? 0);

    // Enforcement antes de encolar: uso del periodo + destinatarios ≤ cuota.
    if (used + recipients > effectivePlan.quota) {
      throw new CampaignSendError(
        'QUOTA_EXCEEDED',
        `La cuota mensual de tu plan es de ${effectivePlan.quota} correos y ya usaste ${used}.`,
        402,
        { quota: effectivePlan.quota, used }
      );
    }

    // 5. Contactos activos de la lista, paginados de 500 en 500.
    const basePayload = {
      campaignId,
      fromEmail: campaign.fromEmail,
      designJson: campaign.designJson,
    };

    let enqueued = 0;

    for (let offset = 0; ; offset += DB_PAGE_SIZE) {
      const contactColumns = {
        id: contacts.id,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      };

      const rows = listId
        ? await db
            .select(contactColumns)
            .from(contacts)
            .innerJoin(listMemberships, eq(listMemberships.contactId, contacts.id))
            // Excluir correos en la suppression list del tenant (§11.1, §11.2).
            .leftJoin(suppressionList, suppressionJoin)
            .where(recipientsFilter)
            .limit(DB_PAGE_SIZE)
            .offset(offset)
        : await db
            .select(contactColumns)
            .from(contacts)
            .leftJoin(suppressionList, suppressionJoin)
            .where(recipientsFilter)
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

    // 6. Contabilizar el uso del periodo (upsert atómico, §12.3).
    await incrementUsage(db, userId, periodStart, enqueued);

    // 7. Marcar la campaña como en envío.
    await db
      .update(campaigns)
      .set({
        status: 'sending',
        startedAt: campaign.startedAt ?? new Date(),
        totalRecipients: enqueued,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));

    return { enqueued };
  } catch (err) {
    const sendError = asSendError(err);

    // En el cron no hay usuario esperando: deja trazabilidad del fallo.
    if (mode === 'scheduled') {
      await markCampaignFailed(db, campaignId, sendError.message);
    }

    throw sendError;
  }
}
