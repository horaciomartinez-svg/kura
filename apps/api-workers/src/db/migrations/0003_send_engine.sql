-- KURA - Migración 0003: columnas del motor de envíos y autosave
-- apps/api-workers/src/db/migrations/0003_send_engine.sql
--
-- Requeridas por el productor de envíos (§10.1: UPDATE status='sending',
-- started_at=NOW(), total_recipients=N) y por el autosave del editor
-- (§9.4: actualiza design_json + updated_at). Provienen del esquema
-- consolidado §7.2.

ALTER TABLE campaigns
    ADD COLUMN started_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN total_recipients INT DEFAULT 0,
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
