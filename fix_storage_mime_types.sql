-- SOFORT-FIX für Storage MIME Types Problem
-- Führen Sie dieses Skript im Supabase Dashboard SQL Editor aus
-- Dashboard: https://app.supabase.com -> Ihr Projekt -> SQL Editor

-- Update Storage Bucket mit allen unterstützten Dateitypen
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents', 
  true,
  209715200, -- 200MB limit
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/html',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Bestätigung ausgeben
SELECT 
  'Storage Bucket erfolgreich aktualisiert!' as status,
  name,
  public,
  file_size_limit / (1024 * 1024) as size_limit_mb,
  allowed_mime_types
FROM storage.buckets 
WHERE id = 'documents';



