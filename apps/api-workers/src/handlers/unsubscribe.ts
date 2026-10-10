import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { campaignEvents, contacts, suppressionList } from '../db/schema';
import { verifyTrackingPayload } from '../services/trackingTokens';
import type { Env } from '../types/env';

/**
 * Página HTML mínima de confirmación de baja, con estilos inline KURA (§11.1,
 * Anexo A: primario #014751, fondo #F7F9FC, texto #111827).
 */
function confirmationPage(title: string, detail: string, status: number): Response {
  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · KURA</title>
  </head>
  <body style="margin:0;padding:0;background:#F7F9FC;font-family:Inter,Arial,sans-serif;color:#111827;">
    <main style="max-width:480px;margin:0 auto;padding:64px 24px;">
      <div style="background:#ffffff;border:1px solid #E5E7EB;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.05);padding:32px;text-align:center;">
        <p style="margin:0 0 8px;font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#014751;">KURA</p>
        <h1 style="margin:0 0 12px;font-size:22px;color:#111827;">${title}</h1>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#4B5563;">${detail}</p>
      </div>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Unsubscribe one-click (RFC 8058) — ruta pública `GET|POST /u/:payload` §11.1.
 *
 * Verifica el token HMAC, marca al contacto como `unsubscribed`, lo añade a la
 * suppression list y registra el evento en `campaign_events`.
 */
export async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.pathname.slice('/u/'.length);

  if (!token) {
    return confirmationPage('Enlace no válido', 'El enlace de baja está incompleto.', 400);
  }

  const secret = env.TRACKING_HMAC_SECRET;
  if (!secret) {
    console.error('TRACKING_HMAC_SECRET no está configurado; no se puede verificar la baja.');
    return confirmationPage(
      'No pudimos procesar tu baja',
      'Intenta nuevamente más tarde.',
      500
    );
  }

  const payload = await verifyTrackingPayload(token, secret);
  if (!payload) {
    return confirmationPage(
      'Enlace no válido',
      'El enlace de baja no es válido o fue alterado.',
      400
    );
  }

  try {
    const db = getDb(env);

    // Aislamiento por tenant: el contacto debe pertenecer al usuario firmado.
    const [contact] = await db
      .select({ id: contacts.id, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.id, payload.contactId), eq(contacts.userId, payload.userId)))
      .limit(1);

    if (!contact) {
      return confirmationPage(
        'Suscripción no encontrada',
        'No encontramos tu suscripción en nuestros registros.',
        404
      );
    }

    await db.update(contacts).set({ status: 'unsubscribed' }).where(eq(contacts.id, contact.id));

    await db
      .insert(suppressionList)
      .values({
        userId: payload.userId,
        email: contact.email,
        reason: 'unsubscribe',
        sourceCampaignId: payload.campaignId,
      })
      .onConflictDoNothing({ target: [suppressionList.userId, suppressionList.email] });

    await db.insert(campaignEvents).values({
      campaignId: payload.campaignId,
      contactId: contact.id,
      eventType: 'unsubscribe',
    });

    return confirmationPage(
      'Te has desuscrito correctamente',
      'Ya no recibirás más correos de esta lista. Gracias por avisarnos.',
      200
    );
  } catch (err) {
    console.error('Error procesando la baja:', err);
    return confirmationPage(
      'No pudimos procesar tu baja',
      'Ocurrió un error inesperado. Intenta nuevamente más tarde.',
      500
    );
  }
}
