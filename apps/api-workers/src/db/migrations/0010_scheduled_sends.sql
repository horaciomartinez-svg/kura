-- KURA - Migración 0010: envíos programados con Cloudflare Cron Triggers
-- apps/api-workers/src/db/migrations/0010_scheduled_sends.sql
--
--   1) campaigns.scheduled_at: fecha/hora UTC de la ejecución programada.
--   2) campaigns.last_error: motivo legible cuando el cron falla una campaña.
--   3) CHECK de status ampliado (conserva los estados existentes + canceled).
--   4) Índice parcial para el dispatcher minuto a minuto.

ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_check CHECK (
    status IN (
        'draft',
        'scheduled',
        'preparing',
        'sending',
        'sent',
        'paused_trial_expired',
        'failed',
        'canceled'
    )
);

CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled
    ON public.campaigns(scheduled_at)
    WHERE status = 'scheduled';
