-- KURA - Migración 0002: modelo de datos Easy-Email (§7.2 y §9.1)
-- apps/api-workers/src/db/migrations/0002_easy_email.sql
--
-- 1) campaigns.html_content: HTML compilado final (artefacto inmutable que
--    envía el consumidor; el Worker nunca compila MJML en caliente, §9.1).
-- 2) campaigns.status: se agrega 'failed' al CHECK para el guardián de
--    reputación y los fallos permanentes del motor de envíos (§7.2, §11.4).

ALTER TABLE campaigns ADD COLUMN html_content TEXT;

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check CHECK (status IN (
    'draft',
    'scheduled',
    'preparing',
    'sending',
    'sent',
    'paused_trial_expired',
    'failed'
));
