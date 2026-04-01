-- Migration: Create user_metrics table for better performance
-- This table will store aggregated metrics per user for faster queries

CREATE TABLE IF NOT EXISTS user_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Activity metrics
    total_process_logs INTEGER DEFAULT 0,
    total_knowledge_bases INTEGER DEFAULT 0,
    total_email_accounts INTEGER DEFAULT 0,
    total_documents INTEGER DEFAULT 0,
    
    -- Performance metrics
    avg_first_response_time NUMERIC DEFAULT 0,
    total_processing_time NUMERIC DEFAULT 0,
    
    -- Time-based metrics
    last_activity_at TIMESTAMP WITH TIME ZONE,
    last_email_processed_at TIMESTAMP WITH TIME ZONE,
    first_activity_at TIMESTAMP WITH TIME ZONE,
    
    -- Meta data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_metrics_user_id ON user_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_user_metrics_last_activity ON user_metrics(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_user_metrics_updated_at ON user_metrics(updated_at);

-- Enable RLS
ALTER TABLE user_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own metrics, super admins can see all
CREATE POLICY user_metrics_select_policy ON user_metrics
    FOR SELECT USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_super_admin = true
        )
    );

-- RLS Policy: Only super admins can insert/update metrics
CREATE POLICY user_metrics_insert_policy ON user_metrics
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_super_admin = true
        )
    );

CREATE POLICY user_metrics_update_policy ON user_metrics
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_super_admin = true
        )
    );

-- Function to update user metrics
CREATE OR REPLACE FUNCTION update_user_metrics(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    process_logs_count INTEGER;
    knowledge_bases_count INTEGER;
    email_accounts_count INTEGER;
    documents_count INTEGER;
    avg_response_time NUMERIC;
    total_proc_time NUMERIC;
    last_activity TIMESTAMP WITH TIME ZONE;
    last_email_proc TIMESTAMP WITH TIME ZONE;
    first_activity TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Calculate metrics
    SELECT COUNT(*) INTO process_logs_count
    FROM process_logs WHERE user_id = target_user_id;

    SELECT COUNT(*) INTO knowledge_bases_count
    FROM knowledge_bases WHERE user_id = target_user_id;

    SELECT COUNT(*) INTO email_accounts_count
    FROM user_email_accounts WHERE user_id = target_user_id;

    SELECT COUNT(*) INTO documents_count
    FROM documents WHERE user_id = target_user_id;

    SELECT AVG(processing_time), SUM(processing_time) 
    INTO avg_response_time, total_proc_time
    FROM process_logs 
    WHERE user_id = target_user_id 
    AND processing_time IS NOT NULL;

    SELECT MAX(created_at) INTO last_activity
    FROM process_logs WHERE user_id = target_user_id;

    SELECT MAX(created_at) INTO last_email_proc
    FROM process_logs 
    WHERE user_id = target_user_id 
    AND customer_mail IS NOT NULL;

    SELECT MIN(created_at) INTO first_activity
    FROM process_logs WHERE user_id = target_user_id;

    -- Insert or update metrics
    INSERT INTO user_metrics (
        user_id,
        total_process_logs,
        total_knowledge_bases,
        total_email_accounts,
        total_documents,
        avg_first_response_time,
        total_processing_time,
        last_activity_at,
        last_email_processed_at,
        first_activity_at,
        updated_at
    ) VALUES (
        target_user_id,
        COALESCE(process_logs_count, 0),
        COALESCE(knowledge_bases_count, 0),
        COALESCE(email_accounts_count, 0),
        COALESCE(documents_count, 0),
        COALESCE(avg_response_time, 0),
        COALESCE(total_proc_time, 0),
        last_activity,
        last_email_proc,
        first_activity,
        NOW()
    )
    ON CONFLICT (user_id) 
    DO UPDATE SET
        total_process_logs = EXCLUDED.total_process_logs,
        total_knowledge_bases = EXCLUDED.total_knowledge_bases,
        total_email_accounts = EXCLUDED.total_email_accounts,
        total_documents = EXCLUDED.total_documents,
        avg_first_response_time = EXCLUDED.avg_first_response_time,
        total_processing_time = EXCLUDED.total_processing_time,
        last_activity_at = EXCLUDED.last_activity_at,
        last_email_processed_at = EXCLUDED.last_email_processed_at,
        first_activity_at = COALESCE(user_metrics.first_activity_at, EXCLUDED.first_activity_at),
        updated_at = NOW();
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_user_metrics(UUID) TO authenticated;
