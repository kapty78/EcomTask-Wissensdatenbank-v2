-- Add helper functions for source/document overview + deletion
-- 1) get_kb_document_chunk_stats: list documents in a KB with chunk + fact counts
-- 2) delete_document_and_related_data: delete document, chunks, and facts

CREATE OR REPLACE FUNCTION public.get_kb_document_chunk_stats(
  p_knowledge_base_id uuid
)
RETURNS TABLE (
  document_id uuid,
  document_name text,
  chunk_id uuid,
  chunk_position integer,
  facts_count integer,
  questions_count integer,
  chunk_count integer
)
LANGUAGE sql
STABLE
AS $$
  WITH kb_docs AS (
    SELECT DISTINCT ki.document_id
    FROM public.knowledge_items ki
    WHERE ki.knowledge_base_id = p_knowledge_base_id
      AND ki.document_id IS NOT NULL
  ),
  chunk_fact_counts AS (
    SELECT
      ki.source_chunk AS chunk_id,
      COUNT(*)::int AS facts_count,
      COUNT(*) FILTER (
        WHERE ki.question IS NOT NULL AND ki.question <> ''
      )::int AS questions_count
    FROM public.knowledge_items ki
    WHERE ki.knowledge_base_id = p_knowledge_base_id
      AND ki.source_chunk IS NOT NULL
    GROUP BY ki.source_chunk
  )
  SELECT
    d.id AS document_id,
    COALESCE(d.title, d.file_name) AS document_name,
    dc.id AS chunk_id,
    dc.content_position AS chunk_position,
    COALESCE(cfc.facts_count, 0) AS facts_count,
    COALESCE(cfc.questions_count, 0) AS questions_count,
    COUNT(dc.id) OVER (PARTITION BY d.id) AS chunk_count
  FROM public.documents d
  JOIN kb_docs kd ON kd.document_id = d.id
  LEFT JOIN public.document_chunks dc ON dc.document_id = d.id
  LEFT JOIN chunk_fact_counts cfc ON cfc.chunk_id = dc.id
  ORDER BY document_name, dc.content_position;
$$;

CREATE OR REPLACE FUNCTION public.delete_document_and_related_data(
  doc_id uuid,
  user_id_check uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc_owner uuid;
BEGIN
  -- Ownership check
  SELECT user_id INTO doc_owner FROM public.documents WHERE id = doc_id;
  IF doc_owner IS NULL OR doc_owner <> user_id_check THEN
    RAISE EXCEPTION 'Document not found or user does not have permission';
  END IF;

  -- Delete facts for this document (direct + via chunks)
  DELETE FROM public.knowledge_items
  WHERE document_id = doc_id
     OR source_chunk IN (
       SELECT id FROM public.document_chunks WHERE document_id = doc_id
     );

  -- Delete processing status if present
  DELETE FROM public.document_processing_status
  WHERE document_id = doc_id;

  -- Delete chunks and document
  DELETE FROM public.document_chunks WHERE document_id = doc_id;
  DELETE FROM public.documents WHERE id = doc_id;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.get_kb_document_chunk_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kb_document_chunk_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kb_document_chunk_stats(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.delete_document_and_related_data(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_document_and_related_data(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_document_and_related_data(uuid, uuid) TO service_role;
