import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import type { Env } from '../types/env';

/** Cliente Drizzle tipado con el schema de KURA. */
export type Database = PostgresJsDatabase<typeof schema>;

let cached: { connectionString: string; db: Database } | null = null;

/**
 * Cliente de base de datos edge-compatible (Drizzle ORM + postgres.js).
 *
 * La cadena de conexión se toma del binding Hyperdrive (env.DB_POOL) en
 * producción; en desarrollo local con `wrangler dev` se usa DATABASE_URL
 * definido en .dev.vars.
 */
export function getDb(env: Env): Database {
  const connectionString = env.DB_POOL?.connectionString ?? env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'No hay conexión a la base de datos: falta el binding Hyperdrive DB_POOL o la variable DATABASE_URL.'
    );
  }

  // Reutiliza el pool dentro del isolate para no abrir una conexión por request.
  if (cached && cached.connectionString === connectionString) {
    return cached.db;
  }

  // `prepare: false` es obligatorio con Hyperdrive (transaction pooling no
  // soporta prepared statements persistentes).
  const client = postgres(connectionString, { prepare: false });
  const db = drizzle(client, { schema });

  cached = { connectionString, db };
  return db;
}

export { schema };
