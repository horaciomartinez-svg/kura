import { getDb } from '../db/client';
import { assets } from '../db/schema';
import type { Env } from '../types/env';

/**
 * Assets del editor (§12.5).
 *
 * POST /api/assets  -> subida autenticada (multipart) a Cloudflare R2.
 * GET  /api/assets/:key -> servido público del binario (solo desarrollo).
 */

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB (§12.5)
const ASSETS_PREFIX = 'assets/';

interface ImageType {
  mime: string;
  ext: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

/** Guarda estructural para el archivo recibido en el FormData. */
function isFileLike(
  value: unknown
): value is { arrayBuffer: () => Promise<ArrayBuffer>; size: number; type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function' &&
    typeof (value as { size?: unknown }).size === 'number'
  );
}

/** Compara una secuencia de bytes al inicio del buffer. */
function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Detecta el tipo real de la imagen por magic bytes (§14: validación MIME real).
 * Solo se aceptan png/jpeg/gif/webp.
 */
function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  // WEBP: contenedor RIFF con marca WEBP en el byte 8.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Construye la URL pública del asset (CDN en producción, §12.5). */
function buildPublicUrl(request: Request, env: Env, key: string): string {
  if (env.PUBLIC_ASSETS_URL) {
    return `${env.PUBLIC_ASSETS_URL.replace(/\/$/, '')}/${key}`;
  }
  // TODO(prod): sustituir por el dominio CDN cdn.kura.app cuando el bucket
  // kura-assets tenga un custom domain configurado. En dev sirve el Worker.
  return `${new URL(request.url).origin}/api/assets/${key}`;
}

/**
 * POST /api/assets
 * Recibe multipart/form-data con el campo `file`, valida y guarda en R2.
 * El user_id proviene del JWT verificado (nunca del cliente, §12.2).
 */
export async function handleUploadAsset(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return error('INVALID_FORM_DATA', 'Se esperaba multipart/form-data.', 400);
  }

  const entry = formData.get('file');
  if (!isFileLike(entry)) {
    return error('MISSING_FILE', 'Falta el archivo en el campo "file".', 400);
  }

  if (entry.size === 0) {
    return error('EMPTY_FILE', 'El archivo está vacío.', 400);
  }

  if (entry.size > MAX_UPLOAD_BYTES) {
    return error('FILE_TOO_LARGE', 'La imagen supera el máximo de 5 MB.', 413);
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  const imageType = detectImageType(bytes);
  if (!imageType) {
    return error(
      'UNSUPPORTED_MEDIA_TYPE',
      'Formato no permitido. Solo se aceptan PNG, JPEG, GIF o WEBP.',
      415
    );
  }

  const key = `${ASSETS_PREFIX}${userId}/${crypto.randomUUID()}.${imageType.ext}`;
  const publicUrl = buildPublicUrl(request, env, key);

  try {
    await env.KURA_ASSETS.put(key, bytes, {
      httpMetadata: { contentType: imageType.mime },
    });

    const db = getDb(env);
    await db.insert(assets).values({
      userId,
      r2Key: key,
      publicUrl,
      contentType: imageType.mime,
      sizeBytes: bytes.byteLength,
    });
  } catch (err) {
    console.error('No se pudo guardar el asset:', err);
    // Limpieza best-effort del objeto huérfano en R2.
    try {
      await env.KURA_ASSETS.delete(key);
    } catch {
      // Ignorar: el objeto pudo no haberse creado.
    }
    return error('INTERNAL_ERROR', 'No se pudo guardar la imagen.', 500);
  }

  return json(
    {
      public_url: publicUrl,
      key,
      content_type: imageType.mime,
      size_bytes: bytes.byteLength,
    },
    201
  );
}

/**
 * GET /api/assets/:key
 * Sirve el asset desde el Worker (público). Cabeceras de caché inmutables.
 */
export async function handleGetAsset(request: Request, env: Env): Promise<Response> {
  const key = decodeURIComponent(new URL(request.url).pathname.slice('/api/assets/'.length));

  // Evita rutas malformadas o intentos de path traversal.
  if (!key || key.includes('..') || !key.startsWith(ASSETS_PREFIX)) {
    return new Response('Not Found', { status: 404 });
  }

  const object = await env.KURA_ASSETS.get(key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
}
