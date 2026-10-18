import { and, desc, eq, sql } from 'drizzle-orm';
import type { EffectivePlanCode, PlanCode } from '@kura/core';
import type { Database } from '../db/client';
import { plans, subscriptions, usageCounters } from '../db/schema';

/** Cuotas de respaldo si la tabla `plans` no está disponible. */
export const PLAN_QUOTAS: Record<PlanCode, number> = {
  free: 500,
  pro: 10000,
  business: 50000,
};

/** Estados de suscripción que conceden acceso al plan de pago. */
export const ACCESS_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

export type SubscriptionRecord = typeof subscriptions.$inferSelect;

export interface BillingUser {
  id: string;
  trialExpiresAt: Date | string | null;
}

export interface EffectivePlan {
  plan: EffectivePlanCode;
  quota: number;
  hasPaidAccess: boolean;
  subscription: SubscriptionRecord | null;
}

/** Primer día del mes actual en UTC, en formato `YYYY-MM-01`. */
export function currentPeriodStart(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** Suscripción más reciente del usuario, sea cual sea su estado. */
export async function getLatestSubscription(
  db: Database,
  userId: string
): Promise<SubscriptionRecord | null> {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return subscription ?? null;
}

/** Cuota mensual configurada para un plan, con respaldo local. */
export async function getPlanQuota(db: Database, plan: PlanCode): Promise<number> {
  const [row] = await db
    .select({ monthlyEmailQuota: plans.monthlyEmailQuota })
    .from(plans)
    .where(eq(plans.code, plan))
    .limit(1);

  return row?.monthlyEmailQuota ?? PLAN_QUOTAS[plan];
}

/**
 * Resuelve el plan efectivo del usuario:
 * - suscripción activa/trialing → plan comercial y su cuota;
 * - sin suscripción con trial vigente → plan `trial` con la cuota de `free`;
 * - sin suscripción y trial expirado → `expired` (bloqueo 402).
 */
export async function resolveEffectivePlan(
  db: Database,
  user: BillingUser
): Promise<EffectivePlan> {
  const subscription = await getLatestSubscription(db, user.id);

  if (subscription && ACCESS_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    const plan = subscription.planCode as PlanCode;
    return {
      plan,
      quota: await getPlanQuota(db, plan),
      hasPaidAccess: true,
      subscription,
    };
  }

  const trialExpiresAt = user.trialExpiresAt ? new Date(user.trialExpiresAt) : null;
  if (trialExpiresAt && trialExpiresAt.getTime() > Date.now()) {
    return {
      plan: 'trial',
      quota: await getPlanQuota(db, 'free'),
      hasPaidAccess: false,
      subscription,
    };
  }

  return { plan: 'expired', quota: 0, hasPaidAccess: false, subscription };
}

/** Correos enviados por el usuario en el periodo indicado. */
export async function getUsage(
  db: Database,
  userId: string,
  periodStart: string
): Promise<number> {
  const [row] = await db
    .select({ emailsSent: usageCounters.emailsSent })
    .from(usageCounters)
    .where(
      and(eq(usageCounters.userId, userId), eq(usageCounters.periodStart, periodStart))
    )
    .limit(1);

  return row?.emailsSent ?? 0;
}

/** Incrementa atómicamente el contador del periodo (upsert). */
export async function incrementUsage(
  db: Database,
  userId: string,
  periodStart: string,
  emails: number
): Promise<void> {
  if (emails <= 0) return;

  await db
    .insert(usageCounters)
    .values({ userId, periodStart, emailsSent: emails })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.periodStart],
      set: { emailsSent: sql`${usageCounters.emailsSent} + ${emails}` },
    });
}
