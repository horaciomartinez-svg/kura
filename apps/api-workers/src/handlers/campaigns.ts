import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { campaigns, lists, users } from '../db/schema';
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

/**
 * POST /api/campaigns
 * Body: { name: string, subject?: string }
 *
 * Crea una campaña borrador vacía. El `from_email` inicial se toma del email
 * del usuario para cumplir el NOT NULL del esquema; el editor podrá cambiarlo
 * más adelante. El user_id siempre viene del JWT (§12.2).
 */
export async function handleCreateCampaign(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  let body: {
    name?: unknown;
    subject?: unknown;
    list_id?: unknown;
    listId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error('INVALID_PAYLOAD', 'JSON inválido.', 400);
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return error('NAME_REQUIRED', 'El nombre de la campaña es obligatorio.', 400);
  }

  const name = body.name.trim();
  if (name.length > 255) {
    return error('NAME_TOO_LONG', 'El nombre no puede superar los 255 caracteres.', 400);
  }

  if (body.subject !== undefined && body.subject !== null && typeof body.subject !== 'string') {
    return error('INVALID_SUBJECT', 'El asunto debe ser texto.', 400);
  }

  const subject =
    typeof body.subject === 'string' && body.subject.trim().length > 0
      ? body.subject.trim().slice(0, 255)
      : null;

  const rawListId = body.list_id ?? body.listId;
  let listId: string | null = null;

  if (rawListId !== undefined && rawListId !== null && rawListId !== '') {
    if (typeof rawListId !== 'string') {
      return error('INVALID_LIST_ID', 'El list_id debe ser un UUID.', 400);
    }
    listId = rawListId;
  }

  const db = getDb(env);
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return error('USER_NOT_FOUND', 'El usuario no existe.', 404);
  }

  if (listId) {
    const [list] = await db
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
      .limit(1);

    if (!list) {
      return error(
        'LIST_NOT_FOUND',
        'La lista no existe o no pertenece al usuario.',
        404
      );
    }
  }

  const now = new Date();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      userId,
      listId,
      name,
      subject,
      fromEmail: user.email,
      status: 'draft',
      designJson: null,
      htmlContent: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!campaign) {
    return error('INTERNAL_ERROR', 'No se pudo crear la campaña.', 500);
  }

  return json({ campaign }, 201);
}

/**
 * GET /api/campaigns
 * Lista las campañas del tenant autenticado, de más reciente a más antigua.
 */
export async function handleListCampaigns(
  _request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const db = getDb(env);

  try {
    const rows = await db
      .select({ campaign: campaigns, listName: lists.name })
      .from(campaigns)
      .leftJoin(lists, eq(campaigns.listId, lists.id))
      .where(eq(campaigns.userId, userId))
      .orderBy(desc(campaigns.createdAt));

    return json(
      {
        campaigns: rows.map((row) => ({
          ...row.campaign,
          listName: row.listName ?? null,
        })),
      },
      200
    );
  } catch (err) {
    console.error('Error listando campañas:', err);
    return error('INTERNAL_ERROR', 'No se pudieron listar las campañas.', 500);
  }
}
