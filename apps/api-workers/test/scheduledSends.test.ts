import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledController } from '@cloudflare/workers-types';
import type { Env } from '../src/types/env';

vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));
vi.mock('../src/queues/emailConsumer', () => ({ processEmailQueue: vi.fn() }));

import { getDb } from '../src/db/client';
import worker from '../src/index';
import {
  handleCancelCampaignSchedule,
  handleScheduleCampaign,
} from '../src/handlers/scheduleCampaign';
import {
  campaigns,
  contacts,
  listMemberships,
  lists,
  plans,
  subscriptions,
  usageCounters,
  users,
} from '../src/db/schema';
import { sendCampaign } from '../src/services/campaignSender';

const mockGetDb = vi.mocked(getDb);

interface FakeCampaign {
  id: string;
  userId: string;
  listId: string | null;
  fromEmail: string;
  designJson: unknown;
  htmlContent: string | null;
  status: string;
  scheduledAt: Date | null;
  startedAt: Date | null;
  totalRecipients: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeState {
  campaigns: FakeCampaign[];
  user: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  planQuota: number;
  usage: number;
  contacts: Array<Record<string, unknown>>;
  lists: Array<{ id: string; userId: string }>;
  memberships: Array<{ listId: string; contactId: string }>;
  suppressedEmails: Set<string>;
  usageUpserts: Array<Record<string, unknown>>;
}

function createState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    campaigns: [],
    user: {
      id: 'usr-1',
      email: 'user@kura.test',
      trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    subscription: null,
    planQuota: 500,
    usage: 0,
    contacts: [
      {
        id: 'ct-1',
        userId: 'usr-1',
        listId: 'lst-1',
        email: 'a@example.com',
        firstName: 'Ana',
        lastName: 'Pérez',
        status: 'active',
      },
    ],
    lists: [{ id: 'lst-1', userId: 'usr-1' }],
    memberships: [{ listId: 'lst-1', contactId: 'ct-1' }],
    suppressedEmails: new Set(),
    usageUpserts: [],
    ...overrides,
  };
}

function campaign(overrides: Partial<FakeCampaign> = {}): FakeCampaign {
  return {
    id: 'cmp-1',
    userId: 'usr-1',
    listId: 'lst-1',
    fromEmail: 'hola@kura.app',
    designJson: { type: 'page' },
    htmlContent: '<html><a>Baja</a> {{unsubscribe_url}}</html>',
    status: 'draft',
    scheduledAt: null,
    startedAt: null,
    totalRecipients: 0,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Introspección mínima de condiciones Drizzle                                */
/* -------------------------------------------------------------------------- */

interface ConditionPair {
  name: string;
  value: unknown;
}

function collectPairs(node: unknown, pairs: ConditionPair[] = []): ConditionPair[] {
  if (!node || typeof node !== 'object') return pairs;

  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return pairs;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i] as Record<string, unknown> | null;

    if (chunk && typeof chunk.name === 'string' && 'table' in chunk) {
      for (let j = i + 1; j < chunks.length; j += 1) {
        const next = chunks[j] as Record<string, unknown> | null;
        if (
          next &&
          'value' in next &&
          !Array.isArray(next.value) &&
          typeof next.name !== 'string'
        ) {
          pairs.push({ name: chunk.name, value: next.value });
          break;
        }
        if (typeof next === 'string') {
          pairs.push({ name: chunk.name, value: next });
          break;
        }
        if (next && Array.isArray(next.queryChunks)) break;
      }
    }

    collectPairs(chunk, pairs);
  }

  return pairs;
}

function pairValue(pairs: ConditionPair[], name: string): unknown {
  return pairs.find((pair) => pair.name === name)?.value;
}

/* -------------------------------------------------------------------------- */
/* Mock de DB en memoria                                                      */
/* -------------------------------------------------------------------------- */

function createScheduledDb(state: FakeState) {
  const select = (selection?: Record<string, unknown>) => {
    let table: unknown;
    let condition: unknown;
    let limitValue: number | null = null;
    let offsetValue = 0;
    let joinedMemberships = false;

    const resolve = (): unknown[] => {
      const pairs = collectPairs(condition);
      const id = pairValue(pairs, 'id');
      const userId = pairValue(pairs, 'user_id');
      const status = pairValue(pairs, 'status');
      const listId = pairValue(pairs, 'list_id');

      if (table === campaigns) {
        // Query del dispatcher: selecciona id/userId/scheduledAt.
        if (selection && 'scheduledAt' in selection) {
          const now = Date.now();
          return state.campaigns
            .filter(
              (row) =>
                row.status === 'scheduled' &&
                row.scheduledAt !== null &&
                row.scheduledAt.getTime() <= now
            )
            .sort(
              (a, b) =>
                (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0)
            )
            .slice(0, limitValue ?? 10)
            .map((row) => ({
              id: row.id,
              userId: row.userId,
              scheduledAt: row.scheduledAt,
            }));
        }

        return state.campaigns.filter(
          (row) =>
            (!id || row.id === id) &&
            (!userId || row.userId === userId) &&
            (!status || row.status === status)
        );
      }

      if (table === lists) {
        return state.lists.filter(
          (list) => (!id || list.id === id) && (!userId || list.userId === userId)
        );
      }
      if (table === users) return state.user ? [state.user] : [];
      if (table === subscriptions) {
        return state.subscription ? [state.subscription] : [];
      }
      if (table === plans) {
        return [{ monthlyEmailQuota: state.planQuota }];
      }
      if (table === usageCounters) {
        return [{ emailsSent: state.usage }];
      }
      if (table === contacts) {
        const memberIds = new Set(
          state.memberships
            .filter((membership) => !listId || membership.listId === listId)
            .map((membership) => membership.contactId)
        );

        const eligible = state.contacts.filter(
          (contact) =>
            (!userId || contact.userId === userId) &&
            (!status || contact.status === status) &&
            (!joinedMemberships || memberIds.has(String(contact.id))) &&
            !state.suppressedEmails.has(String(contact.email))
        );

        if (selection && 'count' in selection) {
          return [{ count: eligible.length }];
        }

        const start = offsetValue;
        const end = limitValue === null ? undefined : start + limitValue;
        return eligible.slice(start, end);
      }

      return [];
    };

    const chain = {
      from: (nextTable: unknown) => {
        table = nextTable;
        return chain;
      },
      innerJoin: (joinedTable: unknown) => {
        if (joinedTable === listMemberships) joinedMemberships = true;
        return chain;
      },
      leftJoin: () => chain,
      where: (nextCondition: unknown) => {
        condition = nextCondition;
        return chain;
      },
      orderBy: () => chain,
      limit: (value: number) => {
        limitValue = value;
        return chain;
      },
      offset: (value: number) => {
        offsetValue = value;
        return chain;
      },
      then: (
        onFulfilled: (value: unknown[]) => unknown,
        onRejected?: (error: unknown) => unknown
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };

    return chain;
  };

  const update = (table: unknown) => {
    let values: Record<string, unknown> = {};
    let condition: unknown;

    const apply = (selection?: Record<string, unknown>): unknown[] => {
      if (table !== campaigns) return [];
      const pairs = collectPairs(condition);
      const id = pairValue(pairs, 'id');
      const userId = pairValue(pairs, 'user_id');
      const status = pairValue(pairs, 'status');

      const target = state.campaigns.find(
        (row) =>
          (!id || row.id === id) &&
          (!userId || row.userId === userId) &&
          (!status || row.status === status)
      );

      if (!target) return [];
      Object.assign(target, values);

      if (!selection) return [target];
      return [
        Object.fromEntries(
          Object.keys(selection).map((key) => [
            key,
            (target as unknown as Record<string, unknown>)[key],
          ])
        ),
      ];
    };

    const chain = {
      set: (nextValues: Record<string, unknown>) => {
        values = nextValues;
        return chain;
      },
      where: (nextCondition: unknown) => {
        condition = nextCondition;
        return chain;
      },
      returning: (selection?: Record<string, unknown>) =>
        Promise.resolve(apply(selection)),
      then: (
        onFulfilled: (value: unknown[]) => unknown,
        onRejected?: (error: unknown) => unknown
      ) => Promise.resolve(apply()).then(onFulfilled, onRejected),
    };

    return chain;
  };

  const insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoUpdate: async () => {
        if (table === usageCounters) {
          state.usageUpserts.push(values);
          state.usage += Number(values.emailsSent ?? 0);
        }
      },
    }),
  });

  return { select, update, insert } as never;
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
  } as unknown as Env;
  return { env, sendBatch };
}

function createCtx() {
  const pending: Array<Promise<unknown>> = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  } as unknown as ExecutionContext;

  return {
    ctx,
    flush: () => Promise.all(pending),
  };
}

function scheduleRequest(campaignId: string, scheduledAt: string): Request {
  return new Request(`http://localhost/api/campaigns/${campaignId}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduled_at: scheduledAt }),
  });
}

function cancelRequest(campaignId: string): Request {
  return new Request(`http://localhost/api/campaigns/${campaignId}/cancel-schedule`, {
    method: 'POST',
  });
}

beforeEach(() => {
  mockGetDb.mockReset();
});

describe('POST /api/campaigns/:id/schedule', () => {
  it('programa una campaña draft con HTML compilado', async () => {
    const state = createState({ campaigns: [campaign()] });
    mockGetDb.mockReturnValue(createScheduledDb(state));
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const response = await handleScheduleCampaign(
      scheduleRequest('cmp-1', scheduledAt),
      createEnv().env,
      'usr-1'
    );
    const body = (await response.json()) as {
      campaign: { status: string; scheduledAt: string };
    };

    expect(response.status).toBe(200);
    expect(body.campaign.status).toBe('scheduled');
    expect(state.campaigns[0].status).toBe('scheduled');
    expect(state.campaigns[0].scheduledAt?.toISOString()).toBe(scheduledAt);
  });

  it('rechaza fechas pasadas o con menos de 2 minutos de anticipación', async () => {
    const state = createState({ campaigns: [campaign()] });
    mockGetDb.mockReturnValue(createScheduledDb(state));

    const past = await handleScheduleCampaign(
      scheduleRequest('cmp-1', new Date(Date.now() - 60_000).toISOString()),
      createEnv().env,
      'usr-1'
    );
    const pastBody = (await past.json()) as { error: { code: string } };

    const tooSoon = await handleScheduleCampaign(
      scheduleRequest('cmp-1', new Date(Date.now() + 60_000).toISOString()),
      createEnv().env,
      'usr-1'
    );
    const tooSoonBody = (await tooSoon.json()) as { error: { code: string } };

    expect(past.status).toBe(400);
    expect(pastBody.error.code).toBe('INVALID_SCHEDULE_TIME');
    expect(tooSoon.status).toBe(400);
    expect(tooSoonBody.error.code).toBe('INVALID_SCHEDULE_TIME');
    expect(state.campaigns[0].status).toBe('draft');
  });

  it('rechaza una campaña sin html_content compilado', async () => {
    const state = createState({
      campaigns: [campaign({ htmlContent: null })],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));

    const response = await handleScheduleCampaign(
      scheduleRequest('cmp-1', new Date(Date.now() + 10 * 60 * 1000).toISOString()),
      createEnv().env,
      'usr-1'
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('HTML_NOT_COMPILED');
  });
});

describe('POST /api/campaigns/:id/cancel-schedule', () => {
  it('devuelve una campaña programada a draft y limpia scheduled_at', async () => {
    const state = createState({
      campaigns: [
        campaign({
          status: 'scheduled',
          scheduledAt: new Date(Date.now() + 10 * 60 * 1000),
        }),
      ],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));

    const response = await handleCancelCampaignSchedule(
      cancelRequest('cmp-1'),
      createEnv().env,
      'usr-1'
    );
    const body = (await response.json()) as { campaign: { status: string } };

    expect(response.status).toBe(200);
    expect(body.campaign.status).toBe('draft');
    expect(state.campaigns[0].status).toBe('draft');
    expect(state.campaigns[0].scheduledAt).toBeNull();
  });

  it('devuelve 409 al intentar cancelar una campaña enviada', async () => {
    const state = createState({
      campaigns: [campaign({ status: 'sent', startedAt: new Date() })],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));

    const response = await handleCancelCampaignSchedule(
      cancelRequest('cmp-1'),
      createEnv().env,
      'usr-1'
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('INVALID_STATUS');
    expect(state.campaigns[0].status).toBe('sent');
  });
});

describe('Cron scheduled', () => {
  it('procesa una campaña vencida, la pasa a sending y encola los envíos', async () => {
    const state = createState({
      campaigns: [
        campaign({
          status: 'scheduled',
          scheduledAt: new Date(Date.now() - 60_000),
        }),
      ],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));
    const { env, sendBatch } = createEnv();
    const { ctx, flush } = createCtx();

    await worker.scheduled({} as ScheduledController, env, ctx);
    await flush();

    expect(state.campaigns[0].status).toBe('sending');
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(state.usageUpserts).toHaveLength(1);
    expect(state.usageUpserts[0]).toMatchObject({ userId: 'usr-1', emailsSent: 1 });
  });

  it('no toca una campaña programada para el futuro', async () => {
    const state = createState({
      campaigns: [
        campaign({
          status: 'scheduled',
          scheduledAt: new Date(Date.now() + 10 * 60 * 1000),
        }),
      ],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));
    const { env, sendBatch } = createEnv();
    const { ctx, flush } = createCtx();

    await worker.scheduled({} as ScheduledController, env, ctx);
    await flush();

    expect(state.campaigns[0].status).toBe('scheduled');
    expect(sendBatch).not.toHaveBeenCalled();
    expect(state.usageUpserts).toHaveLength(0);
  });

  it('marca failed con last_error si el usuario no tiene plan válido', async () => {
    const state = createState({
      user: {
        id: 'usr-1',
        email: 'user@kura.test',
        trialExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
      campaigns: [
        campaign({
          status: 'scheduled',
          scheduledAt: new Date(Date.now() - 60_000),
        }),
      ],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));
    const { env, sendBatch } = createEnv();
    const { ctx, flush } = createCtx();

    await worker.scheduled({} as ScheduledController, env, ctx);
    await flush();

    expect(state.campaigns[0].status).toBe('failed');
    expect(state.campaigns[0].lastError).toContain('periodo de prueba expiró');
    expect(sendBatch).not.toHaveBeenCalled();
    expect(state.usageUpserts).toHaveLength(0);
  });

  it('es idempotente: una segunda corrida no re-procesa la campaña', async () => {
    const state = createState({
      campaigns: [
        campaign({
          status: 'scheduled',
          scheduledAt: new Date(Date.now() - 60_000),
        }),
      ],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));
    const { env, sendBatch } = createEnv();

    const first = createCtx();
    await worker.scheduled({} as ScheduledController, env, first.ctx);
    await first.flush();

    const second = createCtx();
    await worker.scheduled({} as ScheduledController, env, second.ctx);
    await second.flush();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(state.usageUpserts).toHaveLength(1);
    expect(state.campaigns[0].status).toBe('sending');
  });
});

describe('Segmentos de envío', () => {
  it('con list_id válido encola solo los contactos de esa lista', async () => {
    const state = createState({
      campaigns: [campaign({ listId: 'lst-1' })],
      contacts: [
        {
          id: 'ct-1',
          userId: 'usr-1',
          email: 'lista1@example.com',
          firstName: 'Ana',
          lastName: 'Uno',
          status: 'active',
        },
        {
          id: 'ct-2',
          userId: 'usr-1',
          email: 'lista2@example.com',
          firstName: 'Bruno',
          lastName: 'Dos',
          status: 'active',
        },
        {
          id: 'ct-3',
          userId: 'usr-1',
          email: 'sin-lista@example.com',
          firstName: 'Carla',
          lastName: 'Tres',
          status: 'active',
        },
      ],
      lists: [
        { id: 'lst-1', userId: 'usr-1' },
        { id: 'lst-2', userId: 'usr-1' },
      ],
      memberships: [
        { listId: 'lst-1', contactId: 'ct-1' },
        { listId: 'lst-2', contactId: 'ct-2' },
      ],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));
    const { env, sendBatch } = createEnv();

    const result = await sendCampaign(env, 'cmp-1', 'usr-1');

    expect(result.enqueued).toBe(1);
    const [batch] = sendBatch.mock.calls[0];
    expect(batch).toHaveLength(1);
    expect(batch[0].body.contactId).toBe('ct-1');
  });

  it('con list_id de otro usuario lanza LIST_NOT_FOUND y no encola', async () => {
    const state = createState({
      campaigns: [campaign({ listId: 'lst-ajena' })],
      lists: [{ id: 'lst-ajena', userId: 'usr-2' }],
      memberships: [{ listId: 'lst-ajena', contactId: 'ct-1' }],
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));
    const { env, sendBatch } = createEnv();

    await expect(sendCampaign(env, 'cmp-1', 'usr-1')).rejects.toMatchObject({
      code: 'LIST_NOT_FOUND',
      status: 404,
    });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('con list_id NULL envía a todos los contactos activos del usuario', async () => {
    const state = createState({
      campaigns: [campaign({ listId: null })],
      contacts: [
        {
          id: 'ct-1',
          userId: 'usr-1',
          email: 'activo1@example.com',
          firstName: 'Ana',
          lastName: 'Uno',
          status: 'active',
        },
        {
          id: 'ct-2',
          userId: 'usr-1',
          email: 'activo2@example.com',
          firstName: 'Bruno',
          lastName: 'Dos',
          status: 'active',
        },
        {
          id: 'ct-3',
          userId: 'usr-1',
          email: 'baja@example.com',
          firstName: 'Carla',
          lastName: 'Tres',
          status: 'unsubscribed',
        },
        {
          id: 'ct-4',
          userId: 'usr-1',
          email: 'suprimido@example.com',
          firstName: 'Diego',
          lastName: 'Cuatro',
          status: 'active',
        },
      ],
      lists: [],
      memberships: [],
      suppressedEmails: new Set(['suprimido@example.com']),
    });
    mockGetDb.mockReturnValue(createScheduledDb(state));
    const { env, sendBatch } = createEnv();

    const result = await sendCampaign(env, 'cmp-1', 'usr-1');

    expect(result.enqueued).toBe(2);
    const [batch] = sendBatch.mock.calls[0];
    expect(
      batch.map((message: { body: { contactId: string } }) => message.body.contactId)
    ).toEqual(['ct-1', 'ct-2']);
  });
});
