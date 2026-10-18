import Stripe from 'stripe';
import type { PlanCode } from '@kura/core';
import type { Env } from '../types/env';

/**
 * Cliente de Stripe para Cloudflare Workers (§12.3).
 *
 * Se crea uno nuevo por request. No debe cachearse a nivel de módulo: el
 * cliente mantiene estado de I/O (HTTP/fetch) y Cloudflare Workers prohíbe
 * reutilizarlo entre requests distintos. En Workers es obligatorio usar
 * `createFetchHttpClient()` y la verificación asíncrona de firmas.
 */
export function getStripe(env: Env): Stripe {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY no está configurada.');
  }

  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 1,
  });
}

/** Price ID de Stripe asociado a un plan comercial. */
export function priceIdForPlan(env: Env, plan: PlanCode): string | null {
  if (plan === 'pro') return env.STRIPE_PRICE_PRO ?? null;
  if (plan === 'business') return env.STRIPE_PRICE_BUSINESS ?? null;
  return null;
}

/** Traduce un price ID de Stripe al código de plan comercial. */
export function planForPriceId(env: Env, priceId: string | null | undefined): PlanCode | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === env.STRIPE_PRICE_BUSINESS) return 'business';
  return null;
}

/** Acepta un ID o un objeto expandido de Stripe y devuelve el ID. */
export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

/** Convierte un timestamp Unix (segundos) a Date, tolerando null/undefined. */
export function unixToDate(value: number | null | undefined): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}
