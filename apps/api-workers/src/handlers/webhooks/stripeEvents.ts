import { and, eq } from 'drizzle-orm';
import type { PlanCode } from '@kura/core';
import { getDb } from '../../db/client';
import { subscriptions, users, webhookEvents } from '../../db/schema';
import {
  getStripe,
  idOf,
  planForPriceId,
  unixToDate,
} from '../../services/stripe';
import type { Env } from '../../types/env';

/* -------------------------------------------------------------------------- */
/* Tipos mínimos de los objetos de Stripe usados por el webhook               */
/* -------------------------------------------------------------------------- */

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

interface StripeSubscriptionObject {
  id: string;
  status?: string;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string>;
  cancel_at_period_end?: boolean;
  current_period_start?: number;
  current_period_end?: number;
  items?: {
    data?: Array<{
      price?: { id?: string };
      current_period_start?: number;
      current_period_end?: number;
    }>;
  };
}

interface StripeCheckoutSession {
  id: string;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  subscription_details?: { metadata?: Record<string, string> };
  line_items?: { data?: Array<{ price?: { id?: string } }> };
}

interface StripeInvoice {
  id: string;
  customer?: string | { id: string } | null;
  /** Campo legacy; Stripe v23 lo movió a `parent.subscription_details`. */
  subscription?: string | { id: string } | null;
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string } | null;
    } | null;
  } | null;
  period_end?: number;
  lines?: {
    data?: Array<{ period?: { start?: number; end?: number } }>;
  };
}

function invoiceSubscriptionId(data: StripeInvoice): string | null {
  return idOf(data.subscription ?? data.parent?.subscription_details?.subscription);
}

const SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizePlan(value: unknown): PlanCode | null {
  return value === 'free' || value === 'pro' || value === 'business' ? value : null;
}

function normalizeStatus(value: unknown): string {
  return typeof value === 'string' && SUBSCRIPTION_STATUSES.has(value) ? value : 'incomplete';
}

/** Plan comercial a partir de los metadatos o del price de la suscripción. */
function planFromSubscription(env: Env, data: StripeSubscriptionObject): PlanCode | null {
  return (
    normalizePlan(data.metadata?.plan) ??
    planForPriceId(env, data.items?.data?.[0]?.price?.id ?? null)
  );
}

/** Plan comercial a partir de los metadatos o del price de la Checkout Session. */
function planFromCheckoutSession(env: Env, data: StripeCheckoutSession): PlanCode | null {
  return (
    normalizePlan(data.metadata?.plan) ??
    normalizePlan(data.subscription_details?.metadata?.plan) ??
    planForPriceId(env, data.line_items?.data?.[0]?.price?.id ?? null)
  );
}

/** Periodo de facturación: Stripe v23 lo expone en los items de la suscripción. */
function subscriptionPeriod(data: StripeSubscriptionObject): {
  start: Date | null;
  end: Date | null;
} {
  const item = data.items?.data?.[0];
  return {
    start: unixToDate(item?.current_period_start ?? data.current_period_start),
    end: unixToDate(item?.current_period_end ?? data.current_period_end),
  };
}

function invoicePeriod(data: StripeInvoice): {
  start: Date | null;
  end: Date | null;
} {
  const line = data.lines?.data?.find((entry) => entry.period);
  return {
    start: unixToDate(line?.period?.start),
    end: unixToDate(line?.period?.end ?? data.period_end),
  };
}

/* -------------------------------------------------------------------------- */
/* Procesadores por tipo de evento                                            */
/* -------------------------------------------------------------------------- */

async function onCheckoutCompleted(
  db: ReturnType<typeof getDb>,
  env: Env,
  data: StripeCheckoutSession
): Promise<void> {
  const userId = data.metadata?.user_id ?? data.client_reference_id ?? null;
  const stripeSubscriptionId = idOf(data.subscription);
  const plan = planFromCheckoutSession(env, data);

  if (!userId || !stripeSubscriptionId || !plan) {
    console.warn('[Stripe] checkout.session.completed sin user_id, suscripción o plan; se ignora.');
    return;
  }

  const stripeCustomerId = idOf(data.customer);
  const now = new Date();

  await db
    .insert(subscriptions)
    .values({
      userId,
      planCode: plan,
      stripeCustomerId,
      stripeSubscriptionId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        userId,
        planCode: plan,
        stripeCustomerId,
        status: 'active',
        updatedAt: now,
      },
    });

  if (stripeCustomerId) {
    await db
      .update(users)
      .set({ stripeCustomerId })
      .where(eq(users.id, userId));
  }
}

async function onSubscriptionUpdated(
  db: ReturnType<typeof getDb>,
  env: Env,
  data: StripeSubscriptionObject
): Promise<void> {
  const plan = planFromSubscription(env, data);
  const userId = data.metadata?.user_id;
  const period = subscriptionPeriod(data);
  const now = new Date();
  const stripeCustomerId = idOf(data.customer);

  if (userId && plan) {
    await db
      .insert(subscriptions)
      .values({
        userId,
        planCode: plan,
        stripeCustomerId,
        stripeSubscriptionId: data.id,
        status: normalizeStatus(data.status),
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: subscriptions.stripeSubscriptionId,
        set: {
          planCode: plan,
          status: normalizeStatus(data.status),
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
          updatedAt: now,
        },
      });
    return;
  }

  const set: Record<string, unknown> = {
    status: normalizeStatus(data.status),
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    updatedAt: now,
  };
  if (plan) set.planCode = plan;

  await db
    .update(subscriptions)
    .set(set)
    .where(eq(subscriptions.stripeSubscriptionId, data.id));
}

async function onSubscriptionDeleted(
  db: ReturnType<typeof getDb>,
  data: StripeSubscriptionObject
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status: 'canceled', updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, data.id));
}

async function onInvoicePaid(
  db: ReturnType<typeof getDb>,
  data: StripeInvoice
): Promise<void> {
  const stripeSubscriptionId = invoiceSubscriptionId(data);
  if (!stripeSubscriptionId) return;

  const period = invoicePeriod(data);
  await db
    .update(subscriptions)
    .set({
      status: 'active',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

async function onInvoicePaymentFailed(
  db: ReturnType<typeof getDb>,
  data: StripeInvoice
): Promise<void> {
  const stripeSubscriptionId = invoiceSubscriptionId(data);
  if (!stripeSubscriptionId) return;

  await db
    .update(subscriptions)
    .set({ status: 'past_due', updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

/* -------------------------------------------------------------------------- */
/* Handler del webhook                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Webhook público `POST /webhooks/stripe` (§12.3).
 *
 * Verifica la firma `Stripe-Signature` con `constructEventAsync` (obligatorio
 * en Workers) y garantiza idempotencia con `webhook_events`, igual que el
 * webhook de SNS.
 */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return json({ error: { code: 'INVALID_SIGNATURE', message: 'Falta Stripe-Signature.' } }, 400);
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET no está configurado.');
    return json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook no configurado.' } }, 500);
  }

  const body = await request.text();

  let event: StripeEvent;
  try {
    const stripe = getStripe(env);
    event = (await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    )) as unknown as StripeEvent;
  } catch (err) {
    console.error('Firma de Stripe inválida:', err);
    return json({ error: { code: 'INVALID_SIGNATURE', message: 'Firma Stripe inválida.' } }, 400);
  }

  const db = getDb(env);

  // Idempotencia atómica: el mismo event.id solo se procesa una vez.
  let claimed: Array<{ id: string }>;
  try {
    claimed = await db
      .insert(webhookEvents)
      .values({
        provider: 'stripe',
        externalId: event.id,
        payload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.externalId] })
      .returning({ id: webhookEvents.id });
  } catch (err) {
    console.error('Error registrando el evento Stripe:', err);
    return json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } }, 500);
  }

  if (claimed.length === 0) {
    return json({ received: true, duplicate: true }, 200);
  }

  try {
    const data = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(db, env, data as unknown as StripeCheckoutSession);
        break;
      case 'customer.subscription.updated':
        await onSubscriptionUpdated(db, env, data as unknown as StripeSubscriptionObject);
        break;
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(db, data as unknown as StripeSubscriptionObject);
        break;
      case 'invoice.paid':
        await onInvoicePaid(db, data as unknown as StripeInvoice);
        break;
      case 'invoice.payment_failed':
        await onInvoicePaymentFailed(db, data as unknown as StripeInvoice);
        break;
      default:
        // Evento válido no manejado: se confirma a Stripe para evitar reintentos.
        break;
    }

    return json({ received: true }, 200);
  } catch (err) {
    // Liberar la marca de idempotencia para permitir el reintento de Stripe.
    try {
      await db
        .delete(webhookEvents)
        .where(
          and(eq(webhookEvents.provider, 'stripe'), eq(webhookEvents.externalId, event.id))
        );
    } catch (cleanupErr) {
      console.error('No se pudo liberar la marca de idempotencia Stripe:', cleanupErr);
    }

    console.error('Error procesando el evento Stripe:', err);
    return json({ error: { code: 'PROCESSING_ERROR', message: 'No se pudo procesar el evento.' } }, 500);
  }
}
