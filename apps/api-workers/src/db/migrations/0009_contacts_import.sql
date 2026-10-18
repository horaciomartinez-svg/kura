-- KURA - Migración 0009: importación CSV de contactos (F2, §7.2, §12.2)
-- apps/api-workers/src/db/migrations/0009_contacts_import.sql
--
-- Deja la tabla contacts lista para importaciones idempotentes por tenant:
--   1) Verifica/agrega las columnas que usa KURA.
--   2) Limpia duplicados históricos conservando la fila más antigua.
--   3) Garantiza UNIQUE(user_id, email), requisito del ON CONFLICT DO NOTHING.
--   4) Normaliza el CHECK de status y refuerza RLS.

-- ===================== 1) COLUMNAS REQUERIDAS =============================

ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

UPDATE public.contacts SET status = 'active' WHERE status IS NULL;
UPDATE public.contacts SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;

-- ================= 2) LIMPIEZA DE DUPLICADOS HISTÓRICOS ===================
-- Conserva la fila más antigua de cada (user_id, email). Si created_at empata
-- se usa el UUID como desempate estable.

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, email
            ORDER BY created_at ASC NULLS LAST, id ASC
        ) AS row_num
    FROM public.contacts
    WHERE user_id IS NOT NULL AND email IS NOT NULL
)
DELETE FROM public.contacts AS c
USING ranked AS r
WHERE c.id = r.id
  AND r.row_num > 1;

-- ================= 3) UNIQUE(user_id, email) IDEMPOTENTE ==================

DO $$
DECLARE
    user_id_attnum SMALLINT;
    email_attnum SMALLINT;
BEGIN
    SELECT attnum INTO user_id_attnum
    FROM pg_attribute
    WHERE attrelid = 'public.contacts'::regclass
      AND attname = 'user_id'
      AND NOT attisdropped;

    SELECT attnum INTO email_attnum
    FROM pg_attribute
    WHERE attrelid = 'public.contacts'::regclass
      AND attname = 'email'
      AND NOT attisdropped;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS c
        WHERE c.conrelid = 'public.contacts'::regclass
          AND c.contype = 'u'
          AND c.conkey @> ARRAY[user_id_attnum, email_attnum]::SMALLINT[]
          AND c.conkey <@ ARRAY[user_id_attnum, email_attnum]::SMALLINT[]
    ) THEN
        ALTER TABLE public.contacts
            ADD CONSTRAINT contacts_user_id_email_unique UNIQUE (user_id, email);
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        -- Ya existe una restricción equivalente con otro nombre.
        NULL;
END;
$$;

-- ================= 4) STATUS VÁLIDO Y RLS =================================

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_status_check CHECK (
    status IN ('active', 'bounced', 'unsubscribed', 'complained')
);

CREATE INDEX IF NOT EXISTS idx_contacts_user_created_at
    ON public.contacts(user_id, created_at DESC);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
