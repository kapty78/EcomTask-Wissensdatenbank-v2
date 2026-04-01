-- Create table for batch processing mismatch analysis jobs
CREATE TABLE IF NOT EXISTS mismatch_analysis_jobs (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  conflicts_found JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_mismatch_jobs_knowledge_base 
  ON mismatch_analysis_jobs(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_mismatch_jobs_status 
  ON mismatch_analysis_jobs(status);

-- Create trigger to update updated_at column
CREATE OR REPLACE FUNCTION update_mismatch_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_mismatch_analysis_jobs_updated_at
  BEFORE UPDATE ON mismatch_analysis_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_mismatch_jobs_updated_at();

-- Clean up old completed jobs (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_mismatch_jobs()
RETURNS void AS $$
BEGIN
  DELETE FROM mismatch_analysis_jobs 
  WHERE status = 'completed' 
    AND completed_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT ALL ON mismatch_analysis_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON mismatch_analysis_jobs TO authenticated; 