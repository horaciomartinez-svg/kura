-- KURA - Migración 0007: suppression list, idempotencia de webhooks y eventos
-- apps/api-workers/src/db/migrations/0007_suppression.sql
--
-- Habilita la gestión de bajas y eventos de entrega de AWS SES (§11.1, §11.2):
--   1) suppression_list: nunca volver a enviar a estos correos (§7.2).
--   2) webhook_events: idempotencia de los webhooks de SNS (y Stripe) (§7.2).
--   3) campaign_events: se extiende el CHECK de event_type con los tipos del
--      motor de envíos y de SNS (send/delivery/unsubscribe) y se añade
--      ses_message_id para correlacionar los eventos con AWS SES (§7.2).
--   4) contacts.status: se añade 'complained' al CHECK (§7.2).
--
-- RLS habilitado en las tablas nuevas como segunda línea de defensa (§7.3).

-- ======================= 1) SUPPRESSION LIST (§7.2) ========================

CREATE TABLE IF NOT EXISTS public.suppression_list (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    reason VARCHAR(50) NOT NULL CHECK (reason IN ('bounce', 'complaint', 'unsubscribe', 'manual')),
    source_campaign_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_suppression_user_email ON public.suppression_list(user_id, email);

ALTER TABLE public.suppression_list ENABLE ROW LEVEL SECURITY;

-- ======================= 2) WEBHOOK EVENTS (§7.2) =========================

CREATE TABLE IF NOT EXISTS public.webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(50) NOT NULL,              -- 'sns' | 'stripe'
    external_id VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, external_id)
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ============ 3) CAMPAIGN_EVENTS: tipos ampliados + ses_message_id ==========

ALTER TABLE public.campaign_events ADD COLUMN IF NOT EXISTS ses_message_id VARCHAR(255);

ALTER TABLE public.campaign_events DROP CONSTRAINT IF EXISTS campaign_events_event_type_check;
ALTER TABLE public.campaign_events ADD CONSTRAINT campaign_events_event_type_check CHECK (
    event_type IN ('send', 'delivery', 'open', 'click', 'bounce', 'complaint', 'unsubscribe')
);

-- ================ 4) CONTACTS: añadir estado 'complained' ==================

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_status_check CHECK (
    status IN ('active', 'bounced', 'unsubscribed', 'complained')
);
