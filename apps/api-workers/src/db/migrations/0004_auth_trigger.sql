-- KURA - Migración 0004: trigger de registro (Supabase Auth -> public.users)
-- apps/api-workers/src/db/migrations/0004_auth_trigger.sql
--
-- Al insertarse una fila en auth.users (registro vía Supabase Auth), se crea la
-- fila espejo en public.users con el periodo de prueba de 7 días (§12.1).
-- SECURITY DEFINER permite escribir en public.users aunque el rol de Auth no
-- tenga privilegios directos. La función es idempotente (ON CONFLICT DO NOTHING)
-- para tolerar reintentos del trigger.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, email, status, trial_sends_count, trial_expires_at)
    VALUES (
        NEW.id,
        NEW.email,
        'active',
        0,
        NOW() + INTERVAL '7 days'
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
