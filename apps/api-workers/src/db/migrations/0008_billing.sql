-- KURA - Migración 0008: facturación SaaS con Stripe (F2, §7.2 y §12.3)
-- apps/api-workers/src/db/migrations/0008_billing.sql
--
-- Modelo multi-tenant de planes, suscripciones y contadores de uso:
--   1) plans: catálogo de planes comerciales con su cuota mensual de correos.
--   2) subscriptions: suscripción Stripe activa de cada usuario.
--   3) usage_counters: correos enviados por usuario y periodo (mes).
--   4) users.stripe_customer_id: vínculo con el Customer de Stripe.
--
-- RLS habilitado como segunda línea de defensa (§7.3). Los Workers conectan
-- con el rol propietario/service role y aplican el user_id del JWT; estas
-- políticas protegen cualquier acceso directo con Supabase JS.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================== PLANES ====================================

CREATE TABLE IF NOT EXISTS public.plans (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price_monthly_cents INT NOT NULL DEFAULT 0 CHECK (price_monthly_cents >= 0),
    monthly_email_quota INT NOT NULL CHECK (monthly_email_quota >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.plans (code, name, price_monthly_cents, monthly_email_quota)
VALUES
    ('free', 'Free', 0, 500),
    ('pro', 'Pro', 1900, 10000),
    ('business', 'Business', 4900, 50000)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    price_monthly_cents = EXCLUDED.price_monthly_cents,
    monthly_email_quota = EXCLUDED.monthly_email_quota;

-- =========================== SUSCRIPCIONES ================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    plan_code VARCHAR(50) NOT NULL REFERENCES public.plans(code),
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255) UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'incomplete' CHECK (
        status IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')
    ),
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);

-- ========================= CONTADORES DE USO ==============================

CREATE TABLE IF NOT EXISTS public.usage_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    emails_sent INT NOT NULL DEFAULT 0 CHECK (emails_sent >= 0),
    UNIQUE(user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_user_period
    ON public.usage_counters(user_id, period_start);

-- ==================== CUSTOMER DE STRIPE EN USERS =========================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

-- ============================== RLS (§7.3) ================================

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

-- El catálogo de planes es de lectura pública para usuarios autenticados.
DROP POLICY IF EXISTS plans_read_all ON public.plans;
CREATE POLICY plans_read_all ON public.plans
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS subscriptions_tenant_isolation ON public.subscriptions;
CREATE POLICY subscriptions_tenant_isolation ON public.subscriptions
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS usage_counters_tenant_isolation ON public.usage_counters;
CREATE POLICY usage_counters_tenant_isolation ON public.usage_counters
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
