-- Ensure full cascade deletion for a knowledge base and all related data
-- Deletes: knowledge_items, knowledge_base_groups, mismatch_analysis_jobs, orphan documents (+ cascades document_chunks)
-- Ownership check is performed within the function.

CREATE OR REPLACE FUNCTION public.delete_knowledge_base_and_related_data(
  kb_id uuid,
  user_id_check uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kb_owner uuid;
BEGIN
  -- Verify ownership
  SELECT user_id INTO kb_owner FROM knowledge_bases WHERE id = kb_id;
  IF kb_owner IS NULL OR kb_owner <> user_id_check THEN
    RAISE EXCEPTION 'Knowledge base not found or user does not have permission';
  END IF;

  -- Collect candidate document ids referenced by this KB's knowledge items
  CREATE TEMP TABLE tmp_kb_docs ON COMMIT DROP AS
  SELECT DISTINCT document_id
  FROM knowledge_items
  WHERE knowledge_base_id = kb_id AND document_id IS NOT NULL;

  -- Delete dependent data first
  DELETE FROM knowledge_items WHERE knowledge_base_id = kb_id;
  DELETE FROM knowledge_base_groups WHERE knowledge_base_id = kb_id;
  DELETE FROM mismatch_analysis_jobs WHERE knowledge_base_id = kb_id;

  -- Delete orphan documents (no remaining knowledge_items referencing them)
  DELETE FROM documents d
  USING tmp_kb_docs t
  WHERE d.id = t.document_id
    AND NOT EXISTS (
      SELECT 1 FROM knowledge_items ki WHERE ki.document_id = d.id
    );

  -- Finally delete the knowledge base itself
  DELETE FROM knowledge_bases WHERE id = kb_id;

  RETURN;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_knowledge_base_and_related_data(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_knowledge_base_and_related_data(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_knowledge_base_and_related_data(uuid, uuid) TO service_role;


