-- KURA - Migración 0005: RLS defensivo (§7.3, defense in depth)
-- apps/api-workers/src/db/migrations/0005_rls.sql
--
-- Deja explícito el Row Level Security en las 7 tablas. NO se crean policies
-- permisivas a propósito: los Workers se conectan con postgres.js/DATABASE_URL
-- (rol propietario) y bypasean RLS; cualquier acceso directo desde clientes
-- queda DENEGADO por defecto. Las policies por auth.uid() se añadirán cuando se
-- exponga acceso directo con Supabase JS.

ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.verified_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.list_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.campaign_events ENABLE ROW LEVEL SECURITY;
