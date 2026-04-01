-- Function to search facts across all chunks of a document
CREATE OR REPLACE FUNCTION search_facts_global(
    p_document_id UUID,
    p_search_term TEXT,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    question TEXT,
    fact_type TEXT,
    created_at TIMESTAMPTZ,
    source_chunk UUID,
    chunk_content TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ki.id,
        ki.content,
        ki.question,
        ki.fact_type,
        ki.created_at,
        ki.source_chunk,
        c.content as chunk_content
    FROM knowledge_items ki
    JOIN chunks c ON ki.source_chunk = c.id
    WHERE c.document_id = p_document_id
    AND (
        (ki.content IS NOT NULL AND LOWER(ki.content) LIKE '%' || LOWER(p_search_term) || '%')
        OR
        (ki.question IS NOT NULL AND LOWER(ki.question) LIKE '%' || LOWER(p_search_term) || '%')
    )
    ORDER BY ki.created_at DESC
    LIMIT p_limit;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION search_facts_global(UUID, TEXT, INTEGER) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION search_facts_global(UUID, TEXT, INTEGER) IS 'Search for facts across all chunks of a document by content or question';
