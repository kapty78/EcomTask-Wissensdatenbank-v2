-- Cleanup helper:
-- - delete chunks without facts/questions
-- - delete documents without chunks and without direct knowledge_items
-- Optional filters:
--   p_user_id: only documents owned by this user
--   p_knowledge_base_id: only docs/chunks that belong to this KB via knowledge_items

CREATE OR REPLACE FUNCTION public.cleanup_orphan_docs_and_chunks(
  p_user_id uuid DEFAULT NULL,
  p_knowledge_base_id uuid DEFAULT NULL
)
RETURNS TABLE (
  deleted_chunk_count integer,
  deleted_document_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_chunks integer := 0;
  v_deleted_documents integer := 0;
BEGIN
  WITH relevant_documents AS (
    SELECT d.id
    FROM public.documents d
    WHERE (p_user_id IS NULL OR d.user_id = p_user_id)
      AND (
        p_knowledge_base_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.knowledge_items ki
          WHERE ki.knowledge_base_id = p_knowledge_base_id
            AND ki.document_id = d.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.document_chunks dc
          JOIN public.knowledge_items ki ON ki.source_chunk = dc.id
          WHERE ki.knowledge_base_id = p_knowledge_base_id
            AND dc.document_id = d.id
        )
      )
  ),
  orphan_chunks AS (
    SELECT dc.id
    FROM public.document_chunks dc
    JOIN relevant_documents rd ON rd.id = dc.document_id
    LEFT JOIN public.knowledge_items ki ON ki.source_chunk = dc.id
    WHERE ki.id IS NULL
  ),
  deleted_chunks AS (
    DELETE FROM public.document_chunks dc
    USING orphan_chunks oc
    WHERE dc.id = oc.id
    RETURNING dc.id
  )
  SELECT COUNT(*)::int INTO v_deleted_chunks
  FROM deleted_chunks;

  WITH relevant_documents AS (
    SELECT d.id
    FROM public.documents d
    WHERE (p_user_id IS NULL OR d.user_id = p_user_id)
      AND (
        p_knowledge_base_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.knowledge_items ki
          WHERE ki.knowledge_base_id = p_knowledge_base_id
            AND ki.document_id = d.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.document_chunks dc
          JOIN public.knowledge_items ki ON ki.source_chunk = dc.id
          WHERE ki.knowledge_base_id = p_knowledge_base_id
            AND dc.document_id = d.id
        )
      )
  ),
  orphan_documents AS (
    SELECT d.id
    FROM public.documents d
    JOIN relevant_documents rd ON rd.id = d.id
    LEFT JOIN public.document_chunks dc ON dc.document_id = d.id
    LEFT JOIN public.knowledge_items ki_direct ON ki_direct.document_id = d.id
    WHERE dc.id IS NULL
      AND ki_direct.id IS NULL
  ),
  deleted_processing_status AS (
    DELETE FROM public.document_processing_status dps
    USING orphan_documents od
    WHERE dps.document_id = od.id
    RETURNING dps.document_id
  ),
  deleted_documents AS (
    DELETE FROM public.documents d
    USING orphan_documents od
    WHERE d.id = od.id
    RETURNING d.id
  )
  SELECT COUNT(*)::int INTO v_deleted_documents
  FROM deleted_documents;

  RETURN QUERY
  SELECT v_deleted_chunks, v_deleted_documents;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_orphan_docs_and_chunks(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_docs_and_chunks(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_docs_and_chunks(uuid, uuid) TO service_role;
