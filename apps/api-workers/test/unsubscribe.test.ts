import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client';
import { handleUnsubscribe } from '../src/handlers/unsubscribe';
import { signTrackingPayload } from '../src/services/trackingTokens';

const mockGetDb = vi.mocked(getDb);

const SECRET = 'test-tracking-secret';
const env = { TRACKING_HMAC_SECRET: SECRET } as unknown as Env;

const payload = {
  campaignId: '11111111-1111-1111-1111-111111111111',
  contactId: '22222222-2222-2222-2222-222222222222',
  userId: '33333333-3333-3333-3333-333333333333',
};

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

  return { db: { insert, select, update } as never, valuesMock, updateSet };
}

function request(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

describe('handleUnsubscribe', () => {
  beforeEach(() => {
    mockGetDb.mockReset();
  });

  it('con token válido marca el contacto y lo añade a suppression_list', async () => {
    const { db, valuesMock, updateSet } = createMockDb({
      contact: { id: payload.contactId, email: 'user@example.com' },
    });
    mockGetDb.mockReturnValue(db);

    const token = await signTrackingPayload(payload, SECRET);
    const response = await handleUnsubscribe(request(`/u/${token}`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');

    expect(updateSet).toHaveBeenCalledWith({ status: 'unsubscribed' });
    expect(valuesMock).toHaveBeenCalledWith({
      userId: payload.userId,
      email: 'user@example.com',
      reason: 'unsubscribe',
      sourceCampaignId: payload.campaignId,
    });
    expect(valuesMock).toHaveBeenCalledWith({
      campaignId: payload.campaignId,
      contactId: payload.contactId,
      eventType: 'unsubscribe',
    });
  });

  it('con token adulterado responde 400 sin tocar la base de datos', async () => {
    const { db, valuesMock, updateSet } = createMockDb({
      contact: { id: payload.contactId, email: 'user@example.com' },
    });
    mockGetDb.mockReturnValue(db);

    const token = await signTrackingPayload(payload, SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    const response = await handleUnsubscribe(request(`/u/${tampered}`), env);

    expect(response.status).toBe(400);
    expect(updateSet).not.toHaveBeenCalled();
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it('responde 404 si el contacto no pertenece al usuario firmado', async () => {
    const { db, updateSet } = createMockDb();
    mockGetDb.mockReturnValue(db);

    const token = await signTrackingPayload(payload, SECRET);
    const response = await handleUnsubscribe(request(`/u/${token}`), env);

    expect(response.status).toBe(404);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
