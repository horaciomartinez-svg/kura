import type { Env } from '../types/env';

/**
 * Cliente de base de datos edge-compatible (Drizzle ORM + Hyperdrive/Supabase).
 * Punto de extensión para las consultas SQL del backend.
 */
export function getDb(env: Env) {
  // const client = postgres(env.DB_POOL.connectionString);
  // return drizzle(client);
  return null;
}
