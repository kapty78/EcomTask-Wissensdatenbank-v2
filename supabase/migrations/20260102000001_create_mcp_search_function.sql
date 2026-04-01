-- Migration: Create MCP Search Function
-- Description: Semantische Suche für MCP Server mit company_id Filterung

-- ============================================================================
-- MCP SEARCH KNOWLEDGE ITEMS FUNCTION
-- ============================================================================
-- Hauptfunktion für semantische Suche über Knowledge Items
-- Wird vom MCP Server mit Service Role aufgerufen

CREATE OR REPLACE FUNCTION mcp_search_knowledge_items(
    p_knowledge_base_id UUID,
    p_company_id UUID,
    p_query_embedding vector(3072),
    p_match_threshold FLOAT DEFAULT 0.3,
    p_match_count INT DEFAULT 5
)
RETURNS TABLE (
    fact_id UUID,
    fact_content TEXT,
    fact_question TEXT,
    fact_type TEXT,
    source_name TEXT,
    similarity FLOAT,
    chunk_id UUID,
    chunk_content TEXT,
    document_title TEXT,
    created_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ki.id AS fact_id,
        ki.content AS fact_content,
        ki.question AS fact_question,
        ki.fact_type,
        ki.source_name,
        1 - (ki.openai_embedding <=> p_query_embedding) AS similarity,
        dc.id AS chunk_id,
        dc.content AS chunk_content,
        COALESCE(d.title, ki.source_name) AS document_title,
        ki.created_at
    FROM knowledge_items ki
    LEFT JOIN document_chunks dc ON ki.source_chunk = dc.id
    LEFT JOIN documents d ON dc.document_id = d.id
    WHERE 
        ki.knowledge_base_id = p_knowledge_base_id
        AND ki.openai_embedding IS NOT NULL
        AND 1 - (ki.openai_embedding <=> p_query_embedding) > p_match_threshold
    ORDER BY ki.openai_embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$;

-- ============================================================================
-- MCP GET FACT DETAILS FUNCTION
-- ============================================================================
-- Holt Details zu einem spezifischen Fakt inkl. Quell-Chunk

CREATE OR REPLACE FUNCTION mcp_get_fact_details(
    p_fact_id UUID,
    p_knowledge_base_id UUID,
    p_company_id UUID
)
RETURNS TABLE (
    fact_id UUID,
    fact_content TEXT,
    fact_question TEXT,
    fact_type TEXT,
    source_name TEXT,
    chunk_id UUID,
    chunk_content TEXT,
    chunk_type TEXT,
    document_id UUID,
    document_title TEXT,
    document_file_name TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ki.id AS fact_id,
        ki.content AS fact_content,
        ki.question AS fact_question,
        ki.fact_type,
        ki.source_name,
        dc.id AS chunk_id,
        dc.content AS chunk_content,
        dc.chunk_type,
        d.id AS document_id,
        d.title AS document_title,
        d.file_name AS document_file_name,
        ki.created_at,
        ki.updated_at
    FROM knowledge_items ki
    LEFT JOIN document_chunks dc ON ki.source_chunk = dc.id
    LEFT JOIN documents d ON dc.document_id = d.id
    WHERE 
        ki.id = p_fact_id
        AND ki.knowledge_base_id = p_knowledge_base_id
    LIMIT 1;
END;
$$;

-- ============================================================================
-- MCP LIST RECENT FACTS FUNCTION
-- ============================================================================
-- Listet die neuesten Fakten einer Knowledge Base

CREATE OR REPLACE FUNCTION mcp_list_recent_facts(
    p_knowledge_base_id UUID,
    p_company_id UUID,
    p_limit INT DEFAULT 10,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    fact_id UUID,
    fact_content TEXT,
    fact_question TEXT,
    fact_type TEXT,
    source_name TEXT,
    document_title TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ki.id AS fact_id,
        ki.content AS fact_content,
        ki.question AS fact_question,
        ki.fact_type,
        ki.source_name,
        COALESCE(d.title, ki.source_name) AS document_title,
        ki.created_at
    FROM knowledge_items ki
    LEFT JOIN document_chunks dc ON ki.source_chunk = dc.id
    LEFT JOIN documents d ON dc.document_id = d.id
    WHERE ki.knowledge_base_id = p_knowledge_base_id
    ORDER BY ki.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- ============================================================================
-- MCP LOG AUDIT FUNCTION
-- ============================================================================
-- Loggt einen MCP Tool-Aufruf

CREATE OR REPLACE FUNCTION mcp_log_audit(
    p_api_key_id UUID,
    p_company_id UUID,
    p_knowledge_base_id UUID,
    p_tool_name TEXT,
    p_query_preview TEXT DEFAULT NULL,
    p_results_count INT DEFAULT NULL,
    p_tokens_used INT DEFAULT NULL,
    p_response_time_ms INT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_error_code TEXT DEFAULT NULL,
    p_client_ip TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO mcp_audit_logs (
        api_key_id,
        company_id,
        knowledge_base_id,
        tool_name,
        query_preview,
        results_count,
        tokens_used,
        response_time_ms,
        error_message,
        error_code,
        client_ip,
        user_agent
    ) VALUES (
        p_api_key_id,
        p_company_id,
        p_knowledge_base_id,
        p_tool_name,
        LEFT(p_query_preview, 100),  -- Truncate für Privacy
        p_results_count,
        p_tokens_used,
        p_response_time_ms,
        p_error_message,
        p_error_code,
        p_client_ip,
        p_user_agent
    )
    RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$;

-- ============================================================================
-- MCP GET KB INFO FUNCTION
-- ============================================================================
-- Holt Metadaten zur Knowledge Base (für Tool-Responses)

CREATE OR REPLACE FUNCTION mcp_get_kb_info(
    p_knowledge_base_id UUID,
    p_company_id UUID
)
RETURNS TABLE (
    kb_id UUID,
    kb_name TEXT,
    kb_description TEXT,
    facts_count BIGINT,
    documents_count BIGINT,
    last_updated TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        kb.id AS kb_id,
        kb.name AS kb_name,
        kb.description AS kb_description,
        (SELECT COUNT(*) FROM knowledge_items ki WHERE ki.knowledge_base_id = kb.id) AS facts_count,
        (SELECT COUNT(DISTINCT d.id) FROM documents d 
         JOIN document_chunks dc ON d.id = dc.document_id
         JOIN knowledge_items ki ON dc.id = ki.source_chunk
         WHERE ki.knowledge_base_id = kb.id) AS documents_count,
        kb.updated_at AS last_updated
    FROM knowledge_bases kb
    WHERE kb.id = p_knowledge_base_id
    LIMIT 1;
END;
$$;

-- ============================================================================
-- GRANTS
-- ============================================================================

-- Service Role braucht Zugriff für MCP Server
GRANT EXECUTE ON FUNCTION mcp_search_knowledge_items(UUID, UUID, vector, FLOAT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION mcp_get_fact_details(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION mcp_list_recent_facts(UUID, UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION mcp_log_audit(UUID, UUID, UUID, TEXT, TEXT, INT, INT, INT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION mcp_get_kb_info(UUID, UUID) TO service_role;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION mcp_search_knowledge_items IS 'Semantische Suche in Knowledge Items für MCP Server';
COMMENT ON FUNCTION mcp_get_fact_details IS 'Holt Details zu einem Fakt inkl. Quell-Chunk';
COMMENT ON FUNCTION mcp_list_recent_facts IS 'Listet die neuesten Fakten einer Knowledge Base';
COMMENT ON FUNCTION mcp_log_audit IS 'Loggt einen MCP Tool-Aufruf für Audit Trail';
COMMENT ON FUNCTION mcp_get_kb_info IS 'Holt Metadaten zur Knowledge Base';
