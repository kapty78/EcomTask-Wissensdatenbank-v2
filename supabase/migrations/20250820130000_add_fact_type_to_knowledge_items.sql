-- Add fact_type column to knowledge_items to store the semantic type of extracted facts
ALTER TABLE knowledge_items
ADD COLUMN IF NOT EXISTS fact_type TEXT;

-- Optional: simple check constraint to limit to known values (kept flexible for now)
-- ALTER TABLE knowledge_items
-- ADD CONSTRAINT fact_type_check CHECK (fact_type IS NULL OR fact_type IN (
--   'date','amount','person','role','step','rule','spec','contact','condition','feature','organization','location','definition','other'
-- ));

-- Index for filtering by fact type
CREATE INDEX IF NOT EXISTS idx_knowledge_items_fact_type ON knowledge_items(fact_type);

