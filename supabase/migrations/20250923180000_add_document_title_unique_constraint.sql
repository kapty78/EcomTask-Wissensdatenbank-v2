-- Add unique constraint for document titles per user
-- This ensures that each user cannot have multiple documents with the same title

-- First, clean up any existing duplicates (keep the latest one)
WITH duplicate_docs AS (
  SELECT 
    title,
    user_id,
    MAX(created_at) as latest_created_at
  FROM documents 
  WHERE title IS NOT NULL 
  GROUP BY title, user_id
  HAVING COUNT(*) > 1
),
docs_to_keep AS (
  SELECT d.id
  FROM documents d
  INNER JOIN duplicate_docs dd ON d.title = dd.title 
    AND d.user_id = dd.user_id 
    AND d.created_at = dd.latest_created_at
),
docs_to_rename AS (
  SELECT d.id, d.title, d.user_id,
    ROW_NUMBER() OVER (PARTITION BY d.title, d.user_id ORDER BY d.created_at) as rn
  FROM documents d
  WHERE d.title IS NOT NULL
    AND d.id NOT IN (SELECT id FROM docs_to_keep)
)
UPDATE documents 
SET title = CONCAT(title, ' (', rn, ')')
FROM docs_to_rename
WHERE documents.id = docs_to_rename.id;

-- Now add the unique constraint
ALTER TABLE documents 
ADD CONSTRAINT documents_title_user_unique 
UNIQUE (title, user_id);

-- Add comment for documentation
COMMENT ON CONSTRAINT documents_title_user_unique ON documents IS 'Ensures each user can only have one document with the same title';
