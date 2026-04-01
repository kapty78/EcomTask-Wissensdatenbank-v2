-- Migration zur Erweiterung der document_chunks-Tabelle für verteilte Verarbeitung
-- Dieses Skript fügt Felder hinzu, um den Verarbeitungsstatus jedes Chunks zu verfolgen
-- ERWEITERT: Einheitliches Schema für bessere Datenorganisation

-- Überprüfe, ob die Tabelle existiert
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'document_chunks'
    ) THEN
        -- Überprüfe, ob die Spalten bereits existieren, um doppelte Hinzufügungen zu vermeiden
        
        -- Feld für den Verarbeitungsstatus
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'processing_complete'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN processing_complete BOOLEAN DEFAULT FALSE;
            RAISE NOTICE 'Spalte processing_complete zur Tabelle document_chunks hinzugefügt';
        ELSE
            RAISE NOTICE 'Spalte processing_complete existiert bereits in der Tabelle document_chunks';
        END IF;
        
        -- Feld für die Anzahl der extrahierten Fakten
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'facts_count'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN facts_count INTEGER DEFAULT 0;
            RAISE NOTICE 'Spalte facts_count zur Tabelle document_chunks hinzugefügt';
        ELSE
            RAISE NOTICE 'Spalte facts_count existiert bereits in der Tabelle document_chunks';
        END IF;
        
        -- Feld für mögliche Fehler während der Verarbeitung
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'processing_error'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN processing_error TEXT DEFAULT NULL;
            RAISE NOTICE 'Spalte processing_error zur Tabelle document_chunks hinzugefügt';
        ELSE
            RAISE NOTICE 'Spalte processing_error existiert bereits in der Tabelle document_chunks';
        END IF;
        
        -- Feld für den Zeitpunkt der letzten Aktualisierung
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'updated_at'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
            RAISE NOTICE 'Spalte updated_at zur Tabelle document_chunks hinzugefügt';
        ELSE
            RAISE NOTICE 'Spalte updated_at existiert bereits in der Tabelle document_chunks';
        END IF;

        -- NEUE FELDER für bessere Datenorganisation
        
        -- Chunk-Qualitätsbewertung
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'quality_score'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN quality_score INTEGER DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100);
            RAISE NOTICE 'Spalte quality_score zur Tabelle document_chunks hinzugefügt';
        END IF;
        
        -- Erkannter Dokumenttyp
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'document_type'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN document_type TEXT DEFAULT 'default' 
                CHECK (document_type IN ('contract', 'manual', 'specification', 'report', 'email', 'table', 'default'));
            RAISE NOTICE 'Spalte document_type zur Tabelle document_chunks hinzugefügt';
        END IF;
        
        -- Chunk-Inhaltslänge (für Performance-Optimierung)
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'content_length'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN content_length INTEGER DEFAULT 0;
            RAISE NOTICE 'Spalte content_length zur Tabelle document_chunks hinzugefügt';
        END IF;
        
        -- Token-Anzahl (für LLM-Kosten-Tracking)
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'content_tokens'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN content_tokens INTEGER DEFAULT 0;
            RAISE NOTICE 'Spalte content_tokens zur Tabelle document_chunks hinzugefügt';
        END IF;

        -- Chunk-Verarbeitungszeit (für Performance-Monitoring)
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'document_chunks' 
            AND column_name = 'processing_duration_ms'
        ) THEN
            ALTER TABLE public.document_chunks ADD COLUMN processing_duration_ms INTEGER DEFAULT 0;
            RAISE NOTICE 'Spalte processing_duration_ms zur Tabelle document_chunks hinzugefügt';
        END IF;

        -- NEUE INDIZES für bessere Performance
        
        -- Index für Verarbeitungsstatus-Abfragen
        IF NOT EXISTS (
            SELECT FROM pg_indexes 
            WHERE tablename = 'document_chunks' 
            AND indexname = 'idx_document_chunks_processing_complete'
        ) THEN
            CREATE INDEX idx_document_chunks_processing_complete ON public.document_chunks(processing_complete);
            RAISE NOTICE 'Index idx_document_chunks_processing_complete erstellt';
        END IF;

        -- Index für Dokumenttyp-Abfragen
        IF NOT EXISTS (
            SELECT FROM pg_indexes 
            WHERE tablename = 'document_chunks' 
            AND indexname = 'idx_document_chunks_document_type'
        ) THEN
            CREATE INDEX idx_document_chunks_document_type ON public.document_chunks(document_type);
            RAISE NOTICE 'Index idx_document_chunks_document_type erstellt';
        END IF;

        -- Index für Qualitätsbewertung
        IF NOT EXISTS (
            SELECT FROM pg_indexes 
            WHERE tablename = 'document_chunks' 
            AND indexname = 'idx_document_chunks_quality_score'
        ) THEN
            CREATE INDEX idx_document_chunks_quality_score ON public.document_chunks(quality_score DESC);
            RAISE NOTICE 'Index idx_document_chunks_quality_score erstellt';
        END IF;

        -- Trigger für automatische Aktualisierung von content_length
        IF NOT EXISTS (
            SELECT FROM information_schema.triggers 
            WHERE trigger_name = 'update_content_length_trigger'
        ) THEN
            CREATE OR REPLACE FUNCTION update_content_length()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.content_length = LENGTH(NEW.content);
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            CREATE TRIGGER update_content_length_trigger
                BEFORE INSERT OR UPDATE ON public.document_chunks
                FOR EACH ROW
                EXECUTE FUNCTION update_content_length();
            
            RAISE NOTICE 'Trigger update_content_length_trigger erstellt';
        END IF;
        
        -- Setze die API-Secret-Umgebungsvariable, falls sie noch nicht existiert
        -- Dies ist nur eine Erinnerung - API-Secrets sollten nicht in SQL-Skripten gespeichert werden
        RAISE NOTICE 'ERINNERUNG: Stellen Sie sicher, dass die Umgebungsvariable API_SECRET_KEY gesetzt ist!';
        
    ELSE
        RAISE EXCEPTION 'Tabelle document_chunks existiert nicht!';
    END IF;
END $$; 

-- ZUSÄTZLICHE OPTIMIERUNGEN

-- Füge RPC-Funktion für erweiterte Chunk-Statistiken hinzu
CREATE OR REPLACE FUNCTION get_chunk_processing_stats(document_id_param UUID)
RETURNS TABLE (
    total_chunks INTEGER,
    processed_chunks INTEGER,
    failed_chunks INTEGER,
    avg_quality_score NUMERIC,
    total_facts INTEGER,
    avg_processing_time_ms NUMERIC,
    document_types_found TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_chunks,
        COUNT(CASE WHEN processing_complete = true THEN 1 END)::INTEGER as processed_chunks,
        COUNT(CASE WHEN processing_error IS NOT NULL THEN 1 END)::INTEGER as failed_chunks,
        ROUND(AVG(quality_score), 2) as avg_quality_score,
        SUM(facts_count)::INTEGER as total_facts,
        ROUND(AVG(processing_duration_ms), 2) as avg_processing_time_ms,
        ARRAY_AGG(DISTINCT document_type) as document_types_found
    FROM public.document_chunks
    WHERE document_id = document_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Berechtigungen für die neue Funktion
GRANT EXECUTE ON FUNCTION get_chunk_processing_stats(UUID) TO authenticated; 