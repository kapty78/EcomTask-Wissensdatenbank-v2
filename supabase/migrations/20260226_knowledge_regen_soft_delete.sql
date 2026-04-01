-- Migration: Soft-delete Schutz für Fakten-Regenerierung
-- Wenn N8N ausfällt oder der User die Seite verlässt, werden alte Fakten
-- nach 4 Minuten durch einen Vercel Cron automatisch wiederhergestellt.

ALTER TABLE public.knowledge_items
  ADD COLUMN IF NOT EXISTS is_pending_regeneration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS regeneration_started_at timestamptz;

-- Bestehende Rows explizit auf false setzen (idempotent)
UPDATE public.knowledge_items
  SET is_pending_regeneration = false
  WHERE is_pending_regeneration IS NULL;

-- Index für effizienten Cron-Query
CREATE INDEX IF NOT EXISTS idx_knowledge_items_pending_regen
  ON public.knowledge_items (source_chunk, regeneration_started_at)
  WHERE is_pending_regeneration = true;
