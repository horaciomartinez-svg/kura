import type { Env } from '../types/env';
import type { CampaignDesign } from '@kura/core';

/**
 * Guarda el diseño (JSON del editor) de una campaña.
 * Actualmente simula la persistencia; en producción escribirá en la DB
 * vía Hyperdrive tras validar la sesión y el estado de la campaña.
 */
export async function handleSaveDesign(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const campaignId = url.pathname.split('/')[3];

  try {
    const design = (await request.json()) as CampaignDesign;

    if (!design || !Array.isArray(design.blocks)) {
      return new Response(JSON.stringify({ error: 'Invalid design payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. (Simulación) Persistir el diseño.
    // await db.query('UPDATE campaigns SET design_json = $1 WHERE id = $2', [design, campaignId]);

    return new Response(JSON.stringify({ message: 'Design saved', campaignId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error guardando diseño de campaña:', error);
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
