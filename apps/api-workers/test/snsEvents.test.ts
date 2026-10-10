import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client';
import { handleSnsWebhook } from '../src/handlers/webhooks/snsEvents';

const mockGetDb = vi.mocked(getDb);

function createEnv() {
  const sendBatch = vi.fn().mockResolvedValue(undefined);
  const env = {
    ENVIRONMENT: 'development',
    TRACKING_QUEUE: { sendBatch },
  } as unknown as Env;
  return { env, sendBatch };
}

/**
 * Mock de idempotencia: `returning()` devuelve primero la fila insertada y
 * luego vacío, para simular el `ON CONFLICT DO NOTHING` en el segundo intento.
 */
function createMockDb(returningResults: Array<Array<{ id: string }>>) {
  const returning = vi.fn();
  for (const result of returningResults) returning.mockResolvedValueOnce(result);

  const insert = vi.fn(() => ({
    values: () => ({ onConflictDoNothing: () => ({ returning }) }),
  }));
  const del = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const select = vi.fn(() => {
    const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve([]) };
    return chain;
  });

  return { db: { insert, delete: del, select } as never, insert, returning };
}

function notification(messageId: string) {
  const message = {
    eventType: 'Bounce',
    mail: {
      messageId: 'ses-1',
      destination: ['bounced@example.com'],
      tags: { kura_campaign_id: ['cmp-1'], kura_contact_id: ['ct-1'] },
    },
    bounce: {
      bounceType: 'Permanent',
      bouncedRecipients: [{ emailAddress: 'bounced@example.com' }],
    },
  };
  return {
    Type: 'Notification',
    MessageId: messageId,
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:kura-ses-events',
    Timestamp: '2026-10-10T00:00:00.000Z',
    Message: JSON.stringify(message),
  };
}

function post(body: unknown): Request {
  return new Request('http://localhost/webhooks/sns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleSnsWebhook', () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it('un Notification de bounce se encola como evento de tracking', async () => {
    mockGetDb.mockReturnValue(createMockDb([[{ id: 'wh-1' }]]).db);
    const { env, sendBatch } = createEnv();

    const response = await handleSnsWebhook(post(notification('sns-1')), env);
    const body = (await response.json()) as { ok: boolean; enqueued: number };

    expect(response.status).toBe(200);
    expect(body.enqueued).toBe(1);
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch).toHaveBeenCalledWith([
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
  });

  it('es idempotente al repetir el mismo MessageId', async () => {
    mockGetDb.mockReturnValue(createMockDb([[{ id: 'wh-1' }], []]).db);
    const { env, sendBatch } = createEnv();

    const first = await handleSnsWebhook(post(notification('sns-dup')), env);
    const second = await handleSnsWebhook(post(notification('sns-dup')), env);
    const secondBody = (await second.json()) as { duplicate: boolean };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody.duplicate).toBe(true);
    expect(sendBatch).toHaveBeenCalledTimes(1);
  });

  it('registra la SubscribeURL de SubscriptionConfirmation sin encolar', async () => {
    const { env, sendBatch } = createEnv();

    const response = await handleSnsWebhook(
      post({
        Type: 'SubscriptionConfirmation',
        MessageId: 'sns-sub-1',
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:kura-ses-events',
        Timestamp: '2026-10-10T00:00:00.000Z',
        Token: 'token-1',
        SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=token-1',
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(sendBatch).not.toHaveBeenCalled();
  });
});
