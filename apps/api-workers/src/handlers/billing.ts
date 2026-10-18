import { eq } from 'drizzle-orm';
import type { PlanCode } from '@kura/core';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { currentPeriodStart, getUsage, resolveEffectivePlan } from '../services/billing';
import { getStripe, idOf, priceIdForPlan } from '../services/stripe';
import type { Env } from '../types/env';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function appOrigin(request: Request, env: Env): string {
  return (env.APP_ORIGIN || new URL(request.url).origin).replace(/\/$/, '');
}

function isPaidPlan(value: unknown): value is Exclude<PlanCode, 'free'> {
  return value === 'pro' || value === 'business';
}

/**
 * POST /api/billing/checkout { plan: 'pro' | 'business' }
 * Crea (si hace falta) el Customer de Stripe y una Checkout Session de
 * suscripción (§12.3). Devuelve la URL alojada por Stripe.
 */
export async function handleCreateCheckout(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  let body: { plan?: unknown };
  try {
    body = (await request.json()) as { plan?: unknown };
  } catch {
    return error('BAD_REQUEST', 'JSON inválido.', 400);
  }

  if (!isPaidPlan(body.plan)) {
    return error('INVALID_PLAN', 'El plan debe ser "pro" o "business".', 400);
  }

  const priceId = priceIdForPlan(env, body.plan);
  if (!priceId) {
    return error('BILLING_NOT_CONFIGURED', 'El plan no tiene un precio de Stripe configurado.', 500);
  }

  const db = getDb(env);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return error('USER_NOT_FOUND', 'El usuario no existe.', 404);
  }

  try {
    const stripe = getStripe(env);
    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      await db
        .update(users)
        .set({ stripeCustomerId: customerId })
        .where(eq(users.id, userId));
    }

    const origin = appOrigin(request, env);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/billing?success=1`,
      cancel_url: `${origin}/billing?canceled=1`,
      client_reference_id: userId,
      metadata: { user_id: userId, plan: body.plan },
      subscription_data: { metadata: { user_id: userId, plan: body.plan } },
    });

    if (!session.url) {
      return error('CHECKOUT_ERROR', 'Stripe no devolvió una URL de Checkout.', 502);
    }

    return json({ url: session.url }, 200);
  } catch (err) {
    console.error('Error creando la Checkout Session:', err);
    return error('STRIPE_ERROR', 'No se pudo iniciar el proceso de pago.', 502);
  }
}

/**
 * GET /api/billing/portal
 * Crea una sesión del Customer Portal de Stripe para gestionar la suscripción.
 */
export async function handleCreatePortal(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const db = getDb(env);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return error('USER_NOT_FOUND', 'El usuario no existe.', 404);
  }

  const customerId = user.stripeCustomerId;
  if (!customerId) {
    return error(
      'CUSTOMER_NOT_FOUND',
      'El usuario aún no tiene un Customer de Stripe. Inicia un checkout primero.',
      404
    );
  }

  try {
    const stripe = getStripe(env);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin(request, env)}/billing`,
    });

    return json({ url: session.url }, 200);
  } catch (err) {
    console.error('Error creando la sesión del Customer Portal:', err);
    return error('STRIPE_ERROR', 'No se pudo abrir el portal de facturación.', 502);
  }
}

/**
 * GET /api/me
 * Perfil del usuario con su plan efectivo, cuota mensual y uso del periodo.
 */
export async function handleGetMe(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const db = getDb(env);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return error('USER_NOT_FOUND', 'El usuario no existe.', 404);
  }

  const effective = await resolveEffectivePlan(db, user);
  const periodStart = currentPeriodStart();
  const used = await getUsage(db, userId, periodStart);
  const subscription = effective.subscription;

  return json(
    {
      user: {
        id: user.id,
        email: user.email,
        plan: effective.plan,
        quota: effective.quota,
        used,
        trialExpiresAt: user.trialExpiresAt,
        stripeCustomerId: user.stripeCustomerId,
      },
      periodStart,
      subscription: subscription
        ? {
            planCode: subscription.planCode,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
          }
        : null,
      // Mantiene el ID del customer por si el cliente lo necesita para Stripe.js.
      customerId: user.stripeCustomerId ?? null,
      subscriptionId: subscription ? idOf(subscription.stripeSubscriptionId) : null,
    },
    200
  );
}
