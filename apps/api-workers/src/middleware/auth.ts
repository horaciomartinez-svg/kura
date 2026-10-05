import type { Env } from '../types/env';

/**
 * Middleware de autenticación (Edge) — supabase Auth.
 *
 * Verifica el JWT del header `Authorization: Bearer <token>` contra el JWKS
 * público de Supabase (ES256/RS256), con fallback a HS256 vía
 * SUPABASE_JWT_SECRET para proyectos legacy. El JWKS se cachea en memoria del
 * isolate y, si existe el binding KV, en KURA_KV con TTL de 1 hora (§12.1).
 */

export interface SupabaseClaims {
  sub: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export interface AuthUser {
  id: string;
  email?: string;
  claims: SupabaseClaims;
}

export interface AuthSuccess {
  ok: true;
  user: AuthUser;
}

export interface AuthFailure {
  ok: false;
  response: Response;
}

export type AuthResult = AuthSuccess | AuthFailure;

interface JwksKey extends JsonWebKey {
  kid?: string;
}

interface Jwks {
  keys: JwksKey[];
}

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hora
const ALLOWED_JWKS_ALGS = new Set(['ES256', 'ES384', 'ES512', 'RS256', 'RS384', 'RS512']);
const AUTHENTICATED_AUDIENCE = 'authenticated';

// Caché en memoria por isolate.
let jwksCache: { url: string; keys: JwksKey[]; fetchedAt: number } | null = null;

/** Limpia la caché del JWKS (usado en pruebas). */
export function resetAuthCache(): void {
  jwksCache = null;
}

/** Rutas públicas que no exigen JWT (§8.1). */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/health' ||
    pathname.startsWith('/o/') ||
    pathname.startsWith('/c/') ||
    pathname.startsWith('/u/') ||
    pathname.startsWith('/webhooks/')
  );
}

function unauthorized(message: string): AuthFailure {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  };
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
}

function jwksUrl(env: Env): string {
  return `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
}

/** Obtiene el JWKS con caché de isolate (+ KV opcional). */
async function getJwks(env: Env): Promise<JwksKey[]> {
  const url = jwksUrl(env);

  if (jwksCache && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  if (env.KURA_KV) {
    const cached = (await env.KURA_KV.get(url, 'json')) as Jwks | null;
    if (cached?.keys?.length) {
      jwksCache = { url, keys: cached.keys, fetchedAt: Date.now() };
      return cached.keys;
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo obtener el JWKS de Supabase (${response.status}).`);
  }

  const jwks = (await response.json()) as Jwks;
  if (!jwks.keys?.length) {
    throw new Error('El JWKS de Supabase está vacío.');
  }

  if (env.KURA_KV) {
    await env.KURA_KV.put(url, JSON.stringify(jwks), { expirationTtl: 3600 });
  }

  jwksCache = { url, keys: jwks.keys, fetchedAt: Date.now() };
  return jwks.keys;
}

async function importVerificationKey(key: JwksKey): Promise<CryptoKey> {
  if (key.kty === 'EC') {
    return crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'ECDSA', namedCurve: key.crv ?? 'P-256' },
      false,
      ['verify']
    );
  }

  if (key.kty === 'RSA') {
    return crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  }

  throw new Error(`Tipo de clave JWKS no soportado: ${key.kty}`);
}

type VerifyAlgorithm = Parameters<SubtleCrypto['verify']>[0];

function verifyAlgorithm(key: JwksKey): VerifyAlgorithm {
  return key.kty === 'EC'
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5' };
}

async function verifyWithJwks(token: string, env: Env): Promise<SupabaseClaims | null> {
  const [headerB64, payloadB64, signatureB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  const header = decodeJsonSegment<{ alg?: string; kid?: string }>(headerB64);
  if (!header.alg || !ALLOWED_JWKS_ALGS.has(header.alg)) return null;

  const keys = await getJwks(env);
  const candidates = header.kid ? keys.filter((key) => key.kid === header.kid) : keys;
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);

  for (const key of candidates) {
    try {
      const cryptoKey = await importVerificationKey(key);
      const valid = await crypto.subtle.verify(
        verifyAlgorithm(key),
        cryptoKey,
        signature,
        data
      );
      if (valid) return decodeJsonSegment<SupabaseClaims>(payloadB64);
    } catch {
      // Clave incompatible; se intenta con la siguiente.
    }
  }

  return null;
}

/** Fallback HS256 para proyectos legacy. */
async function verifyWithSecret(
  token: string,
  secret: string
): Promise<SupabaseClaims | null> {
  const [headerB64, payloadB64, signatureB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  const header = decodeJsonSegment<{ alg?: string }>(headerB64);
  if (header.alg !== 'HS256') return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );

  return valid ? decodeJsonSegment<SupabaseClaims>(payloadB64) : null;
}

/** Valida exp, audience 'authenticated', issuer y sub (§12.1). */
function validateClaims(claims: SupabaseClaims, env: Env): boolean {
  const now = Math.floor(Date.now() / 1000);

  if (typeof claims.exp !== 'number' || claims.exp < now) return false;

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(AUTHENTICATED_AUDIENCE)) return false;

  const expectedIssuer = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  if (claims.iss !== expectedIssuer) return false;

  return Boolean(claims.sub);
}

/**
 * Autentica una petición. Devuelve el usuario o una respuesta 401 estándar
 * `{ error: { code: 'UNAUTHORIZED', message } }`.
 */
export async function authenticateRequest(request: Request, env: Env): Promise<AuthResult> {
  const header = request.headers.get('Authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return unauthorized('Falta el encabezado Authorization: Bearer <token>.');
  }

  try {
    let claims = await verifyWithJwks(token, env);

    if (!claims && env.SUPABASE_JWT_SECRET) {
      claims = await verifyWithSecret(token, env.SUPABASE_JWT_SECRET);
    }

    if (!claims || !validateClaims(claims, env)) {
      return unauthorized('Token inválido o expirado.');
    }

    return { ok: true, user: { id: claims.sub, email: claims.email, claims } };
  } catch (err) {
    console.error('Error verificando el JWT:', err);
    return unauthorized('No se pudo verificar el token.');
  }
}
