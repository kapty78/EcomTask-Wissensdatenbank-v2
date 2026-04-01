-- Enhanced search function for knowledge items within a knowledge base
-- This function allows searching across all knowledge items in a knowledge base
-- without the limitation of only searching in the first 100 loaded items

CREATE OR REPLACE FUNCTION search_knowledge_items_in_base(
    p_knowledge_base_id UUID,
    p_search_term TEXT,
    p_source_filter TEXT DEFAULT NULL,
    p_date_filter TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    question TEXT,
    fact_type TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    source_chunk UUID,
    chunk_content TEXT,
    source_name TEXT,
    document_title TEXT,
    total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    date_threshold TIMESTAMPTZ;
    total_items BIGINT;
BEGIN
    -- Calculate date threshold based on filter
    CASE p_date_filter
        WHEN 'today' THEN
            date_threshold := DATE_TRUNC('day', NOW());
        WHEN 'week' THEN
            date_threshold := NOW() - INTERVAL '1 week';
        WHEN 'month' THEN
            date_threshold := NOW() - INTERVAL '1 month';
        WHEN 'three_months' THEN
            date_threshold := NOW() - INTERVAL '3 months';
        ELSE
            date_threshold := '1970-01-01'::TIMESTAMPTZ;
    END CASE;

    -- Count total matching items for pagination
    SELECT COUNT(*)
    INTO total_items
    FROM knowledge_items ki
    LEFT JOIN document_chunks dc ON ki.source_chunk = dc.id
    LEFT JOIN documents d ON dc.document_id = d.id
    WHERE ki.knowledge_base_id = p_knowledge_base_id
    AND (
        p_search_term IS NULL 
        OR p_search_term = '' 
        OR (
            (ki.content IS NOT NULL AND LOWER(ki.content) LIKE '%' || LOWER(p_search_term) || '%')
            OR (ki.question IS NOT NULL AND LOWER(ki.question) LIKE '%' || LOWER(p_search_term) || '%')
        )
    )
    AND (p_source_filter IS NULL OR (d.title IS NOT NULL AND d.title = p_source_filter) OR (ki.source_name IS NOT NULL AND ki.source_name = p_source_filter))
    AND ki.created_at >= date_threshold;

    -- Return paginated results with total count
    RETURN QUERY
    SELECT
        ki.id,
        ki.content,
        ki.question,
        ki.fact_type,
        ki.created_at,
        ki.updated_at,
        ki.source_chunk,
        COALESCE(dc.content, '') as chunk_content,
        COALESCE(d.title, ki.source_name, 'Unbekannt') as source_name,
        COALESCE(d.title, ki.source_name, 'Unbekannt') as document_title,
        total_items as total_count
    FROM knowledge_items ki
    LEFT JOIN document_chunks dc ON ki.source_chunk = dc.id
    LEFT JOIN documents d ON dc.document_id = d.id
    WHERE ki.knowledge_base_id = p_knowledge_base_id
    AND (
        p_search_term IS NULL 
        OR p_search_term = '' 
        OR (
            (ki.content IS NOT NULL AND LOWER(ki.content) LIKE '%' || LOWER(p_search_term) || '%')
            OR (ki.question IS NOT NULL AND LOWER(ki.question) LIKE '%' || LOWER(p_search_term) || '%')
        )
    )
    AND (p_source_filter IS NULL OR (d.title IS NOT NULL AND d.title = p_source_filter) OR (ki.source_name IS NOT NULL AND ki.source_name = p_source_filter))
    AND ki.created_at >= date_threshold
    ORDER BY ki.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION search_knowledge_items_in_base(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION search_knowledge_items_in_base(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) IS 'Enhanced search for knowledge items in a knowledge base with filtering and pagination support';

-- Create index for better search performance
CREATE INDEX IF NOT EXISTS idx_knowledge_items_content_search 
ON knowledge_items USING gin (to_tsvector('german', COALESCE(content, '') || ' ' || COALESCE(question, '')));

-- Create index for better join performance
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_documents_knowledge_base_id ON documents(knowledge_base_id);
