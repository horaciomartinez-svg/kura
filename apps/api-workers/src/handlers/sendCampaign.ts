import type { Env } from '../types/env';
import type { QueuePayload } from '@kura/core';

/**
 * Productor: recibe la petición HTTP, valida reglas de negocio (Trial)
 * y encola los envíos en lotes sin bloquear la respuesta al usuario.
 */
export async function handleSendCampaign(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const campaignId = url.pathname.split('/')[3];

  try {
    // 1. (Simulación) Query a la DB: validar estado de la campaña y usuario.
    // const campaign = await db.query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    // if (campaign.status !== 'draft') return new Response('Invalid status', { status: 400 });

    // 2. (Simulación) Query a la DB: obtener contactos de la lista.
    // const contacts = await db.query('SELECT ... FROM list_memberships JOIN contacts ...');

    const activeContacts = [
      { id: 'c-1', email: 'user1@example.com', vars: { nombre: 'Juan' } },
      { id: 'c-2', email: 'user2@example.com', vars: { nombre: 'Ana' } },
    ];

    // 3. Encolamiento por lotes hacia Cloudflare Queues.
    const messagesToQueue = activeContacts.map((contact) => ({
      body: {
        campaignId,
        contactId: contact.id,
        contactEmail: contact.email,
        contactVars: contact.vars,
        fromEmail: 'hola@midominio.com',
        designJson: {}, // JSON del editor
      } as QueuePayload,
    }));

    await env.SENDING_QUEUE.sendBatch(messagesToQueue);

    // 4. (Simulación) Actualizar estado en DB a 'sending'.
    // await db.query('UPDATE campaigns SET status = $1 WHERE id = $2', ['sending', campaignId]);

    return new Response(
      JSON.stringify({ message: 'Campaign processing started', enqueued: messagesToQueue.length }),
      { status: 202, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error encolando campaña:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
