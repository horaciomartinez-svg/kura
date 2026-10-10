/**
 * Firma y verificación de tokens de tracking con HMAC-SHA256 (§11.1).
 *
 * Formato del token: `<base64url(json)>.<base64url(hmac)>`, donde el HMAC se
 * calcula sobre el segmento base64url del JSON con la clave
 * `TRACKING_HMAC_SECRET`. Evita que terceros forjen eventos o enumeren
 * campañas/contactos.
 */

export interface TrackingTokenPayload {
  campaignId: string;
  contactId: string;
  userId: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Genera un token firmado a partir del payload de tracking. */
export async function signTrackingPayload(
  payload: TrackingTokenPayload,
  secret: string
): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verifica la firma y devuelve el payload, o `null` si el token es inválido,
 * tiene una firma adulterada o no cumple el contrato.
 */
export async function verifyTrackingPayload(
  token: string,
  secret: string
): Promise<TrackingTokenPayload | null> {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  try {
    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(body)
    );
    if (!valid) return null;

    const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as Partial<
      TrackingTokenPayload
    >;

    if (
      typeof decoded.campaignId !== 'string' ||
      typeof decoded.contactId !== 'string' ||
      typeof decoded.userId !== 'string'
    ) {
      return null;
    }

    return { campaignId: decoded.campaignId, contactId: decoded.contactId, userId: decoded.userId };
  } catch {
    return null;
  }
}
