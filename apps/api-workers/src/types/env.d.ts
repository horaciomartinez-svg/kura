import type { Hyperdrive, KVNamespace, Queue } from '@cloudflare/workers-types';
import type { QueuePayload, TrackingPayload } from '@kura/core';

export interface Env {
  // Variables estáticas
  ENVIRONMENT: string;
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  MAX_TRIAL_SENDS: string;

  // Supabase Auth: URL del proyecto para el JWKS público (§12.1).
  SUPABASE_URL: string;
  // Fallback HS256 para proyectos legacy (opcional).
  SUPABASE_JWT_SECRET?: string;
  // Futuro: operaciones administrativas con la REST API de Supabase (opcional).
  SUPABASE_SERVICE_ROLE_KEY?: string;

  // Cadena de conexión PostgreSQL para desarrollo local (wrangler dev, .dev.vars).
  DATABASE_URL?: string;

  // Bindings de Cloudflare
  SENDING_QUEUE: Queue<QueuePayload>;
  TRACKING_QUEUE: Queue<TrackingPayload>;
  DB_POOL?: Hyperdrive; // Hyperdrive -> Supabase PostgreSQL (producción)
  KURA_KV?: KVNamespace; // Caché del JWKS / rate limiting (opcional)
}
