-- Update Storage Bucket to support all required document MIME types
-- This includes .doc, .docx, .pdf, .txt, .md, .html files

-- Update the documents bucket with all supported MIME types
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents', 
  true,  -- Make bucket public for read access
  209715200, -- 200MB limit (updated from 50MB)
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/html',
    'application/msword', -- .doc files
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- .docx files
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', -- .xlsx files
    'application/vnd.ms-excel' -- .xls files
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Verify the update
DO $$
DECLARE
  bucket_config RECORD;
BEGIN
  SELECT * INTO bucket_config FROM storage.buckets WHERE id = 'documents';
  
  RAISE NOTICE 'Documents bucket configuration:';
  RAISE NOTICE '  - Public: %', bucket_config.public;
  RAISE NOTICE '  - File size limit: % MB', bucket_config.file_size_limit / (1024 * 1024);
  RAISE NOTICE '  - Allowed MIME types: %', bucket_config.allowed_mime_types;
  RAISE NOTICE 'Storage bucket updated successfully!';
END $$;



