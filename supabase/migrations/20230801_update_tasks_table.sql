-- Drop the old column if it exists
ALTER TABLE tasks 
DROP COLUMN IF EXISTS knowledge_base_id;

-- Add a new array column for knowledge base IDs
ALTER TABLE tasks 
ADD COLUMN knowledge_base_ids UUID[] DEFAULT '{}';

-- Add comment for better documentation
COMMENT ON COLUMN tasks.knowledge_base_ids IS 'Array of knowledge base IDs that are associated with this task';

-- Create an index for better performance when querying based on knowledge base IDs
CREATE INDEX IF NOT EXISTS idx_tasks_knowledge_base_ids ON tasks USING GIN(knowledge_base_ids); 