CREATE OR REPLACE FUNCTION public.search_kb_text_batch(
  p_kb_id uuid,
  p_queries text[],
  p_chunk_limit int DEFAULT 8,
  p_fact_limit int DEFAULT 10
) RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
WITH q AS (
  SELECT DISTINCT trim(x) AS query
  FROM unnest(p_queries[1:10]) AS x
  WHERE length(trim(x)) >= 2
),
kb_chunks AS (
  SELECT DISTINCT ki.source_chunk AS id
  FROM knowledge_items ki
  WHERE ki.knowledge_base_id = p_kb_id AND ki.source_chunk IS NOT NULL
),
chunk_hits AS (
  SELECT q.query,
         dc.id AS chunk_id,
         left(dc.content, 400) AS content_preview,
         dc.content_position,
         dc.document_id,
         coalesce(d.title, d.file_name) AS document_name,
         (SELECT count(*) FROM knowledge_items ki2
            WHERE ki2.source_chunk = dc.id AND ki2.knowledge_base_id = p_kb_id) AS fact_count,
         count(*) OVER (PARTITION BY q.query) AS total,
         row_number() OVER (PARTITION BY q.query ORDER BY dc.content_position NULLS LAST, dc.id) AS rn
  FROM q
  JOIN document_chunks dc
    ON dc.id IN (SELECT id FROM kb_chunks)
   AND dc.content ILIKE '%' || q.query || '%'
  LEFT JOIN documents d ON d.id = dc.document_id
),
fact_hits AS (
  SELECT q.query,
         ki.id AS fact_id,
         left(coalesce(ki.content, ''), 280) AS content,
         left(coalesce(ki.question, ''), 220) AS question,
         ki.fact_type,
         ki.source_name,
         ki.source_chunk,
         count(*) OVER (PARTITION BY q.query) AS total,
         row_number() OVER (PARTITION BY q.query ORDER BY ki.created_at DESC) AS rn
  FROM q
  JOIN knowledge_items ki
    ON ki.knowledge_base_id = p_kb_id
   AND (ki.content ILIKE '%' || q.query || '%' OR ki.question ILIKE '%' || q.query || '%')
)
SELECT jsonb_build_object(
  'results',
  coalesce((SELECT jsonb_agg(jsonb_build_object(
    'query', q.query,
    'chunk_total', coalesce((SELECT max(ch.total) FROM chunk_hits ch WHERE ch.query = q.query), 0),
    'chunks', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'chunk_id', ch.chunk_id,
        'content_preview', ch.content_preview,
        'content_position', ch.content_position,
        'document_id', ch.document_id,
        'document_name', ch.document_name,
        'fact_count', ch.fact_count
      ) ORDER BY ch.rn) FROM chunk_hits ch
      WHERE ch.query = q.query AND ch.rn <= greatest(1, least(p_chunk_limit, 20))), '[]'::jsonb),
    'fact_total', coalesce((SELECT max(fh.total) FROM fact_hits fh WHERE fh.query = q.query), 0),
    'facts', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'fact_id', fh.fact_id,
        'content', fh.content,
        'question', fh.question,
        'fact_type', fh.fact_type,
        'source_name', fh.source_name,
        'source_chunk', fh.source_chunk
      ) ORDER BY fh.rn) FROM fact_hits fh
      WHERE fh.query = q.query AND fh.rn <= greatest(1, least(p_fact_limit, 30))), '[]'::jsonb)
  )) FROM q), '[]'::jsonb)
)
$fn$;

GRANT EXECUTE ON FUNCTION public.search_kb_text_batch(uuid, text[], int, int) TO authenticated, service_role;
