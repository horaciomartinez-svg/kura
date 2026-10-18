import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type {
  ContactsImportResult,
  ContactsListResponse,
  ContactStatus,
} from '@kura/core';
import { getDb } from '../db/client';
import type { Database } from '../db/client';
import { contacts, suppressionList } from '../db/schema';
import type { Env } from '../types/env';

const MAX_IMPORT_ROWS = 10_000;
const INSERT_CHUNK_SIZE = 500;
const LOOKUP_CHUNK_SIZE = 1_000;
const MAX_EMAIL_LENGTH = 255;

// Validación razonable: algo@dominio.tld, sin espacios ni caracteres de control.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const HEADER_ALIASES = {
  email: ['email', 'correo', 'e-mail', 'mail'],
  firstName: ['first_name', 'firstname', 'first name', 'nombre'],
  lastName: ['last_name', 'lastname', 'last name', 'apellido'],
} as const;

type CsvDelimiter = ',' | ';';

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

interface ContactCandidate {
  email: string;
  firstName: string | null;
  lastName: string | null;
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

/** Detecta coma o punto y coma contando fuera de comillas en la primera línea. */
function detectDelimiter(firstLine: string): CsvDelimiter {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;

  for (let i = 0; i < firstLine.length; i += 1) {
    const char = firstLine[i];

    if (char === '"') {
      if (inQuotes && firstLine[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (char === ',') commas += 1;
      if (char === ';') semicolons += 1;
    }
  }

  return semicolons > commas ? ';' : ',';
}

/**
 * Parser CSV propio, sin dependencias. Soporta comillas dobles escapadas
 * (`""`), delimitadores dentro de comillas, saltos de línea CRLF/LF y campos
 * vacíos. Devuelve `null` si las comillas están desbalanceadas.
 */
export function parseCsv(input: string): ParsedCsv | null {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length === 0) {
        inQuotes = true;
      } else {
        field += char;
      }
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (inQuotes) return null;

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Ignora líneas completamente vacías (p. ej. salto final del archivo).
  const nonEmptyRows = rows.filter((values) => values.some((value) => value.trim() !== ''));
  if (nonEmptyRows.length === 0) return { headers: [], rows: [] };

  const [headers, ...dataRows] = nonEmptyRows;
  return {
    headers: headers.map((header) => header.trim()),
    rows: dataRows,
  };
}

function headerIndex(headers: string[], aliases: readonly string[]): number {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return normalized.findIndex((header) => aliases.includes(header));
}

/** Lee el CSV desde body raw o multipart/form-data (campo `file`). */
async function readCsvBody(request: Request): Promise<string | null> {
  const contentType = request.headers.get('Content-Type') ?? '';

  if (contentType.toLowerCase().includes('multipart/form-data')) {
    try {
      const form = await request.formData();
      const entry = form.get('file');
      if (typeof entry === 'string') return entry;
      if (entry && typeof (entry as Blob).text === 'function') {
        return await (entry as Blob).text();
      }
      return null;
    } catch {
      return null;
    }
  }

  try {
    return await request.text();
  } catch {
    return null;
  }
}

async function emailsFromTable(
  db: Database,
  table: typeof contacts | typeof suppressionList,
  userId: string,
  emails: string[]
): Promise<Set<string>> {
  const found = new Set<string>();

  for (let i = 0; i < emails.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = emails.slice(i, i + LOOKUP_CHUNK_SIZE);
    if (chunk.length === 0) continue;

    const rows = await db
      .select({ email: table.email })
      .from(table)
      .where(
        and(eq(table.userId, userId), inArray(sql<string>`lower(${table.email})`, chunk))
      );

    for (const row of rows) found.add(row.email.toLowerCase());
  }

  return found;
}

/**
 * POST /api/contacts/import
 *
 * Acepta CSV raw (`text/csv`) o multipart con campo `file`. Clasifica cada fila
 * como importada, duplicada, inválida o suprimida y respeta el aislamiento por
 * tenant usando el `user_id` del JWT.
 */
export async function handleImportContacts(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const csvText = await readCsvBody(request);
  if (!csvText || csvText.trim() === '') {
    return error('EMPTY_CSV', 'El CSV está vacío.', 400);
  }

  const parsed = parseCsv(csvText);
  if (!parsed || parsed.headers.length === 0) {
    return error('INVALID_CSV', 'El CSV está malformado o no contiene encabezados.', 400);
  }

  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return error(
      'TOO_MANY_ROWS',
      `El CSV supera el máximo de ${MAX_IMPORT_ROWS.toLocaleString('es-CL')} filas por importación.`,
      413
    );
  }

  if (parsed.rows.length === 0) {
    return error('EMPTY_CSV', 'El CSV no contiene filas de datos.', 400);
  }

  const emailIndex = headerIndex(parsed.headers, HEADER_ALIASES.email);
  if (emailIndex === -1) {
    return error(
      'MISSING_EMAIL_COLUMN',
      'Falta la columna obligatoria "email" (o "correo") en los encabezados.',
      400
    );
  }

  const firstNameIndex = headerIndex(parsed.headers, HEADER_ALIASES.firstName);
  const lastNameIndex = headerIndex(parsed.headers, HEADER_ALIASES.lastName);

  let invalid = 0;
  const candidates: ContactCandidate[] = [];

  for (const row of parsed.rows) {
    const rawEmail = (row[emailIndex] ?? '').trim();
    const normalizedEmail = rawEmail.toLowerCase();

    if (
      normalizedEmail.length === 0 ||
      normalizedEmail.length > MAX_EMAIL_LENGTH ||
      !EMAIL_PATTERN.test(normalizedEmail)
    ) {
      invalid += 1;
      continue;
    }

    candidates.push({
      email: normalizedEmail,
      firstName:
        firstNameIndex >= 0
          ? (row[firstNameIndex] ?? '').trim().slice(0, 100) || null
          : null,
      lastName:
        lastNameIndex >= 0
          ? (row[lastNameIndex] ?? '').trim().slice(0, 100) || null
          : null,
    });
  }

  const uniqueEmails = [...new Set(candidates.map((candidate) => candidate.email))];
  const db = getDb(env);

  try {
    const [existingEmails, suppressedEmails] = await Promise.all([
      emailsFromTable(db, contacts, userId, uniqueEmails),
      emailsFromTable(db, suppressionList, userId, uniqueEmails),
    ]);

    let duplicates = 0;
    let suppressed = 0;
    const seenInFile = new Set<string>();
    const toInsert: ContactCandidate[] = [];

    for (const candidate of candidates) {
      if (suppressedEmails.has(candidate.email)) {
        suppressed += 1;
      } else if (existingEmails.has(candidate.email) || seenInFile.has(candidate.email)) {
        duplicates += 1;
      } else {
        seenInFile.add(candidate.email);
        toInsert.push(candidate);
      }
    }

    let imported = 0;

    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
      const inserted = await db
        .insert(contacts)
        .values(
          chunk.map((candidate) => ({
            userId,
            email: candidate.email,
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            status: 'active' as ContactStatus,
          }))
        )
        .onConflictDoNothing({ target: [contacts.userId, contacts.email] })
        .returning({ id: contacts.id });

      imported += inserted.length;
      // Si otra request insertó el mismo email entre la lectura y el INSERT.
      if (inserted.length < chunk.length) duplicates += chunk.length - inserted.length;
    }

    const result: ContactsImportResult = {
      imported,
      duplicates,
      invalid,
      suppressed,
      total_rows: parsed.rows.length,
    };

    return json(result, 200);
  } catch (err) {
    console.error('Error importando contactos:', err);
    return error('INTERNAL_ERROR', 'No se pudieron importar los contactos.', 500);
  }
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * GET /api/contacts?page=1&limit=25&search=...
 *
 * Lista paginada de contactos del tenant autenticado, ordenada por fecha de
 * alta descendente. El filtro por `user_id` es obligatorio (§12.2).
 */
export async function handleListContacts(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const url = new URL(request.url);
  const page = positiveInt(url.searchParams.get('page'), 1);
  const limit = Math.min(100, positiveInt(url.searchParams.get('limit'), 25));
  const search = (url.searchParams.get('search') ?? '').trim();

  const tenantFilter = eq(contacts.userId, userId);
  const filter = search
    ? and(
        tenantFilter,
        or(
          ilike(contacts.email, `%${search}%`),
          ilike(contacts.firstName, `%${search}%`),
          ilike(contacts.lastName, `%${search}%`)
        )
      )
    : tenantFilter;

  const db = getDb(env);

  try {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(filter);

    const rows = await db
      .select({
        id: contacts.id,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        status: contacts.status,
        createdAt: contacts.createdAt,
      })
      .from(contacts)
      .where(filter)
      .orderBy(desc(contacts.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const result: ContactsListResponse = {
      contacts: rows.map((row) => ({
        ...row,
        status: row.status as ContactStatus,
        createdAt: row.createdAt?.toISOString() ?? '',
      })),
      total: Number(countRow?.count ?? 0),
      page,
      limit,
    };

    return json(result, 200);
  } catch (err) {
    console.error('Error listando contactos:', err);
    return error('INTERNAL_ERROR', 'No se pudieron listar los contactos.', 500);
  }
}
