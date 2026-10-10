import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

// Aísla el Worker: no se toca la base de datos real ni AWS SES.
vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));
vi.mock('../src/queues/emailConsumer', () => ({ processEmailQueue: vi.fn() }));

import { resetAuthCache } from '../src/middleware/auth';
import worker from '../src/index';

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    MAX_TRIAL_SENDS: '50',
    SUPABASE_URL: 'https://test.supabase.co',
    ...overrides,
  } as unknown as Env;
}

const ctx = {} as ExecutionContext;

beforeEach(() => {
  resetAuthCache();
  vi.stubGlobal('fetch', vi.fn());
});

describe('CORS en /api/*', () => {
  it('responde 204 al preflight OPTIONS de /api/campaigns/x/compile con cabeceras CORS', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/campaigns/x/compile', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type, authorization',
        },
      }),
      createEnv(),
      ctx
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toMatch(/Content-Type/i);
    expect(response.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/i);
  });

  it('incluye cabeceras CORS en el 401 de un PUT sin JWT', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/campaigns/x/compile', {
        method: 'PUT',
        headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ design_json: {}, html_content: '<html></html>' }),
      }),
      createEnv(),
      ctx
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(response.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/i);
  });

  it('permite cualquier puerto de localhost en desarrollo', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/campaigns/x/compile', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:4321' },
      }),
      createEnv(),
      ctx
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4321');
  });

  it('en producción solo permite el dominio oficial de APP_ORIGIN', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/api/campaigns/x/compile', {
        method: 'OPTIONS',
        headers: { Origin: 'http://evil.example' },
      }),
      createEnv({ ENVIRONMENT: 'production', APP_ORIGIN: 'https://app.kura.app' }),
      ctx
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.kura.app');
  });
});
