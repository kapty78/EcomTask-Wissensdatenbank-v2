-- Fix Storage Bucket Policies for documents bucket
-- This ensures files can be accessed properly

-- Create the documents bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents', 
  true,  -- Make bucket public for read access
  209715200, -- 200MB limit
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

-- Drop existing policies to recreate them
DROP POLICY IF EXISTS "Allow authenticated users to upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role full access" ON storage.objects;

-- Policy 1: Allow authenticated users to upload their own files
CREATE POLICY "Allow authenticated users to upload" ON storage.objects
FOR INSERT 
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy 2: Allow authenticated users to update their own files
CREATE POLICY "Allow authenticated users to update" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy 3: Allow authenticated users to delete their own files
CREATE POLICY "Allow authenticated users to delete" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy 4: Allow public read access to all files in documents bucket
-- This is needed for the public URLs to work
CREATE POLICY "Allow public read access" ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'documents');

-- Policy 5: Allow service role full access (for admin operations)
CREATE POLICY "Allow service role full access" ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'documents')
WITH CHECK (bucket_id = 'documents');

-- Also create simplified upload policies that don't require specific folder structure
-- This is for the simplified upload paths we're using

-- Policy 6: Simple authenticated upload
CREATE POLICY "Simple authenticated upload" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (
    -- Allow uploads to these specific folders
    name LIKE 'uploads_test/%' OR
    name LIKE 'uploads_large/%' OR
    name LIKE 'uploads/%'
  )
);

-- Policy 7: Simple authenticated update
CREATE POLICY "Simple authenticated update" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (
    name LIKE 'uploads_test/%' OR
    name LIKE 'uploads_large/%' OR
    name LIKE 'uploads/%'
  )
)
WITH CHECK (
  bucket_id = 'documents' AND
  (
    name LIKE 'uploads_test/%' OR
    name LIKE 'uploads_large/%' OR
    name LIKE 'uploads/%'
  )
);

-- Policy 8: Simple authenticated delete
CREATE POLICY "Simple authenticated delete" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (
    name LIKE 'uploads_test/%' OR
    name LIKE 'uploads_large/%' OR
    name LIKE 'uploads/%'
  )
);

-- Grant necessary permissions
GRANT ALL ON storage.objects TO authenticated;
GRANT ALL ON storage.objects TO service_role;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT ON storage.objects TO public;

-- Verify the policies were created
DO $$
BEGIN
  RAISE NOTICE 'Storage policies have been updated. Documents bucket is now public for read access.';
END $$; 