import type { TrackingPayload } from '@kura/core';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { campaignEvents, contacts, webhookEvents } from '../../db/schema';
import type { Env } from '../../types/env';

/* -------------------------------------------------------------------------- */
/* Tipos del sobre SNS y del evento SES                                        */
/* -------------------------------------------------------------------------- */

interface SnsEnvelope {
  Type?: string;
  MessageId?: string;
  Token?: string;
  TopicArn?: string;
  Subject?: string;
  Message?: string;
  Timestamp?: string;
  SubscribeURL?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
}

/** Etiquetas de SES v2: `{ nombre_tag: [valores...] }`. */
type SesMailTags = Record<string, string[]>;

interface SesEvent {
  eventType?: string; // 'Bounce' | 'Complaint' | 'Delivery'
  mail?: {
    messageId?: string;
    destination?: string[];
    tags?: SesMailTags;
  };
  bounce?: { bounceType?: string; bouncedRecipients?: Array<{ emailAddress?: string }> };
  complaint?: { complainedRecipients?: Array<{ emailAddress?: string }> };
  delivery?: { recipients?: string[] };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Traduce `eventType` de SES a un `CampaignEventType` de KURA. */
function mapEventType(eventType: string | undefined): TrackingPayload['event_type'] | null {
  switch (eventType) {
    case 'Bounce':
      return 'bounce';
    case 'Complaint':
      return 'complaint';
    case 'Delivery':
      return 'delivery';
    default:
      return null;
  }
}

function firstTag(tags: SesMailTags | undefined, names: string[]): string | null {
  if (!tags) return null;
  for (const name of names) {
    const value = tags[name];
    if (Array.isArray(value) && value.length > 0 && value[0]) return value[0];
  }
  return null;
}

/** Correos afectados por el evento (rebotados, quejados o entregados). */
function affectedRecipients(event: SesEvent): string[] {
  if (event.bounce?.bouncedRecipients) {
    return event.bounce.bouncedRecipients
      .map((r) => r.emailAddress)
      .filter((email): email is string => Boolean(email));
  }
  if (event.complaint?.complainedRecipients) {
    return event.complaint.complainedRecipients
      .map((r) => r.emailAddress)
      .filter((email): email is string => Boolean(email));
  }
  if (event.delivery?.recipients) return event.delivery.recipients;
  if (event.mail?.destination) return event.mail.destination;
  return [];
}

/**
 * Resuelve `campaign_id` y `contact_id` para un evento de SES.
 *
 * Prioridad: etiquetas del mensaje (`kura_campaign_id`/`kura_contact_id`,
 * inyectadas al enviar) → evento `send` previo con el mismo `ses_message_id`
 * → contacto por email (mejor esfuerzo).
 */
async function resolveTarget(
  db: ReturnType<typeof getDb>,
  event: SesEvent,
  email: string | null
): Promise<{ campaignId: string; contactId: string }> {
  let campaignId =
    firstTag(event.mail?.tags, ['kura_campaign_id', 'campaign_id', 'campaignId']) ?? '';
  let contactId = firstTag(event.mail?.tags, ['kura_contact_id', 'contact_id', 'contactId']) ?? '';

  const sesMessageId = event.mail?.messageId ?? null;

  if ((!campaignId || !contactId) && sesMessageId) {
    const [sent] = await db
      .select({ campaignId: campaignEvents.campaignId, contactId: campaignEvents.contactId })
      .from(campaignEvents)
      .where(eq(campaignEvents.sesMessageId, sesMessageId))
      .limit(1);
    if (sent) {
      campaignId ||= sent.campaignId;
      contactId ||= sent.contactId;
    }
  }

  if (!contactId && email) {
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, email))
      .limit(1);
    if (contact) contactId = contact.id;
  }

  return { campaignId, contactId };
}

/* -------------------------------------------------------------------------- */
/* Verificación de la firma del certificado SNS (§11.2)                        */
/* -------------------------------------------------------------------------- */

/**
 * Verifica la firma del sobre SNS contra el certificado de firma de AWS.
 *
 * NOTA: tolerante en desarrollo (`ENVIRONMENT !== 'production'`) porque probarla
 * localmente exige certificados reales de Amazon.
 * TODO(deploy): validar siempre en producción y monitorizar fallos de firma.
 */
async function verifySnsSignature(envelope: SnsEnvelope, env: Env): Promise<boolean> {
  if (env.ENVIRONMENT !== 'production') {
    return true;
  }
  return verifyWithCertificate(envelope);
}

function isTrustedSnsCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Construye la cadena canónica de SNS sobre la que se calcula la firma. */
function canonicalString(envelope: SnsEnvelope): string | null {
  const { Type, Message, MessageId, Subject, Timestamp, TopicArn, SubscribeURL, Token } = envelope;
  if (!Type || !MessageId || !Timestamp || !TopicArn) return null;

  const parts: string[] = [];
  const add = (key: string, value?: string) => {
    parts.push(key, value ?? '');
  };

  add('Message', Message);
  add('MessageId', MessageId);
  if (Type === 'Notification' && Subject !== undefined) add('Subject', Subject);
  add('Timestamp', Timestamp);
  if (Type === 'SubscriptionConfirmation' || Type === 'UnsubscribeConfirmation') {
    add('SubscribeURL', SubscribeURL);
    add('Token', Token);
  }
  add('TopicArn', TopicArn);
  add('Type', Type);

  return `${parts.join('\n')}\n`;
}

interface DerTlv {
  tag: number;
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

/** Lee un elemento TLV (tag-length-value) de DER a partir de un offset. */
function readTlv(buf: Uint8Array, offset: number): DerTlv {
  const tag = buf[offset];
  const lengthByte = buf[offset + 1];
  let pos = offset + 2;
  let length: number;

  if (lengthByte < 0x80) {
    length = lengthByte;
  } else {
    const numBytes = lengthByte & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i += 1) length = (length << 8) | buf[pos + i];
    pos += numBytes;
  }

  return { tag, start: offset, contentStart: pos, contentEnd: pos + length, end: pos + length };
}

/**
 * Extrae el SubjectPublicKeyInfo (SPKI) DER de un certificado X.509 para
 * poder importarlo con Web Crypto (`importKey('spki', ...)`).
 */
function extractSpkiFromCertificate(der: Uint8Array): Uint8Array | null {
  const certificate = readTlv(der, 0);
  if (certificate.tag !== 0x30) return null;

  const tbsCertificate = readTlv(der, certificate.contentStart);
  if (tbsCertificate.tag !== 0x30) return null;

  let cursor = tbsCertificate.contentStart;

  // [0] EXPLICIT version (opcional).
  const version = readTlv(der, cursor);
  if (version.tag === 0xa0) cursor = version.end;

  // serialNumber, signature, issuer, validity, subject.
  for (let i = 0; i < 5; i += 1) cursor = readTlv(der, cursor).end;

  const spki = readTlv(der, cursor);
  if (spki.tag !== 0x30) return null;
  return der.subarray(spki.start, spki.end);
}

function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pemToDer(pem: string): Uint8Array | null {
  const match = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
  if (!match) return null;
  return base64ToBytes(match[1].replace(/\s+/g, ''));
}

async function verifyWithCertificate(envelope: SnsEnvelope): Promise<boolean> {
  const { SigningCertURL, Signature, SignatureVersion } = envelope;
  if (!SigningCertURL || !Signature || !isTrustedSnsCertUrl(SigningCertURL)) return false;

  const canonical = canonicalString(envelope);
  if (!canonical) return false;

  try {
    const response = await fetch(SigningCertURL);
    if (!response.ok) return false;

    const der = pemToDer(await response.text());
    if (!der) return false;

    const spki = extractSpkiFromCertificate(der);
    if (!spki) return false;

    const hash = SignatureVersion === '2' ? 'SHA-256' : 'SHA-1';
    const key = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSASSA-PKCS1-v1_5', hash },
      false,
      ['verify']
    );

    return crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      base64ToBytes(Signature),
      new TextEncoder().encode(canonical)
    );
  } catch (err) {
    console.error('Error verificando la firma SNS:', err);
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Handler del webhook                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Webhook público `POST /webhooks/sns` para eventos de entrega de AWS SES
 * (bounce/complaint/delivery) §11.2. Encola cada evento normalizado en la
 * `TRACKING_QUEUE`; el consumidor aplica los efectos en la base de datos.
 */
export async function handleSnsWebhook(request: Request, env: Env): Promise<Response> {
  let envelope: SnsEnvelope;
  try {
    envelope = (await request.json()) as SnsEnvelope;
  } catch {
    return json({ error: { code: 'BAD_REQUEST', message: 'JSON inválido.' } }, 400);
  }

  if (!(await verifySnsSignature(envelope, env))) {
    return json({ error: { code: 'INVALID_SIGNATURE', message: 'Firma SNS inválida.' } }, 403);
  }

  // Confirmación de suscripción: en esta fase se registra para confirmar a mano.
  if (envelope.Type === 'SubscriptionConfirmation') {
    console.log(`[SNS] Confirmar suscripción manualmente con SubscribeURL: ${envelope.SubscribeURL}`);
    return json({ ok: true, type: 'SubscriptionConfirmation' }, 200);
  }

  if (envelope.Type !== 'Notification' || !envelope.MessageId) {
    // Se ignoran tipos no soportados sin reintentos.
    return json({ ok: true }, 200);
  }

  const db = getDb(env);

  // Idempotencia atómica: si ya existe (provider, external_id) no se reprocesa.
  let claimed: Array<{ id: string }>;
  try {
    claimed = await db
      .insert(webhookEvents)
      .values({
        provider: 'sns',
        externalId: envelope.MessageId,
        payload: envelope as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.externalId] })
      .returning({ id: webhookEvents.id });
  } catch (err) {
    console.error('Error registrando el evento SNS:', err);
    return json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno.' } }, 500);
  }

  if (claimed.length === 0) {
    return json({ ok: true, duplicate: true }, 200);
  }

  try {
    const sesEvent = JSON.parse(envelope.Message ?? '{}') as SesEvent;
    const eventType = mapEventType(sesEvent.eventType);

    let enqueued = 0;
    if (eventType) {
      const recipients = affectedRecipients(sesEvent);
      const targets = recipients.length > 0 ? recipients : [null];

      const messages: TrackingPayload[] = [];
      for (const email of targets) {
        const { campaignId, contactId } = await resolveTarget(db, sesEvent, email);
        if (!contactId && !campaignId) continue;
        messages.push({
          campaign_id: campaignId,
          contact_id: contactId,
          event_type: eventType,
          url_clicked: null,
          is_machine_open: false,
          ses_message_id: sesEvent.mail?.messageId ?? null,
        });
      }

      if (messages.length > 0) {
        await env.TRACKING_QUEUE.sendBatch(messages.map((body) => ({ body })));
        enqueued = messages.length;
      }
    }

    return json({ ok: true, enqueued }, 200);
  } catch (err) {
    // Liberar la marca de idempotencia para permitir el reintento de SNS.
    try {
      await db
        .delete(webhookEvents)
        .where(
          and(eq(webhookEvents.provider, 'sns'), eq(webhookEvents.externalId, envelope.MessageId))
        );
    } catch (cleanupErr) {
      console.error('No se pudo liberar la marca de idempotencia SNS:', cleanupErr);
    }

    console.error('Error procesando el evento SNS:', err);
    return json({ error: { code: 'PROCESSING_ERROR', message: 'No se pudo procesar el evento.' } }, 500);
  }
}
