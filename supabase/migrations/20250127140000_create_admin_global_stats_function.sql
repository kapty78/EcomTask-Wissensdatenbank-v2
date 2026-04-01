-- Migration: Create admin global stats function
-- This function provides global statistics for the admin dashboard

CREATE OR REPLACE FUNCTION get_admin_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    total_users INTEGER;
    total_process_logs INTEGER;
    total_knowledge_bases INTEGER;
    total_email_accounts INTEGER;
    total_documents INTEGER;
    avg_response_time NUMERIC;
    active_users_last_30_days INTEGER;
    result JSON;
BEGIN
    -- Count total users
    SELECT COUNT(*) INTO total_users
    FROM auth.users;

    -- Count total process logs
    SELECT COUNT(*) INTO total_process_logs
    FROM process_logs;

    -- Count total knowledge bases
    SELECT COUNT(*) INTO total_knowledge_bases
    FROM knowledge_bases;

    -- Count total email accounts
    SELECT COUNT(*) INTO total_email_accounts
    FROM user_email_accounts;

    -- Count total documents
    SELECT COUNT(*) INTO total_documents
    FROM documents;

    -- Calculate average response time from process logs
    SELECT AVG(processing_time) INTO avg_response_time
    FROM process_logs
    WHERE processing_time IS NOT NULL
    AND processing_time > 0;

    -- Count active users in last 30 days (users who have process logs)
    SELECT COUNT(DISTINCT user_id) INTO active_users_last_30_days
    FROM process_logs
    WHERE created_at >= NOW() - INTERVAL '30 days';

    -- Build result JSON
    result := json_build_object(
        'totalUsers', COALESCE(total_users, 0),
        'totalProcessLogs', COALESCE(total_process_logs, 0),
        'totalKnowledgeBases', COALESCE(total_knowledge_bases, 0),
        'totalEmailAccounts', COALESCE(total_email_accounts, 0),
        'totalDocuments', COALESCE(total_documents, 0),
        'avgFirstResponseTime', COALESCE(avg_response_time, 0),
        'activeUsersLast30Days', COALESCE(active_users_last_30_days, 0),
        'generatedAt', NOW()
    );

    RETURN result;
END;
$$;

-- Grant execute permission to authenticated users (will be restricted in RLS)
GRANT EXECUTE ON FUNCTION get_admin_global_stats() TO authenticated;

-- Create RLS policy to only allow super admins to call this function
-- This will be enforced at the API level for now
