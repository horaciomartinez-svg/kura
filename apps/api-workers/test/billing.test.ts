import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client';
import { handleCreateCheckout } from '../src/handlers/billing';
import { handleStripeWebhook } from '../src/handlers/webhooks/stripeEvents';
import { subscriptions, users } from '../src/db/schema';

const mockGetDb = vi.mocked(getDb);

const WEBHOOK_SECRET = 'whsec_test_secret';
const STRIPE_PRICE_PRO = 'price_pro_test';
const STRIPE_PRICE_BUSINESS = 'price_business_test';

function createEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    MAX_TRIAL_SENDS: '50',
    DATABASE_URL: 'postgres://test',
    APP_ORIGIN: 'https://app.kura.test',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_PRO,
    STRIPE_PRICE_BUSINESS,
  } as unknown as Env;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function checkoutRequest(plan: string): Request {
  return new Request('http://localhost/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function stripeSignature(payload: string, secret: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(`${timestamp}.${payload}`);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return `t=${timestamp},v1=${toHex(signature)}`;
}

function webhookRequest(payload: string, signature: string): Request {
  return new Request('http://localhost/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
}

interface BillingMockOptions {
  user?: Record<string, unknown> | null;
  /** Resultados sucesivos de `returning()` para webhook_events. */
  webhookClaims?: Array<Array<{ id: string }>>;
}

function createBillingDb(options: BillingMockOptions = {}) {
  const subscriptionUpserts: Record<string, unknown>[] = [];
  const userUpdates: Record<string, unknown>[] = [];
  const claims = [...(options.webhookClaims ?? [])];

  let selectedTable: unknown;

  const select = () => {
    const chain = {
      from: (table: unknown) => {
        selectedTable = table;
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      limit: () => {
        if (selectedTable === users) {
          return Promise.resolve(options.user ? [options.user] : []);
        }
        return Promise.resolve([]);
      },
      then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(options.user ? [options.user] : []).then(onFulfilled, onRejected),
    };
    return chain;
  };

  const update = (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        if (table === users) userUpdates.push(values);
        return Promise.resolve(undefined);
      },
    }),
  });

  const insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve(claims.shift() ?? []),
      }),
      onConflictDoUpdate: () => {
        if (table === subscriptions) subscriptionUpserts.push(values);
        return Promise.resolve(undefined);
      },
    }),
  });

  const del = () => ({
    where: () => Promise.resolve(undefined),
  });

  return {
    db: { select, insert, update, delete: del } as never,
    subscriptionUpserts,
    userUpdates,
  };
}

function eventPayload(type: string, object: Record<string, unknown>, id = 'evt_1'): string {
  return JSON.stringify({
    id,
    object: 'event',
    type,
    data: { object },
  });
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  mockGetDb.mockReset();
  vi.unstubAllGlobals();
});

describe('POST /api/billing/checkout', () => {
  it('crea el Customer y la Checkout Session y devuelve la URL de Stripe', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;

      if (path === '/v1/customers') {
        return new Response(JSON.stringify({ id: 'cus_123', object: 'customer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path === '/v1/checkout/sessions') {
        return new Response(
          JSON.stringify({ id: 'cs_123', object: 'checkout.session', url: 'https://checkout.stripe.test/cs_123' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mock = createBillingDb({
      user: { id: 'usr-1', email: 'user@kura.test', stripeCustomerId: null, trialExpiresAt: new Date() },
    });
    mockGetDb.mockReturnValue(mock.db);

    const response = await handleCreateCheckout(checkoutRequest('pro'), createEnv(), 'usr-1');
    const body = (await response.json()) as { url: string };

    expect(response.status).toBe(200);
    expect(body.url).toBe('https://checkout.stripe.test/cs_123');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [customerUrl] = fetchMock.mock.calls[0];
    expect(new URL(String(customerUrl)).pathname).toBe('/v1/customers');

    const [checkoutUrl, checkoutInit] = fetchMock.mock.calls[1];
    expect(new URL(String(checkoutUrl)).pathname).toBe('/v1/checkout/sessions');
    const form = String((checkoutInit as RequestInit).body ?? '');
    expect(form).toContain(encodeURIComponent(STRIPE_PRICE_PRO));
    expect(form).toContain('client_reference_id=usr-1');
    expect(form).toContain('success_url=https%3A%2F%2Fapp.kura.test%2Fbilling%3Fsuccess%3D1');

    expect(mock.userUpdates).toContainEqual({ stripeCustomerId: 'cus_123' });
  });

  it('rechaza un plan no comercial con 400', async () => {
    mockGetDb.mockReturnValue(createBillingDb().db);

    const response = await handleCreateCheckout(checkoutRequest('free'), createEnv(), 'usr-1');
    expect(response.status).toBe(400);
  });
});

describe('POST /webhooks/stripe', () => {
  it('rechaza una firma inválida con 400', async () => {
    mockGetDb.mockReturnValue(createBillingDb().db);
    const payload = eventPayload('checkout.session.completed', {});

    const response = await handleStripeWebhook(
      webhookRequest(payload, 't=123,v1=deadbeef'),
      createEnv()
    );

    expect(response.status).toBe(400);
  });

  it('procesa checkout.session.completed y hace upsert de la suscripción', async () => {
    const mock = createBillingDb({ webhookClaims: [[{ id: 'wh-1' }]] });
    mockGetDb.mockReturnValue(mock.db);

    const payload = eventPayload('checkout.session.completed', {
      id: 'cs_123',
      object: 'checkout.session',
      customer: 'cus_123',
      subscription: 'sub_123',
      client_reference_id: 'usr-1',
      metadata: { user_id: 'usr-1', plan: 'pro' },
    });
    const signature = await stripeSignature(payload, WEBHOOK_SECRET);

    const response = await handleStripeWebhook(webhookRequest(payload, signature), createEnv());

    expect(response.status).toBe(200);
    expect(mock.subscriptionUpserts).toHaveLength(1);
    expect(mock.subscriptionUpserts[0]).toMatchObject({
      userId: 'usr-1',
      planCode: 'pro',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      status: 'active',
    });
    expect(mock.userUpdates).toContainEqual({ stripeCustomerId: 'cus_123' });
  });

  it('mapea el price de Stripe al plan business si no hay metadata', async () => {
    const mock = createBillingDb({ webhookClaims: [[{ id: 'wh-2' }]] });
    mockGetDb.mockReturnValue(mock.db);

    const payload = eventPayload('checkout.session.completed', {
      id: 'cs_456',
      object: 'checkout.session',
      customer: 'cus_456',
      subscription: 'sub_456',
      client_reference_id: 'usr-2',
      line_items: { data: [{ price: { id: STRIPE_PRICE_BUSINESS } }] },
    });
    const signature = await stripeSignature(payload, WEBHOOK_SECRET);

    const response = await handleStripeWebhook(webhookRequest(payload, signature), createEnv());

    expect(response.status).toBe(200);
    expect(mock.subscriptionUpserts[0]).toMatchObject({
      userId: 'usr-2',
      planCode: 'business',
      stripeSubscriptionId: 'sub_456',
    });
  });

  it('es idempotente: el mismo event.id solo se procesa una vez', async () => {
    const mock = createBillingDb({
      webhookClaims: [[{ id: 'wh-1' }], []],
    });
    mockGetDb.mockReturnValue(mock.db);

    const payload = eventPayload(
      'checkout.session.completed',
      {
        id: 'cs_123',
        object: 'checkout.session',
        customer: 'cus_123',
        subscription: 'sub_123',
        client_reference_id: 'usr-1',
        metadata: { user_id: 'usr-1', plan: 'pro' },
      },
      'evt_duplicate'
    );

    const firstSignature = await stripeSignature(payload, WEBHOOK_SECRET);
    const first = await handleStripeWebhook(webhookRequest(payload, firstSignature), createEnv());

    const secondSignature = await stripeSignature(payload, WEBHOOK_SECRET);
    const second = await handleStripeWebhook(webhookRequest(payload, secondSignature), createEnv());
    const secondBody = (await second.json()) as { duplicate: boolean };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody.duplicate).toBe(true);
    expect(mock.subscriptionUpserts).toHaveLength(1);
  });

  it('confirma con 200 los eventos válidos no manejados', async () => {
    const mock = createBillingDb({ webhookClaims: [[{ id: 'wh-3' }]] });
    mockGetDb.mockReturnValue(mock.db);

    const payload = eventPayload('customer.created', { id: 'cus_1' }, 'evt_unhandled');
    const signature = await stripeSignature(payload, WEBHOOK_SECRET);

    const response = await handleStripeWebhook(webhookRequest(payload, signature), createEnv());

    expect(response.status).toBe(200);
    expect(mock.subscriptionUpserts).toHaveLength(0);
  });
});
