import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client';
import { processTrackingQueue } from '../src/queues/trackingConsumer';

const mockGetDb = vi.mocked(getDb);

const env = { DATABASE_URL: 'postgres://test' } as unknown as Env;

function makeBatch(messages: unknown[]) {
  return {
    queue: 'kura-tracking-queue',
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as never;
}

/** Mock del query builder que soporta insert/select/update del consumidor. */
function createMockDb(data: { contact?: Record<string, unknown> } = {}) {
  const valuesMock = vi.fn().mockReturnValue({
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  });
  const insert = vi.fn(() => ({ values: valuesMock }));

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(data.contact ? [data.contact] : []),
    };
    return chain;
  });

  return { db: { insert, select, update } as never, insert, valuesMock, updateSet };
}

describe('processTrackingQueue', () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it('inserta los eventos en un único bulk parametrizado y hace ackAll', async () => {
    const { db, insert, valuesMock } = createMockDb();
    mockGetDb.mockReturnValue(db);

    const batch = makeBatch([
      {
        body: {
          campaign_id: 'cmp-1',
          contact_id: 'ct-1',
          event_type: 'open',
          url_clicked: null,
          is_machine_open: false,
        },
      },
      {
        body: {
          campaign_id: 'cmp-1',
          contact_id: 'ct-2',
          event_type: 'click',
          url_clicked: 'https://kura.app',
          is_machine_open: false,
        },
      },
    ]);

    await processTrackingQueue(batch as never, env);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith([
      {
        campaignId: 'cmp-1',
        contactId: 'ct-1',
        eventType: 'open',
        urlClicked: null,
        isMachineOpen: false,
        sesMessageId: null,
      },
      {
        campaignId: 'cmp-1',
        contactId: 'ct-2',
        eventType: 'click',
        urlClicked: 'https://kura.app',
        isMachineOpen: false,
        sesMessageId: null,
      },
    ]);
    expect((batch as { ackAll: ReturnType<typeof vi.fn> }).ackAll).toHaveBeenCalledTimes(1);
    expect((batch as { retryAll: ReturnType<typeof vi.fn> }).retryAll).not.toHaveBeenCalled();
  });

  it('hace retryAll si el INSERT falla', async () => {
    const { db } = createMockDb();
    (db as { insert: ReturnType<typeof vi.fn> }).insert = vi.fn(() => ({
      values: vi.fn().mockRejectedValue(new Error('db down')),
    }));
    mockGetDb.mockReturnValue(db);

    const batch = makeBatch([
      {
        body: {
          campaign_id: 'cmp-1',
          contact_id: 'ct-1',
          event_type: 'open',
          url_clicked: null,
          is_machine_open: false,
        },
      },
    ]);

    await processTrackingQueue(batch as never, env);

    expect((batch as { ackAll: ReturnType<typeof vi.fn> }).ackAll).not.toHaveBeenCalled();
    expect((batch as { retryAll: ReturnType<typeof vi.fn> }).retryAll).toHaveBeenCalledTimes(1);
  });

  it('en un bounce actualiza contacts y añade a suppression_list', async () => {
    const { db, valuesMock, updateSet } = createMockDb({
      contact: { id: 'ct-1', userId: 'usr-1', email: 'bounced@example.com' },
    });
    mockGetDb.mockReturnValue(db);

    const batch = makeBatch([
      {
        body: {
          campaign_id: 'cmp-1',
          contact_id: 'ct-1',
          event_type: 'bounce',
          url_clicked: null,
          is_machine_open: false,
          ses_message_id: 'ses-1',
        },
      },
    ]);

    await processTrackingQueue(batch as never, env);

    expect(updateSet).toHaveBeenCalledWith({ status: 'bounced' });
    expect(valuesMock).toHaveBeenCalledWith({
      userId: 'usr-1',
      email: 'bounced@example.com',
      reason: 'bounce',
      sourceCampaignId: 'cmp-1',
    });
    expect((batch as { ackAll: ReturnType<typeof vi.fn> }).ackAll).toHaveBeenCalledTimes(1);
  });

  it('en un complaint actualiza contacts a complained y suprime la queja', async () => {
    const { db, valuesMock, updateSet } = createMockDb({
      contact: { id: 'ct-9', userId: 'usr-9', email: 'spam@example.com' },
    });
    mockGetDb.mockReturnValue(db);

    const batch = makeBatch([
      {
        body: {
          campaign_id: 'cmp-9',
          contact_id: 'ct-9',
          event_type: 'complaint',
          url_clicked: null,
          is_machine_open: false,
          ses_message_id: null,
        },
      },
    ]);

    await processTrackingQueue(batch as never, env);

    expect(updateSet).toHaveBeenCalledWith({ status: 'complained' });
    expect(valuesMock).toHaveBeenCalledWith({
      userId: 'usr-9',
      email: 'spam@example.com',
      reason: 'complaint',
      sourceCampaignId: 'cmp-9',
    });
  });
});
