import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types/env';

// Aísla el handler de la base de datos real: getDb se reemplaza por un mock.
vi.mock('../src/db/client', () => ({ getDb: vi.fn() }));

import { getDb } from '../src/db/client';
import { handleGetAsset, handleUploadAsset } from '../src/handlers/assets';
import worker from '../src/index';

const mockGetDb = vi.mocked(getDb);

function createMockDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  return { insert: () => ({ values }) };
}

interface MockR2 {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function createEnv(): { env: Env; r2: MockR2 } {
  const r2: MockR2 = {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  };
  const env = {
    ENVIRONMENT: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    MAX_TRIAL_SENDS: '50',
    DATABASE_URL: 'postgres://test',
    SUPABASE_URL: 'https://test.supabase.co',
    SENDING_QUEUE: {},
    TRACKING_QUEUE: {},
    KURA_ASSETS: r2,
  } as unknown as Env;
  return { env, r2 };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function uploadRequest(bytes: Uint8Array, type: string, name = 'imagen.png'): Request {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return new Request('http://localhost/api/assets', { method: 'POST', body: form });
}

describe('handleUploadAsset', () => {
  beforeEach(() => {
    mockGetDb.mockReset();
    mockGetDb.mockReturnValue(createMockDb() as never);
  });

  it('rechaza un archivo sin magic bytes de imagen (415)', async () => {
    const { env, r2 } = createEnv();
    const textBytes = new TextEncoder().encode('esto no es una imagen');

    const response = await handleUploadAsset(
      uploadRequest(textBytes, 'image/png'),
      env,
      'user-1'
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(415);
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(r2.put).not.toHaveBeenCalled();
  });

  it('rechaza una imagen de más de 5 MB (413)', async () => {
    const { env, r2 } = createEnv();
    const tooLarge = new Uint8Array(5 * 1024 * 1024 + 1);
    tooLarge.set(PNG_BYTES.subarray(0, 8));

    const response = await handleUploadAsset(uploadRequest(tooLarge, 'image/png'), env, 'user-1');
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(body.error.code).toBe('FILE_TOO_LARGE');
    expect(r2.put).not.toHaveBeenCalled();
  });

  it('acepta una imagen válida y devuelve public_url + guarda en R2', async () => {
    const { env, r2 } = createEnv();

    const response = await handleUploadAsset(uploadRequest(PNG_BYTES, 'image/png'), env, 'user-1');
    const body = (await response.json()) as {
      public_url: string;
      key: string;
      content_type: string;
    };

    expect(response.status).toBe(201);
    expect(body.content_type).toBe('image/png');
    expect(body.key).toMatch(/^assets\/user-1\/[0-9a-f-]+\.png$/);
    expect(body.public_url).toBe(`http://localhost/api/assets/${body.key}`);
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(r2.put.mock.calls[0][0]).toBe(body.key);
  });
});

describe('handleGetAsset', () => {
  it('devuelve 404 si el objeto no existe en R2', async () => {
    const { env } = createEnv();

    const response = await handleGetAsset(
      new Request('http://localhost/api/assets/assets/user-1/x.png'),
      env
    );

    expect(response.status).toBe(404);
  });

  it('sirve el asset con content-type y caché inmutable', async () => {
    const { env, r2 } = createEnv();
    const headers = new Headers({ 'Content-Type': 'image/png' });
    r2.get.mockResolvedValue({
      body: PNG_BYTES,
      httpEtag: 'etag-1',
      writeHttpMetadata: (target: Headers) => target.set('Content-Type', 'image/png'),
    });

    const response = await handleGetAsset(
      new Request('http://localhost/api/assets/assets/user-1/x.png'),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    void headers;
  });
});

describe('POST /api/assets sin autenticación', () => {
  it('devuelve 401 si no hay JWT', async () => {
    const { env } = createEnv();
    const form = new FormData();
    form.append('file', new File([PNG_BYTES], 'x.png', { type: 'image/png' }));

    const response = await worker.fetch(
      new Request('http://localhost/api/assets', { method: 'POST', body: form }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(401);
  });
});
