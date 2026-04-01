-- Manuelle Initialisierung der user_metrics Tabelle
-- Führe dies in der Supabase Console aus

-- 1. Prüfen ob die Tabellen existieren
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('user_metrics', 'process_logs', 'profiles');

-- 2. Prüfen ob die neuen Spalten in profiles existieren
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'profiles' 
AND column_name IN ('knowledge_base_limit', 'email_account_limit', 'executive_report_enabled');

-- 3. Prüfen ob die Funktion existiert
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name = 'update_user_metrics';

-- 4. Falls alles existiert, Metriken berechnen
SELECT update_user_metrics();

-- 5. Prüfen was in user_metrics steht
SELECT 
    um.*,
    p.full_name 
FROM user_metrics um
JOIN profiles p ON um.user_id = p.id
ORDER BY um.updated_at DESC;

-- 6. Fallback: Direkte Befüllung falls Funktion nicht existiert
INSERT INTO user_metrics (user_id, total_process_logs, avg_first_response_time, last_activity_at, last_email_processed_at)
SELECT 
    pl.user_id,
    COUNT(*) as total_process_logs,
    AVG(COALESCE(pl.processing_time, 0)) as avg_first_response_time,
    MAX(pl.updated_at) as last_activity_at,
    MAX(pl.created_at) as last_email_processed_at
FROM process_logs pl
GROUP BY pl.user_id
ON CONFLICT (user_id) 
DO UPDATE SET
    total_process_logs = EXCLUDED.total_process_logs,
    avg_first_response_time = EXCLUDED.avg_first_response_time,
    last_activity_at = EXCLUDED.last_activity_at,
    last_email_processed_at = EXCLUDED.last_email_processed_at,
    updated_at = now();
