import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { EasyEmailAST } from '@kura/core';

/**
 * KURA - Esquema Drizzle (PostgreSQL / Supabase).
 *
 * Modela las tablas de db/schema.sql (base inmutable en la migración 0001)
 * más las columnas del documento de arquitectura §7.2 (html_content,
 * started_at, total_recipients, updated_at). Toda consulta pasa por Drizzle
 * para garantizar SQL 100% parametrizado.
 */

// Expresiones por defecto alineadas con schema.sql (uuid-ossp + CURRENT_TIMESTAMP).
const UUID_DEFAULT = sql`uuid_generate_v4()`;
const NOW = sql`CURRENT_TIMESTAMP`;

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(UUID_DEFAULT),
  email: varchar('email', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 50 }).default('active'),
  trialSendsCount: integer('trial_sends_count').default(0),
  trialExpiresAt: timestamp('trial_expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).default(NOW),
});

export const verifiedDomains = pgTable(
  'verified_domains',
  {
    id: uuid('id').primaryKey().default(UUID_DEFAULT),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    domainName: varchar('domain_name', { length: 255 }).notNull(),
    dkimTokens: jsonb('dkim_tokens').notNull(),
    status: varchar('status', { length: 50 }).default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(NOW),
  },
  (table) => ({
    userDomainUnique: unique('verified_domains_user_id_domain_name_unique').on(
      table.userId,
      table.domainName
    ),
  })
);

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().default(UUID_DEFAULT),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).default(NOW),
});

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().default(UUID_DEFAULT),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    status: varchar('status', { length: 50 }).default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(NOW),
  },
  (table) => ({
    userEmailUnique: unique('contacts_user_id_email_unique').on(table.userId, table.email),
  })
);

export const listMemberships = pgTable(
  'list_memberships',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).default(NOW),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.listId, table.contactId] }),
  })
);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().default(UUID_DEFAULT),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  listId: uuid('list_id').references(() => lists.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  fromEmail: varchar('from_email', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 255 }),
  // AST editable de Easy-Email (ver §7.2 y §9.1).
  designJson: jsonb('design_json').$type<EasyEmailAST>(),
  // HTML compilado final e inmutable; se agrega en la migración 0002.
  htmlContent: text('html_content'),
  // 'failed' se agrega al CHECK en la migración 0002.
  status: varchar('status', { length: 50 }).default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  // Columnas del motor de envíos (migración 0003, ver §7.2 y §10.1).
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  totalRecipients: integer('total_recipients').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).default(NOW),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(NOW),
});

// Imágenes del editor subidas a Cloudflare R2 (§7.2, §12.5).
export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().default(UUID_DEFAULT),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  publicUrl: text('public_url').notNull(),
  contentType: varchar('content_type', { length: 100 }),
  sizeBytes: integer('size_bytes'),
  createdAt: timestamp('created_at', { withTimezone: true }).default(NOW),
});

export const campaignEvents = pgTable('campaign_events', {
  id: uuid('id').primaryKey().default(UUID_DEFAULT),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  // Correlación con AWS SES (eventos de entrega/rebote vía SNS, §11.2).
  sesMessageId: varchar('ses_message_id', { length: 255 }),
  urlClicked: text('url_clicked'),
  isMachineOpen: boolean('is_machine_open').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).default(NOW),
});

// Lista de supresión: correos a los que nunca se debe volver a enviar (§7.2).
export const suppressionList = pgTable(
  'suppression_list',
  {
    id: uuid('id').primaryKey().default(UUID_DEFAULT),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    reason: varchar('reason', { length: 50 }).notNull(),
    sourceCampaignId: uuid('source_campaign_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(NOW),
  },
  (table) => ({
    userEmailUnique: unique('suppression_list_user_id_email_unique').on(table.userId, table.email),
  })
);

// Idempotencia de webhooks entrantes (SNS, Stripe) (§7.2, §11.2).
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().default(UUID_DEFAULT),
    provider: varchar('provider', { length: 50 }).notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).default(NOW),
  },
  (table) => ({
    providerExternalUnique: unique('webhook_events_provider_external_id_unique').on(
      table.provider,
      table.externalId
    ),
  })
);
