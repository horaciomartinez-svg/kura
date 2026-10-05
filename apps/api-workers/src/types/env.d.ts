import type { Queue } from '@cloudflare/workers-types';
import type { QueuePayload, TrackingPayload } from '@kura/core';

export interface Env {
  // Variables estáticas
  ENVIRONMENT: string;
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  MAX_TRIAL_SENDS: string;

  // Bindings de Cloudflare
  SENDING_QUEUE: Queue<QueuePayload>;
  TRACKING_QUEUE: Queue<TrackingPayload>;
  DB_POOL: any; // Binding a Hyperdrive (PostgreSQL) o D1
}
