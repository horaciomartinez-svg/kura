import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

// Aísla los handlers de la base de datos real: getDb se reemplaza por un mock.
vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client';
import { handleSendCampaign } from '../src/handlers/sendCampaign';
import {
  campaigns,
  contacts,
  lists,
  plans,
  subscriptions,
  usageCounters,
  users,
} from '../src/db/schema';

const mockGetDb = vi.mocked(getDb);

interface MockData {
  campaign?: Record<string, unknown>;
  user?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  /** Cuota mensual devuelta por `plans`. */
  planQuota?: number;
  /** Correos ya usados en el periodo actual. */
  used?: number;
  contacts?: Record<string, unknown>[];
  /** Emails presentes en suppression_list: el handler debe excluirlos. */
  suppressedEmails?: string[];
}

/**
 * Mock mínimo del query builder de Drizzle: resuelve filas según la tabla
 * pasada a `.from(...)` y es "thenable" para que `await` funcione. Emula el
 * LEFT JOIN contra suppression_list y los contadores de uso.
 */
function createMockDb(data: MockData) {
  const suppressed = new Set(data.suppressedEmails ?? []);
  const usageUpserts: Record<string, unknown>[] = [];

  const eligibleContacts = () =>
    (data.contacts ?? []).filter((contact) => !suppressed.has(String(contact.email)));

  const db = {
    select: (selection?: Record<string, unknown>) => {
      let table: unknown;
      const resolveRows = (): Promise<unknown[]> => {
        if (table === campaigns) return Promise.resolve(data.campaign ? [data.campaign] : []);
        if (table === lists) {
          return Promise.resolve(
            data.campaign?.listId ? [{ id: data.campaign.listId }] : []
          );
        }
        if (table === users) return Promise.resolve(data.user ? [data.user] : []);
        if (table === subscriptions) {
          return Promise.resolve(data.subscription ? [data.subscription] : []);
        }
        if (table === plans) {
          return Promise.resolve([{ monthlyEmailQuota: data.planQuota ?? 500 }]);
        }
        if (table === usageCounters) {
          return Promise.resolve([{ emailsSent: data.used ?? 0 }]);
        }
        if (table === contacts) {
          if (selection && 'count' in selection) {
            return Promise.resolve([{ count: eligibleContacts().length }]);
          }
          return Promise.resolve(eligibleContacts());
        }
        return Promise.resolve([]);
      };

      const chain = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
          resolveRows().then(onFulfilled, onRejected),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => {
          if (table === usageCounters) usageUpserts.push(values);
          return Promise.resolve(undefined);
        },
      }),
    }),
    update: () => {
      const chain = {
        set: () => chain,
        where: () => chain,
        returning: () => Promise.resolve([{ id: data.campaign?.id ?? 'cmp' }]),
        then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve([{ id: data.campaign?.id ?? 'cmp' }]).then(onFulfilled, onRejected),
      };
      return chain;
    },
  };

  return { db, usageUpserts };
}

function createEnv(): { env: Env; sendBatch: ReturnType<typeof vi.fn> } {
  const sendBatch = vi.fn().mockResolvedValue(undefined);
  const env = {
    ENVIRONMENT: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    MAX_TRIAL_SENDS: '50',
    DATABASE_URL: 'postgres://test',
    SENDING_QUEUE: { sendBatch },
    TRACKING_QUEUE: {},
    DB_POOL: undefined,
  } as unknown as Env;
  return { env, sendBatch };
}

const draftCampaign = {
  id: 'cmp-1',
  userId: 'usr-1',
  listId: 'lst-1',
  status: 'draft',
  fromEmail: 'hola@kura.app',
  designJson: { type: 'page' },
  htmlContent: '<html><a>Baja</a> {{unsubscribe_url}}</html>',
};

const activeUser = {
  id: 'usr-1',
  trialSendsCount: 0,
  trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
};

const request = () =>
  new Request('http://localhost/api/campaigns/cmp-1/send', { method: 'POST' });

describe('handleSendCampaign', () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it('devuelve 404 si la campaña no existe', async () => {
    mockGetDb.mockReturnValue(createMockDb({}).db as never);
    const { env } = createEnv();

    const response = await handleSendCampaign(request(), env, 'usr-1');
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('CAMPAIGN_NOT_FOUND');
  });

  it('devuelve 402 SUBSCRIPTION_REQUIRED si el trial expiró sin suscripción', async () => {
    mockGetDb.mockReturnValue(
      createMockDb({
        campaign: draftCampaign,
        user: {
          ...activeUser,
          trialExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      }).db as never
    );
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env, 'usr-1');
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(402);
    expect(body.error).toBe('SUBSCRIPTION_REQUIRED');
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('devuelve 402 QUOTA_EXCEEDED con quota/used cuando se excede la cuota', async () => {
    mockGetDb.mockReturnValue(
      createMockDb({
        campaign: draftCampaign,
        user: activeUser,
        planQuota: 500,
        used: 499,
        contacts: [
          { id: 'ct-1', email: 'a@example.com', firstName: 'Ana', lastName: 'Pérez' },
          { id: 'ct-2', email: 'b@example.com', firstName: null, lastName: null },
        ],
      }).db as never
    );
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env, 'usr-1');
    const body = (await response.json()) as { error: string; quota: number; used: number };

    expect(response.status).toBe(402);
    expect(body).toMatchObject({ error: 'QUOTA_EXCEEDED', quota: 500, used: 499 });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('usa la cuota del plan de una suscripción activa', async () => {
    mockGetDb.mockReturnValue(
      createMockDb({
        campaign: draftCampaign,
        user: activeUser,
        subscription: {
          id: 'sub-1',
          userId: 'usr-1',
          planCode: 'pro',
          status: 'active',
          createdAt: new Date(),
        },
        planQuota: 10000,
        used: 9999,
        contacts: [
          { id: 'ct-1', email: 'a@example.com', firstName: 'Ana', lastName: 'Pérez' },
          { id: 'ct-2', email: 'b@example.com', firstName: null, lastName: null },
        ],
      }).db as never
    );
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env, 'usr-1');
    const body = (await response.json()) as { error: string; quota: number; used: number };

    expect(response.status).toBe(402);
    expect(body).toMatchObject({ error: 'QUOTA_EXCEEDED', quota: 10000, used: 9999 });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('devuelve 422 si falta el HTML y no cumple la normativa', async () => {
    mockGetDb.mockReturnValue(
      createMockDb({
        campaign: { ...draftCampaign, htmlContent: null },
        user: activeUser,
        planQuota: 500,
      }).db as never
    );
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env, 'usr-1');
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('COMPLIANCE_ERROR');
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('encola los contactos activos, marca sending e incrementa el uso', async () => {
    const mock = createMockDb({
      campaign: draftCampaign,
      user: activeUser,
      planQuota: 500,
      used: 0,
      contacts: [
        { id: 'ct-1', email: 'a@example.com', firstName: 'Ana', lastName: 'Pérez' },
        { id: 'ct-2', email: 'b@example.com', firstName: null, lastName: null },
      ],
    });
    mockGetDb.mockReturnValue(mock.db as never);
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env, 'usr-1');
    const body = (await response.json()) as { enqueued: number };

    expect(response.status).toBe(202);
    expect(body.enqueued).toBe(2);
    expect(sendBatch).toHaveBeenCalledTimes(1);

    const [batch] = sendBatch.mock.calls[0];
    expect(batch).toHaveLength(2);
    expect(batch[0].body).toMatchObject({
      campaignId: 'cmp-1',
      contactId: 'ct-1',
      contactEmail: 'a@example.com',
      contactVars: { nombre: 'Ana', apellido: 'Pérez', email: 'a@example.com' },
    });

    expect(mock.usageUpserts).toHaveLength(1);
    expect(mock.usageUpserts[0]).toMatchObject({ userId: 'usr-1', emailsSent: 2 });
  });

  it('excluye los contactos presentes en suppression_list', async () => {
    const mock = createMockDb({
      campaign: draftCampaign,
      user: activeUser,
      planQuota: 500,
      used: 0,
      contacts: [
        { id: 'ct-1', email: 'a@example.com', firstName: 'Ana', lastName: 'Pérez' },
        { id: 'ct-2', email: 'b@example.com', firstName: null, lastName: null },
      ],
      suppressedEmails: ['b@example.com'],
    });
    mockGetDb.mockReturnValue(mock.db as never);
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env, 'usr-1');
    const body = (await response.json()) as { enqueued: number };

    expect(response.status).toBe(202);
    expect(body.enqueued).toBe(1);

    const [batch] = sendBatch.mock.calls[0];
    expect(batch).toHaveLength(1);
    expect(batch[0].body.contactEmail).toBe('a@example.com');

    expect(mock.usageUpserts[0]).toMatchObject({ userId: 'usr-1', emailsSent: 1 });
  });
});
