-- KURA - Migración 0006: assets (imágenes del editor en Cloudflare R2)
-- apps/api-workers/src/db/migrations/0006_assets.sql
--
-- Imágenes subidas desde el editor Easy-Email (§12.5). El binario vive en R2
-- (bucket kura-assets) y esta tabla guarda los metadatos y la URL pública
-- inmutable que el editor incrusta en el design_json.
-- RLS habilitado como segunda línea de defensa (§7.3, §14).

CREATE TABLE IF NOT EXISTS public.assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL,
    public_url TEXT NOT NULL,
    content_type VARCHAR(100),
    size_bytes INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_user_id ON public.assets(user_id);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
