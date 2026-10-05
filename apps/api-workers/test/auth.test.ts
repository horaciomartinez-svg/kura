import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

// Aísla el middleware: no se toca la base de datos real ni AWS SES.
vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));
vi.mock('../src/queues/emailConsumer', () => ({ processEmailQueue: vi.fn() }));

import { authenticateRequest, isPublicPath, resetAuthCache } from '../src/middleware/auth';
import worker from '../src/index';

const SUPABASE_URL = 'https://test.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

const env = {
  ENVIRONMENT: 'test',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  MAX_TRIAL_SENDS: '50',
  SUPABASE_URL,
} as unknown as Env;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function segment(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey & Record<string, unknown>;

async function signToken(payload: Record<string, unknown>): Promise<string> {
  const header = segment({ alg: 'ES256', typ: 'JWT', kid: 'test-key' });
  const body = segment(payload);
  const data = new TextEncoder().encode(`${header}.${body}`);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    data
  );
  return `${header}.${body}.${toBase64Url(new Uint8Array(signature))}`;
}

function withToken(token: string): Request {
  return new Request('http://localhost/api/campaigns/cmp-1/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;

  publicJwk = (await crypto.subtle.exportKey(
    'jwk',
    keyPair.publicKey
  )) as unknown as JsonWebKey & Record<string, unknown>;
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';
});

beforeEach(() => {
  resetAuthCache();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authenticateRequest', () => {
  it('acepta un token válido verificado contra el JWKS', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({
      sub: 'user-123',
      aud: 'authenticated',
      iss: ISSUER,
      exp: now + 3600,
      email: 'user@example.com',
    });

    const result = await authenticateRequest(withToken(token), env);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe('user-123');
      expect(result.user.email).toBe('user@example.com');
    }
  });

  it('rechaza con 401 un token expirado', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({
      sub: 'user-123',
      aud: 'authenticated',
      iss: ISSUER,
      exp: now - 10,
    });

    const result = await authenticateRequest(withToken(token), env);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = (await result.response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('rechaza con 401 una petición sin header Authorization', async () => {
    const request = new Request('http://localhost/api/campaigns/cmp-1/send', { method: 'POST' });

    const result = await authenticateRequest(request, env);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = (await result.response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('rechaza con 401 un token con audience distinta a authenticated', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({
      sub: 'user-123',
      aud: 'anon',
      iss: ISSUER,
      exp: now + 3600,
    });

    const result = await authenticateRequest(withToken(token), env);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});

describe('rutas públicas', () => {
  it('no exige token en las rutas públicas de §8.1', () => {
    expect(isPublicPath('/health')).toBe(true);
    expect(isPublicPath('/o/abc.gif')).toBe(true);
    expect(isPublicPath('/c/abc')).toBe(true);
    expect(isPublicPath('/u/abc')).toBe(true);
    expect(isPublicPath('/webhooks/sns')).toBe(true);
    expect(isPublicPath('/api/campaigns/cmp-1/send')).toBe(false);
  });

  it('deja pasar el healthcheck sin token a través del Worker', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/health'),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
  });
});
