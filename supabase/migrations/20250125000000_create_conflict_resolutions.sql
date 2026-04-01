-- Create table for tracking conflict resolutions
CREATE TABLE IF NOT EXISTS conflict_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id TEXT NOT NULL,
  kept_item_id TEXT NOT NULL,
  removed_item_ids TEXT[] NOT NULL,
  resolved_by TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_knowledge_base
  ON conflict_resolutions(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_resolved_by
  ON conflict_resolutions(resolved_by);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_resolved_at
  ON conflict_resolutions(resolved_at);

-- Add foreign key constraints
ALTER TABLE conflict_resolutions
ADD CONSTRAINT fk_conflict_resolutions_knowledge_base
FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE conflict_resolutions
ADD CONSTRAINT fk_conflict_resolutions_kept_item
FOREIGN KEY (kept_item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE;

-- Grant necessary permissions
GRANT ALL ON conflict_resolutions TO service_role;
GRANT SELECT, INSERT ON conflict_resolutions TO authenticated;
