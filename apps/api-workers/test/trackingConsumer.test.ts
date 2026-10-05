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

describe('processTrackingQueue', () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it('inserta los eventos en un único bulk parametrizado y hace ackAll', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    mockGetDb.mockReturnValue({ insert } as never);

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
    expect(values).toHaveBeenCalledWith([
      {
        campaignId: 'cmp-1',
        contactId: 'ct-1',
        eventType: 'open',
        urlClicked: null,
        isMachineOpen: false,
      },
      {
        campaignId: 'cmp-1',
        contactId: 'ct-2',
        eventType: 'click',
        urlClicked: 'https://kura.app',
        isMachineOpen: false,
      },
    ]);
    expect((batch as { ackAll: ReturnType<typeof vi.fn> }).ackAll).toHaveBeenCalledTimes(1);
    expect((batch as { retryAll: ReturnType<typeof vi.fn> }).retryAll).not.toHaveBeenCalled();
  });

  it('hace retryAll si el INSERT falla', async () => {
    const values = vi.fn().mockRejectedValue(new Error('db down'));
    const insert = vi.fn(() => ({ values }));
    mockGetDb.mockReturnValue({ insert } as never);

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
});
