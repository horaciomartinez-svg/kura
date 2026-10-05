import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

// Aísla los handlers de la base de datos real: getDb se reemplaza por un mock.
vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client';
import { handleSendCampaign } from '../src/handlers/sendCampaign';
import { campaigns, contacts, users } from '../src/db/schema';

const mockGetDb = vi.mocked(getDb);

interface MockData {
  campaign?: Record<string, unknown>;
  user?: Record<string, unknown>;
  contacts?: Record<string, unknown>[];
}

/**
 * Mock mínimo del query builder de Drizzle: resuelve filas según la tabla
 * pasada a `.from(...)` y es "thenable" para que `await` funcione.
 */
function createMockDb(data: MockData) {
  const db = {
    select: () => {
      let table: unknown;
      const resolveRows = (): Promise<unknown[]> => {
        if (table === campaigns) return Promise.resolve(data.campaign ? [data.campaign] : []);
        if (table === users) return Promise.resolve(data.user ? [data.user] : []);
        if (table === contacts) return Promise.resolve(data.contacts ?? []);
        return Promise.resolve([]);
      };
      const chain = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        innerJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
          resolveRows().then(onFulfilled, onRejected),
      };
      return chain;
    },
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
  return db;
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
    mockGetDb.mockReturnValue(createMockDb({}) as never);
    const { env } = createEnv();

    const response = await handleSendCampaign(request(), env);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('CAMPAIGN_NOT_FOUND');
  });

  it('devuelve 402 si el trial agotó sus envíos', async () => {
    mockGetDb.mockReturnValue(
      createMockDb({
        campaign: draftCampaign,
        user: { ...activeUser, trialSendsCount: 50 },
      }) as never
    );
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(402);
    expect(body.error.code).toBe('TRIAL_EXHAUSTED');
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('devuelve 422 si falta el HTML y no cumple la normativa', async () => {
    mockGetDb.mockReturnValue(
      createMockDb({ campaign: { ...draftCampaign, htmlContent: null }, user: activeUser }) as never
    );
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('COMPLIANCE_ERROR');
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('encola los contactos activos y marca la campaña como sending', async () => {
    mockGetDb.mockReturnValue(
      createMockDb({
        campaign: draftCampaign,
        user: activeUser,
        contacts: [
          { id: 'ct-1', email: 'a@example.com', firstName: 'Ana', lastName: 'Pérez' },
          { id: 'ct-2', email: 'b@example.com', firstName: null, lastName: null },
        ],
      }) as never
    );
    const { env, sendBatch } = createEnv();

    const response = await handleSendCampaign(request(), env);
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
  });
});
