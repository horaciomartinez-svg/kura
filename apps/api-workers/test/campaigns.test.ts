import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));
vi.mock('../src/queues/emailConsumer', () => ({ processEmailQueue: vi.fn() }));

import { getDb } from '../src/db/client';
import worker from '../src/index';
import {
  handleCreateCampaign,
  handleListCampaigns,
} from '../src/handlers/campaigns';
import { campaigns, users } from '../src/db/schema';

const mockGetDb = vi.mocked(getDb);

interface FakeCampaign {
  id: string;
  userId: string;
  listId: string | null;
  name: string;
  subject: string | null;
  fromEmail: string;
  designJson: unknown;
  htmlContent: string | null;
  status: string;
  scheduledAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeState {
  campaigns: FakeCampaign[];
  users: Array<{ id: string; email: string }>;
}

function createLastCampaign(overrides: Partial<FakeCampaign> = {}): FakeCampaign {
  return {
    id: 'cmp-1',
    userId: 'usr-1',
    listId: null,
    name: 'Campaña existente',
    subject: null,
    fromEmail: 'user@kura.test',
    designJson: null,
    htmlContent: null,
    status: 'draft',
    scheduledAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    campaigns: [],
    users: [{ id: 'usr-1', email: 'user@kura.test' }],
    ...overrides,
  };
}

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

function createCampaignsDb(state: FakeState) {
  let sequence = 0;

  const select = (selection?: Record<string, unknown>) => {
    let table: unknown;
    let condition: unknown;
    let limitValue: number | null = null;

    const resolve = (): unknown[] => {
      const pairs = collectPairs(condition);
      const id = pairValue(pairs, 'id');
      const userId = pairValue(pairs, 'user_id');

      if (table === users) {
        return state.users
          .filter((user) => !id || user.id === id)
          .slice(0, limitValue ?? undefined);
      }

      if (table === campaigns) {
        const filtered = state.campaigns
          .filter((campaign) => !userId || campaign.userId === userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        // Listado con join a lists: { campaign, listName }.
        if (selection && 'campaign' in selection) {
          return filtered.map((campaign) => ({
            campaign,
            listName: campaign.listId ? 'Lista de prueba' : null,
          }));
        }

        return filtered;
      }

      return [];
    };

    const chain = {
      from: (nextTable: unknown) => {
        table = nextTable;
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
      then: (
        onFulfilled: (value: unknown[]) => unknown,
        onRejected?: (error: unknown) => unknown
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };

    return chain;
  };

  const insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        if (table !== campaigns) return [];
        sequence += 1;
        const now = new Date();
        const row: FakeCampaign = {
          id: `cmp-${sequence}`,
          userId: String(values.userId),
          listId: (values.listId as string | null) ?? null,
          name: String(values.name),
          subject: (values.subject as string | null) ?? null,
          fromEmail: String(values.fromEmail),
          designJson: values.designJson ?? null,
          htmlContent: (values.htmlContent as string | null) ?? null,
          status: String(values.status),
          scheduledAt: (values.scheduledAt as Date | null) ?? null,
          lastError: (values.lastError as string | null) ?? null,
          createdAt: (values.createdAt as Date | undefined) ?? now,
          updatedAt: (values.updatedAt as Date | undefined) ?? now,
        };
        state.campaigns.push(row);
        return [row];
      },
    }),
  });

  return { select, insert } as never;
}

function createEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    MAX_TRIAL_SENDS: '50',
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SENDING_QUEUE: {},
    TRACKING_QUEUE: {},
  } as unknown as Env;
}

function createRequest(body?: string): Request {
  return new Request('http://localhost/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ?? JSON.stringify({ name: 'Nueva campaña' }),
  });
}

function listRequest(): Request {
  return new Request('http://localhost/api/campaigns', { method: 'GET' });
}

beforeEach(() => {
  mockGetDb.mockReset();
});

describe('POST /api/campaigns', () => {
  it('crea una campaña draft y devuelve 201', async () => {
    const state = createState();
    mockGetDb.mockReturnValue(createCampaignsDb(state));

    const response = await handleCreateCampaign(
      createRequest(JSON.stringify({ name: '  Lanzamiento  ', subject: 'Hola' })),
      createEnv(),
      'usr-1'
    );
    const body = (await response.json()) as {
      campaign: { id: string; name: string; status: string; subject: string };
    };

    expect(response.status).toBe(201);
    expect(body.campaign).toMatchObject({
      name: 'Lanzamiento',
      status: 'draft',
      subject: 'Hola',
    });
    expect(state.campaigns).toHaveLength(1);
    expect(state.campaigns[0]).toMatchObject({
      userId: 'usr-1',
      listId: null,
      fromEmail: 'user@kura.test',
      status: 'draft',
      designJson: null,
      htmlContent: null,
    });
  });

  it('devuelve 400 si falta el nombre', async () => {
    const state = createState();
    mockGetDb.mockReturnValue(createCampaignsDb(state));

    const response = await handleCreateCampaign(
      createRequest(JSON.stringify({ subject: 'Sin nombre' })),
      createEnv(),
      'usr-1'
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('NAME_REQUIRED');
    expect(state.campaigns).toHaveLength(0);
  });

  it('devuelve 401 sin JWT a través del Worker', async () => {
    const state = createState();
    mockGetDb.mockReturnValue(createCampaignsDb(state));

    const response = await worker.fetch(createRequest(), createEnv(), {} as ExecutionContext);

    expect(response.status).toBe(401);
    expect(state.campaigns).toHaveLength(0);
  });
});

describe('GET /api/campaigns', () => {
  it('lista solo las campañas del usuario autenticado', async () => {
    const state = createState({
      campaigns: [
        createLastCampaign({
          id: 'cmp-a',
          userId: 'usr-A',
          name: 'Campaña A',
          createdAt: new Date('2026-10-01T10:00:00Z'),
        }),
        createLastCampaign({
          id: 'cmp-b',
          userId: 'usr-B',
          name: 'Campaña B',
          createdAt: new Date('2026-10-02T10:00:00Z'),
        }),
      ],
    });
    mockGetDb.mockReturnValue(createCampaignsDb(state));

    const response = await handleListCampaigns(listRequest(), createEnv(), 'usr-B');
    const body = (await response.json()) as {
      campaigns: Array<{ id: string; name: string; listName: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0]).toMatchObject({ id: 'cmp-b', name: 'Campaña B' });
    expect(body.campaigns.some((campaign) => campaign.id === 'cmp-a')).toBe(false);
  });

  it('flujo completo crear → listar devuelve la campaña recién creada', async () => {
    const state = createState();
    mockGetDb.mockReturnValue(createCampaignsDb(state));

    const created = await handleCreateCampaign(
      createRequest(JSON.stringify({ name: 'Primera campaña' })),
      createEnv(),
      'usr-1'
    );
    const createdBody = (await created.json()) as { campaign: { id: string } };

    const listed = await handleListCampaigns(listRequest(), createEnv(), 'usr-1');
    const listedBody = (await listed.json()) as {
      campaigns: Array<{ id: string; name: string; status: string }>;
    };

    expect(created.status).toBe(201);
    expect(listed.status).toBe(200);
    expect(listedBody.campaigns).toHaveLength(1);
    expect(listedBody.campaigns[0]).toMatchObject({
      id: createdBody.campaign.id,
      name: 'Primera campaña',
      status: 'draft',
    });
  });

  it('ordena las campañas por created_at descendente', async () => {
    const state = createState({
      campaigns: [
        createLastCampaign({
          id: 'cmp-old',
          userId: 'usr-1',
          name: 'Antigua',
          createdAt: new Date('2026-09-01T10:00:00Z'),
        }),
        createLastCampaign({
          id: 'cmp-new',
          userId: 'usr-1',
          name: 'Nueva',
          createdAt: new Date('2026-10-01T10:00:00Z'),
        }),
      ],
    });
    mockGetDb.mockReturnValue(createCampaignsDb(state));

    const response = await handleListCampaigns(listRequest(), createEnv(), 'usr-1');
    const body = (await response.json()) as { campaigns: Array<{ id: string }> };

    expect(body.campaigns.map((campaign) => campaign.id)).toEqual(['cmp-new', 'cmp-old']);
  });
});
