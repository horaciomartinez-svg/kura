import type { Hyperdrive, Queue } from '@cloudflare/workers-types';
import type { QueuePayload, TrackingPayload } from '@kura/core';

export interface Env {
  // Variables estáticas
  ENVIRONMENT: string;
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  MAX_TRIAL_SENDS: string;

  // Cadena de conexión PostgreSQL para desarrollo local (wrangler dev, .dev.vars).
  DATABASE_URL?: string;

  // Bindings de Cloudflare
  SENDING_QUEUE: Queue<QueuePayload>;
  TRACKING_QUEUE: Queue<TrackingPayload>;
  DB_POOL?: Hyperdrive; // Hyperdrive -> Supabase PostgreSQL (producción)
}
