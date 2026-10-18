import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client';
import { handleImportContacts, handleListContacts } from '../src/handlers/contacts';
import { contacts, suppressionList } from '../src/db/schema';

const mockGetDb = vi.mocked(getDb);

interface FakeContact {
  id: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  createdAt: Date;
}

interface FakeSuppression {
  userId: string;
  email: string;
}

interface FakeState {
  contacts: FakeContact[];
  suppressed: FakeSuppression[];
}

function createEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    MAX_TRIAL_SENDS: '50',
    DATABASE_URL: 'postgres://test',
  } as unknown as Env;
}

/* -------------------------------------------------------------------------- */
/* Introspección mínima de las condiciones Drizzle                            */
/* -------------------------------------------------------------------------- */

function findUserId(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;

  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return null;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i] as Record<string, unknown> | null;

    if (chunk && chunk.name === 'user_id') {
      for (let j = i + 1; j < chunks.length; j += 1) {
        const next = chunks[j] as Record<string, unknown> | null;
        if (next && typeof next.value === 'string') return next.value;
      }
    }

    const nested = findUserId(chunk);
    if (nested) return nested;
  }

  return null;
}

function findSearchPattern(node: unknown): string | null {
  if (typeof node === 'string') {
    return node.startsWith('%') && node.endsWith('%') ? node.slice(1, -1) : null;
  }
  if (!node || typeof node !== 'object') return null;

  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return null;

  for (const chunk of chunks) {
    const found = findSearchPattern(chunk);
    if (found !== null) return found;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Mock de DB en memoria con aislamiento por user_id                          */
/* -------------------------------------------------------------------------- */

function createContactsDb(state: FakeState) {
  let sequence = 0;
  const insertedBatches: Array<Array<Record<string, unknown>>> = [];

  const select = (selection?: Record<string, unknown>) => {
    let table: unknown;
    let condition: unknown;
    let limitValue: number | null = null;
    let offsetValue = 0;

    const resolve = (): unknown[] => {
      const userId = findUserId(condition);
      const search = findSearchPattern(condition);

      if (table === contacts) {
        const filtered = state.contacts
          .filter((contact) => !userId || contact.userId === userId)
          .filter((contact) => {
            if (!search) return true;
            const haystack = `${contact.email} ${contact.firstName ?? ''} ${contact.lastName ?? ''}`.toLowerCase();
            return haystack.includes(search.toLowerCase());
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        if (selection && 'count' in selection) {
          return [{ count: filtered.length }];
        }

        const start = offsetValue;
        const end =
          limitValue === null ? undefined : start + limitValue;
        return filtered.slice(start, end);
      }

      if (table === suppressionList) {
        return state.suppressed
          .filter((entry) => !userId || entry.userId === userId)
          .map((entry) => ({ email: entry.email }));
      }

      return [];
    };

    const chain = {
      from: (nextTable: unknown) => {
        table = nextTable;
        return chain;
      },
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

  const insert = (table: unknown) => ({
    values: (values: Array<Record<string, unknown>>) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          if (table !== contacts) return [];
          insertedBatches.push(values);

          const inserted: Array<{ id: string }> = [];
          for (const value of values) {
            const userId = String(value.userId);
            const email = String(value.email).toLowerCase();
            const exists = state.contacts.some(
              (contact) => contact.userId === userId && contact.email.toLowerCase() === email
            );
            if (exists) continue;

            sequence += 1;
            state.contacts.push({
              id: `ct-${sequence}`,
              userId,
              email,
              firstName: (value.firstName as string | null) ?? null,
              lastName: (value.lastName as string | null) ?? null,
              status: String(value.status ?? 'active'),
              createdAt: new Date(Date.now() + sequence),
            });
            inserted.push({ id: `ct-${sequence}` });
          }

          return inserted;
        },
      }),
    }),
  });

  return { db: { select, insert } as never, insertedBatches };
}

function csvRequest(csv: string): Request {
  return new Request('http://localhost/api/contacts/import', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv,
  });
}

function listRequest(query = ''): Request {
  return new Request(`http://localhost/api/contacts${query}`, { method: 'GET' });
}

beforeEach(() => {
  mockGetDb.mockReset();
});

describe('POST /api/contacts/import', () => {
  it('importa un CSV válido y devuelve los contadores correctos', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    const mock = createContactsDb(state);
    mockGetDb.mockReturnValue(mock.db);

    const csv = [
      'email,first_name,last_name',
      'ana@example.com,Ana,Pérez',
      'bruno@example.com,Bruno,',
    ].join('\n');

    const response = await handleImportContacts(csvRequest(csv), createEnv(), 'usr-1');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      imported: 2,
      duplicates: 0,
      invalid: 0,
      suppressed: 0,
      total_rows: 2,
    });
    expect(state.contacts).toHaveLength(2);
    expect(state.contacts.every((contact) => contact.userId === 'usr-1')).toBe(true);
    expect(state.contacts.every((contact) => contact.status === 'active')).toBe(true);
  });

  it('deduplica al reimportar el mismo CSV', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    const mock = createContactsDb(state);
    mockGetDb.mockReturnValue(mock.db);
    const csv = 'email,first_name,last_name\na@example.com,Ana,Pérez\nb@example.com,Bruno,Ruiz';

    await handleImportContacts(csvRequest(csv), createEnv(), 'usr-1');
    const response = await handleImportContacts(csvRequest(csv), createEnv(), 'usr-1');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      imported: 0,
      duplicates: 2,
      invalid: 0,
      suppressed: 0,
      total_rows: 2,
    });
    expect(state.contacts).toHaveLength(2);
  });

  it('cuenta como invalid las filas con email inválido', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    mockGetDb.mockReturnValue(createContactsDb(state).db);

    const csv = [
      'email,first_name,last_name',
      'no-es-un-email,Ana,Pérez',
      'ok@example.com,Bruno,Ruiz',
    ].join('\n');

    const response = await handleImportContacts(csvRequest(csv), createEnv(), 'usr-1');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ imported: 1, invalid: 1, duplicates: 0, total_rows: 2 });
  });

  it('excluye emails presentes en suppression_list', async () => {
    const state: FakeState = {
      contacts: [],
      suppressed: [{ userId: 'usr-1', email: 'bloqueado@example.com' }],
    };
    mockGetDb.mockReturnValue(createContactsDb(state).db);

    const csv = [
      'email,first_name,last_name',
      'bloqueado@example.com,Bloqueado,Test',
      'nuevo@example.com,Nuevo,Contacto',
    ].join('\n');

    const response = await handleImportContacts(csvRequest(csv), createEnv(), 'usr-1');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ imported: 1, suppressed: 1, duplicates: 0, total_rows: 2 });
    expect(state.contacts.map((contact) => contact.email)).toEqual(['nuevo@example.com']);
  });

  it('devuelve 400 si falta la columna email', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    mockGetDb.mockReturnValue(createContactsDb(state).db);

    const response = await handleImportContacts(
      csvRequest('nombre,apellido\nAna,Pérez'),
      createEnv(),
      'usr-1'
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('MISSING_EMAIL_COLUMN');
  });

  it('devuelve 413 si el CSV supera 10.000 filas', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    mockGetDb.mockReturnValue(createContactsDb(state).db);

    const rows = ['email,first_name,last_name'];
    for (let i = 0; i < 10_001; i += 1) {
      rows.push(`user${i}@example.com,User,${i}`);
    }

    const response = await handleImportContacts(
      csvRequest(rows.join('\n')),
      createEnv(),
      'usr-1'
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(body.error.code).toBe('TOO_MANY_ROWS');
  });

  it('acepta encabezados flexibles y separador punto y coma', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    mockGetDb.mockReturnValue(createContactsDb(state).db);

    const csv = [
      'CORREO;NOMBRE;APELLIDO',
      'ana@example.com;Ana;Pérez',
      '"bruno@example.com";"Bruno";"Ruiz, Jr."',
    ].join('\n');

    const response = await handleImportContacts(csvRequest(csv), createEnv(), 'usr-1');
    const body = (await response.json()) as { imported: number };

    expect(response.status).toBe(200);
    expect(body.imported).toBe(2);
    expect(state.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: 'ana@example.com',
          firstName: 'Ana',
          lastName: 'Pérez',
        }),
        expect.objectContaining({
          email: 'bruno@example.com',
          firstName: 'Bruno',
          lastName: 'Ruiz, Jr.',
        }),
      ])
    );
  });

  it('acepta el encabezado EMAIL en mayúsculas', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    mockGetDb.mockReturnValue(createContactsDb(state).db);

    const response = await handleImportContacts(
      csvRequest('EMAIL,first_name,last_name\nok@example.com,Ok,Test'),
      createEnv(),
      'usr-1'
    );
    const body = (await response.json()) as { imported: number };

    expect(response.status).toBe(200);
    expect(body.imported).toBe(1);
  });
});

describe('GET /api/contacts', () => {
  it('aísla los contactos por tenant (el usuario B no ve los del usuario A)', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    const mock = createContactsDb(state);
    mockGetDb.mockReturnValue(mock.db);

    await handleImportContacts(
      csvRequest('email,first_name,last_name\na@example.com,Ana,Pérez'),
      createEnv(),
      'usr-A'
    );

    const response = await handleListContacts(listRequest(), createEnv(), 'usr-B');
    const body = (await response.json()) as {
      total: number;
      contacts: unknown[];
      page: number;
      limit: number;
    };

    expect(response.status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.contacts).toEqual([]);
    expect(body).toMatchObject({ page: 1, limit: 25 });
  });

  it('lista los contactos del tenant con paginación y búsqueda', async () => {
    const state: FakeState = { contacts: [], suppressed: [] };
    const mock = createContactsDb(state);
    mockGetDb.mockReturnValue(mock.db);

    await handleImportContacts(
      csvRequest(
        [
          'email,first_name,last_name',
          'ana@example.com,Ana,Pérez',
          'bruno@example.com,Bruno,Ruiz',
          'carla@otro.com,Carla,Soto',
        ].join('\n')
      ),
      createEnv(),
      'usr-1'
    );

    const page = await handleListContacts(
      listRequest('?page=1&limit=2'),
      createEnv(),
      'usr-1'
    );
    const pageBody = (await page.json()) as {
      total: number;
      contacts: Array<{ email: string }>;
    };
    expect(page.status).toBe(200);
    expect(pageBody.total).toBe(3);
    expect(pageBody.contacts).toHaveLength(2);

    const search = await handleListContacts(
      listRequest('?search=bruno'),
      createEnv(),
      'usr-1'
    );
    const searchBody = (await search.json()) as {
      total: number;
      contacts: Array<{ email: string }>;
    };
    expect(searchBody.total).toBe(1);
    expect(searchBody.contacts[0].email).toBe('bruno@example.com');
  });
});
