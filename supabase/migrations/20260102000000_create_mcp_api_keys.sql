-- Migration: Create MCP API Keys and Audit Logs Tables
-- Description: Tables für externe MCP Server Zugriffe mit API Key Authentication

-- ============================================================================
-- MCP API KEYS TABLE
-- ============================================================================
-- Speichert API Keys für externe Zugriffe (ChatGPT, Cursor, etc.)
-- Jeder Key ist an eine Company und eine Knowledge Base gebunden

CREATE TABLE IF NOT EXISTS mcp_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Tenant Binding
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    
    -- Key Storage (nur Hash, nie Klartext!)
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix VARCHAR(12) NOT NULL,  -- z.B. "sk_live_abc1" für Identifikation
    
    -- Metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Rate Limiting
    rate_limit_per_minute INT DEFAULT 60,
    
    -- Usage Tracking
    last_used_at TIMESTAMPTZ,
    total_requests INT DEFAULT 0,
    
    -- Lifecycle
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    -- Status
    is_active BOOLEAN DEFAULT true
);

-- Indexes für Performance
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_hash ON mcp_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_company ON mcp_api_keys(company_id);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_kb ON mcp_api_keys(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_active ON mcp_api_keys(is_active) WHERE is_active = true;

-- ============================================================================
-- MCP AUDIT LOGS TABLE
-- ============================================================================
-- Protokolliert alle MCP Tool-Aufrufe für Nachvollziehbarkeit und Debugging

CREATE TABLE IF NOT EXISTS mcp_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- References
    api_key_id UUID REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
    company_id UUID NOT NULL,
    knowledge_base_id UUID NOT NULL,
    
    -- Request Details
    tool_name TEXT NOT NULL,
    query_preview TEXT,  -- Erste 100 Zeichen der Query (Privacy)
    
    -- Response Details
    results_count INT,
    tokens_used INT,
    response_time_ms INT,
    
    -- Error Tracking
    error_message TEXT,
    error_code TEXT,
    
    -- Metadata
    client_ip TEXT,
    user_agent TEXT,
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes für Audit Queries
CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_api_key ON mcp_audit_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_company ON mcp_audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_created ON mcp_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_tool ON mcp_audit_logs(tool_name);

-- Partitioning-freundlicher Index für zeitbasierte Queries
CREATE INDEX IF NOT EXISTS idx_mcp_audit_logs_company_time 
ON mcp_audit_logs(company_id, created_at DESC);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function zum Aktualisieren von updated_at
CREATE OR REPLACE FUNCTION update_mcp_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger für updated_at
DROP TRIGGER IF EXISTS trigger_mcp_api_keys_updated_at ON mcp_api_keys;
CREATE TRIGGER trigger_mcp_api_keys_updated_at
    BEFORE UPDATE ON mcp_api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_mcp_api_keys_updated_at();

-- Function zum Inkrementieren des Request Counters
CREATE OR REPLACE FUNCTION mcp_increment_api_key_usage(p_key_hash TEXT)
RETURNS TABLE (
    key_id UUID,
    company_id UUID,
    knowledge_base_id UUID,
    rate_limit INT,
    is_valid BOOLEAN
) AS $$
DECLARE
    v_key RECORD;
BEGIN
    -- Finde und validiere den Key
    SELECT 
        ak.id,
        ak.company_id,
        ak.knowledge_base_id,
        ak.rate_limit_per_minute,
        ak.is_active,
        ak.expires_at
    INTO v_key
    FROM mcp_api_keys ak
    WHERE ak.key_hash = p_key_hash
    FOR UPDATE;
    
    -- Key nicht gefunden
    IF v_key IS NULL THEN
        RETURN QUERY SELECT 
            NULL::UUID,
            NULL::UUID,
            NULL::UUID,
            0::INT,
            false;
        RETURN;
    END IF;
    
    -- Key inaktiv oder abgelaufen
    IF NOT v_key.is_active OR (v_key.expires_at IS NOT NULL AND v_key.expires_at < NOW()) THEN
        RETURN QUERY SELECT 
            v_key.id,
            v_key.company_id,
            v_key.knowledge_base_id,
            v_key.rate_limit_per_minute,
            false;
        RETURN;
    END IF;
    
    -- Update Usage Stats
    UPDATE mcp_api_keys
    SET 
        last_used_at = NOW(),
        total_requests = total_requests + 1
    WHERE id = v_key.id;
    
    -- Return valid key info
    RETURN QUERY SELECT 
        v_key.id,
        v_key.company_id,
        v_key.knowledge_base_id,
        v_key.rate_limit_per_minute,
        true;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE mcp_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_audit_logs ENABLE ROW LEVEL SECURITY;

-- API Keys: Nur Company Admins können Keys ihrer Company sehen/verwalten
CREATE POLICY "Company admins can view own api keys"
ON mcp_api_keys FOR SELECT
USING (
    company_id IN (
        SELECT ca.company_id 
        FROM company_admins ca 
        WHERE ca.user_id = auth.uid()
    )
    OR
    company_id IN (
        SELECT p.company_id 
        FROM profiles p 
        WHERE p.id = auth.uid() AND p.is_super_admin = true
    )
);

CREATE POLICY "Company admins can insert own api keys"
ON mcp_api_keys FOR INSERT
WITH CHECK (
    company_id IN (
        SELECT ca.company_id 
        FROM company_admins ca 
        WHERE ca.user_id = auth.uid()
    )
    OR
    company_id IN (
        SELECT p.company_id 
        FROM profiles p 
        WHERE p.id = auth.uid() AND p.is_super_admin = true
    )
);

CREATE POLICY "Company admins can update own api keys"
ON mcp_api_keys FOR UPDATE
USING (
    company_id IN (
        SELECT ca.company_id 
        FROM company_admins ca 
        WHERE ca.user_id = auth.uid()
    )
    OR
    company_id IN (
        SELECT p.company_id 
        FROM profiles p 
        WHERE p.id = auth.uid() AND p.is_super_admin = true
    )
);

CREATE POLICY "Company admins can delete own api keys"
ON mcp_api_keys FOR DELETE
USING (
    company_id IN (
        SELECT ca.company_id 
        FROM company_admins ca 
        WHERE ca.user_id = auth.uid()
    )
    OR
    company_id IN (
        SELECT p.company_id 
        FROM profiles p 
        WHERE p.id = auth.uid() AND p.is_super_admin = true
    )
);

-- Audit Logs: Nur Company Admins können Logs ihrer Company sehen
CREATE POLICY "Company admins can view own audit logs"
ON mcp_audit_logs FOR SELECT
USING (
    company_id IN (
        SELECT ca.company_id 
        FROM company_admins ca 
        WHERE ca.user_id = auth.uid()
    )
    OR
    company_id IN (
        SELECT p.company_id 
        FROM profiles p 
        WHERE p.id = auth.uid() AND p.is_super_admin = true
    )
);

-- ============================================================================
-- GRANTS
-- ============================================================================

-- Service Role braucht vollen Zugriff (für MCP Server)
GRANT ALL ON mcp_api_keys TO service_role;
GRANT ALL ON mcp_audit_logs TO service_role;

-- Authenticated Users bekommen durch RLS gefilterten Zugriff
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_api_keys TO authenticated;
GRANT SELECT ON mcp_audit_logs TO authenticated;

-- Function Grants
GRANT EXECUTE ON FUNCTION mcp_increment_api_key_usage(TEXT) TO service_role;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE mcp_api_keys IS 'API Keys für externe MCP Server Zugriffe (ChatGPT, Cursor, etc.)';
COMMENT ON TABLE mcp_audit_logs IS 'Audit Trail für alle MCP Tool-Aufrufe';
COMMENT ON FUNCTION mcp_increment_api_key_usage(TEXT) IS 'Validiert API Key und inkrementiert Usage Counter atomar';
