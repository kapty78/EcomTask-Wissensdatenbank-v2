-- Migration: Add instructions field to document_chunks
-- Datum: 2025-10-04
-- Beschreibung: Fügt ein instructions Feld hinzu, um AI-Anweisungen pro Chunk zu speichern

-- Füge instructions Spalte hinzu
ALTER TABLE public.document_chunks
ADD COLUMN IF NOT EXISTS instructions TEXT;

-- Index für Suche nach Chunks mit Anweisungen
CREATE INDEX IF NOT EXISTS idx_document_chunks_has_instructions 
ON public.document_chunks(id) 
WHERE instructions IS NOT NULL AND instructions != '';

-- Kommentar zur Spalte
COMMENT ON COLUMN public.document_chunks.instructions IS 
'Anweisungen für das KI-Modell, wie mit diesem Chunk umgegangen werden soll. Beispiel: "Nutze das Tool CRM, falls du dem User eine Rechnung zuschicken musst."';

