import { eq } from 'drizzle-orm';
import type { CampaignCompileRequest, CampaignSaveRequest } from '@kura/core';
import { getDb } from '../db/client';
import { campaigns } from '../db/schema';
import type { Env } from '../types/env';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * PATCH /api/campaigns/:id/autosave
 * Guarda solo el AST de Easy-Email (design_json) + updated_at, sin compilar (§9.4).
 */
export async function handleAutosave(request: Request, env: Env): Promise<Response> {
  const campaignId = new URL(request.url).pathname.split('/')[3];

  // TODO(auth): extraer user_id del JWT verificado y filtrar por user_id.
  const body = await readJson<CampaignSaveRequest>(request);
  if (!body || typeof body.design_json === 'undefined') {
    return error('INVALID_PAYLOAD', 'Falta el campo design_json (AST de Easy-Email).', 400);
  }

  const db = getDb(env);
  const updated = await db
    .update(campaigns)
    .set({ designJson: body.design_json, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId))
    .returning({ id: campaigns.id });

  if (updated.length === 0) {
    return error('CAMPAIGN_NOT_FOUND', 'La campaña no existe.', 404);
  }

  return json({ message: 'Design autosaved', campaignId }, 200);
}

/**
 * PUT /api/campaigns/:id/compile
 * Guarda el AST + el HTML ya compilado en el cliente (mjml-browser) (§9.4).
 */
export async function handleCompile(request: Request, env: Env): Promise<Response> {
  const campaignId = new URL(request.url).pathname.split('/')[3];

  // TODO(auth): extraer user_id del JWT verificado y filtrar por user_id.
  const body = await readJson<CampaignCompileRequest>(request);
  if (
    !body ||
    typeof body.design_json === 'undefined' ||
    typeof body.html_content !== 'string'
  ) {
    return error('INVALID_PAYLOAD', 'Faltan design_json o html_content.', 400);
  }

  const db = getDb(env);
  const updated = await db
    .update(campaigns)
    .set({
      designJson: body.design_json,
      htmlContent: body.html_content,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId))
    .returning({ id: campaigns.id });

  if (updated.length === 0) {
    return error('CAMPAIGN_NOT_FOUND', 'La campaña no existe.', 404);
  }

  return json({ message: 'Design compiled and saved', campaignId }, 200);
}

/**
 * PUT /api/campaigns/:id/design
 * @deprecated Ruta del builder propio previo a Easy-Email. Guarda el payload
 * recibido como design_json para no romper clientes antiguos.
 */
export async function handleSaveDesign(request: Request, env: Env): Promise<Response> {
  const campaignId = new URL(request.url).pathname.split('/')[3];

  // TODO(auth): extraer user_id del JWT verificado y filtrar por user_id.
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) {
    return error('INVALID_PAYLOAD', 'Cuerpo JSON inválido.', 400);
  }

  const db = getDb(env);
  const updated = await db
    .update(campaigns)
    .set({ designJson: body as never, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId))
    .returning({ id: campaigns.id });

  if (updated.length === 0) {
    return error('CAMPAIGN_NOT_FOUND', 'La campaña no existe.', 404);
  }

  return json({ message: 'Design saved', campaignId }, 200);
}
