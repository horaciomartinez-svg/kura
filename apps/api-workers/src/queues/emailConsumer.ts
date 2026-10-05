import type { MessageBatch } from '@cloudflare/workers-types';
import { SESClient, SendBulkTemplatedEmailCommand } from '@aws-sdk/client-ses';
import type { Env } from '../types/env';
import type { QueuePayload } from '@kura/core';

/**
 * Consumidor: procesa lotes de la cola, compila MJML -> HTML y ejecuta
 * una única llamada Bulk a AWS SES para respetar el rate limit.
 */
export async function processEmailQueue(batch: MessageBatch<QueuePayload>, env: Env): Promise<void> {
  const sesClient = new SESClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const destinations = batch.messages.map((msg) => {
    // Reemplazo de variables (Merge Tags).
    const replacementData = JSON.stringify({
      nombre: msg.body.contactVars.nombre || 'Suscriptor',
    });

    return {
      Destination: { ToAddresses: [msg.body.contactEmail] },
      ReplacementTemplateData: replacementData,
    };
  });

  try {
    // Compilar MJML a HTML (lógica abstraída).
    // const compiledHtml = mjml2html(batch.messages[0].body.designJson).html;

    const command = new SendBulkTemplatedEmailCommand({
      Source: batch.messages[0].body.fromEmail,
      Template: 'KuraDynamicTemplate', // Requiere pre-crear un template en SES
      DefaultTemplateData: JSON.stringify({ nombre: '' }),
      Destinations: destinations,
    });

    const response = await sesClient.send(command);

    console.log(`Lote procesado. SES Message ID: ${response.Status?.[0]?.MessageId}`);

    // Confirmar a la cola que los mensajes fueron procesados exitosamente.
    batch.ackAll();
  } catch (error) {
    console.error('Error procesando lote de correos:', error);
    // Permite que la política de reintentos (max_retries) vuelva a procesar este lote.
    batch.retryAll();
  }
}
