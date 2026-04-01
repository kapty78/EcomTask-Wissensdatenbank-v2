-- Migration: Fix Document Chunks RLS Policy Fallback
-- Datum: 2025-10-03
-- Beschreibung: Verbessert RLS Policy für document_chunks um auch ohne company_id zu funktionieren

-- ============================================
-- DOCUMENT CHUNKS POLICY FIX
-- ============================================

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view company document chunks" ON public.document_chunks;

-- SELECT: Company-Chunks ODER Chunks von Dokumenten in Company ODER eigene Chunks
CREATE POLICY "Users can view company document chunks"
  ON public.document_chunks
  FOR SELECT
  USING (
    -- 1. Direkte Company-Zugehörigkeit (wenn company_id gesetzt)
    (
      company_id IS NOT NULL 
      AND company_id IN (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
      )
    )
    OR
    -- 2. Über Document-Company (Fallback wenn Chunk keine company_id hat)
    (
      document_id IN (
        SELECT d.id 
        FROM public.documents d
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE d.company_id IS NOT NULL 
        AND d.company_id = p.company_id
      )
    )
    OR
    -- 3. Chunks von eigenen Dokumenten (unabhängig von Company)
    (
      document_id IN (
        SELECT id FROM public.documents WHERE user_id = auth.uid()
      )
    )
    OR
    -- 4. Chunks von Public Knowledge Bases (über Document)
    (
      document_id IN (
        SELECT d.id
        FROM public.documents d
        JOIN public.knowledge_bases kb ON d.knowledge_base_id = kb.id
        WHERE kb.sharing = 'public'
      )
    )
  );

-- ============================================
-- KNOWLEDGE ITEMS POLICY FIX
-- ============================================

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view company knowledge items" ON public.knowledge_items;

-- SELECT: Company-Items ODER Items in Company-Knowledge-Bases ODER eigene Items
CREATE POLICY "Users can view company knowledge items"
  ON public.knowledge_items
  FOR SELECT
  USING (
    -- 1. Direkte Company-Zugehörigkeit
    (
      company_id IS NOT NULL
      AND company_id IN (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
      )
    )
    OR
    -- 2. Eigene Items
    user_id = auth.uid()
    OR
    -- 3. Items aus Public Knowledge Bases
    (
      knowledge_base_id IN (
        SELECT id FROM public.knowledge_bases WHERE sharing = 'public'
      )
    )
    OR
    -- 4. Items aus Company Knowledge Bases (Fallback)
    (
      knowledge_base_id IN (
        SELECT kb.id
        FROM public.knowledge_bases kb
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE kb.company_id IS NOT NULL 
        AND kb.company_id = p.company_id
      )
    )
    OR
    -- 5. Items von Dokumenten in Company (über document_id)
    (
      document_id IN (
        SELECT d.id
        FROM public.documents d
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE d.company_id IS NOT NULL 
        AND d.company_id = p.company_id
      )
    )
  );

-- ============================================
-- BACKFILL: Fülle fehlende company_ids
-- ============================================

-- Update document_chunks ohne company_id basierend auf Document
UPDATE public.document_chunks dc
SET company_id = d.company_id
FROM public.documents d
WHERE dc.document_id = d.id
AND dc.company_id IS NULL
AND d.company_id IS NOT NULL;

-- Update knowledge_items ohne company_id basierend auf Document
UPDATE public.knowledge_items ki
SET company_id = d.company_id
FROM public.documents d
WHERE ki.document_id = d.id
AND ki.company_id IS NULL
AND d.company_id IS NOT NULL;

-- Update knowledge_items ohne company_id basierend auf Knowledge Base
UPDATE public.knowledge_items ki
SET company_id = kb.company_id
FROM public.knowledge_bases kb
WHERE ki.knowledge_base_id = kb.id
AND ki.company_id IS NULL
AND kb.company_id IS NOT NULL;

-- Log Ergebnis
DO $$
DECLARE
  chunks_updated INTEGER;
  items_updated INTEGER;
BEGIN
  -- Count chunks without company_id
  SELECT COUNT(*) INTO chunks_updated
  FROM public.document_chunks
  WHERE company_id IS NULL;
  
  -- Count items without company_id
  SELECT COUNT(*) INTO items_updated
  FROM public.knowledge_items
  WHERE company_id IS NULL;
  
  RAISE NOTICE 'Migration completed. Chunks without company_id: %, Items without company_id: %', 
    chunks_updated, items_updated;
END $$;
