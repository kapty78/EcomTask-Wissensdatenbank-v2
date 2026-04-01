-- Migration: Initialisierung der user_metrics Tabelle und Berechnungsfunktionen
-- Datum: 2025-09-23

-- Funktion zur Berechnung und Aktualisierung der user_metrics
CREATE OR REPLACE FUNCTION update_user_metrics()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    user_record RECORD;
    total_logs integer;
    avg_response_time numeric;
    last_activity timestamp with time zone;
    last_email timestamp with time zone;
BEGIN
    -- Für jeden Benutzer die Metriken berechnen
    FOR user_record IN SELECT id FROM auth.users WHERE id IN (SELECT DISTINCT user_id FROM public.process_logs)
    LOOP
        -- Anzahl der Process Logs berechnen
        SELECT COUNT(*)
        INTO total_logs
        FROM public.process_logs
        WHERE user_id = user_record.id;

        -- Durchschnittliche First Response Time berechnen
        SELECT COALESCE(AVG(first_response_time), 0)
        INTO avg_response_time
        FROM public.process_logs
        WHERE user_id = user_record.id
          AND first_response_time IS NOT NULL
          AND first_response_time > 0;

        -- Letzte Aktivität finden
        SELECT GREATEST(
            (SELECT MAX(updated_at) FROM public.process_logs WHERE user_id = user_record.id),
            (SELECT MAX(created_at) FROM public.user_activities WHERE user_id = user_record.id)
        )
        INTO last_activity;

        -- Letzte E-Mail-Verarbeitung
        SELECT MAX(created_at)
        INTO last_email
        FROM public.process_logs
        WHERE user_id = user_record.id;

        -- Upsert in user_metrics
        INSERT INTO public.user_metrics (
            user_id,
            total_process_logs,
            avg_first_response_time,
            last_activity_at,
            last_email_processed_at,
            updated_at
        )
        VALUES (
            user_record.id,
            total_logs,
            avg_response_time,
            last_activity,
            last_email,
            now()
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
            total_process_logs = EXCLUDED.total_process_logs,
            avg_first_response_time = EXCLUDED.avg_first_response_time,
            last_activity_at = EXCLUDED.last_activity_at,
            last_email_processed_at = EXCLUDED.last_email_processed_at,
            updated_at = now();
    END LOOP;
END;
$$;

-- Trigger-Funktion für automatische Updates bei neuen process_logs
CREATE OR REPLACE FUNCTION trigger_update_user_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Nach Insert oder Update in process_logs die Metriken aktualisieren
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        PERFORM update_user_metrics();
    END IF;
    RETURN NEW;
END;
$$;

-- Trigger erstellen
CREATE TRIGGER process_logs_update_metrics
    AFTER INSERT OR UPDATE ON public.process_logs
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_user_metrics();

-- Initiale Befüllung der user_metrics Tabelle
SELECT update_user_metrics();

-- Kommentare hinzufügen
COMMENT ON FUNCTION update_user_metrics() IS 'Berechnet und aktualisiert die Metriken für alle Benutzer basierend auf process_logs und user_activities (ohne Token-Tracking)';
COMMENT ON TABLE public.user_metrics IS 'Speichert aggregierte Metriken pro Benutzer für Admin-Übersicht';
