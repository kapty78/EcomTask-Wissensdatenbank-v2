-- =====================================================================
-- HARDEN RLS: Strict Company Isolation
-- =====================================================================
-- Problem: Multiple SELECT policies on knowledge_bases were OR'd,
-- allowing cross-company data access via:
--   1) `sharing <> 'private'`  → any non-private KB visible to ALL users
--   2) `user_id = auth.uid()`  → owner sees KB even in foreign company
--   3) `sharing = 'public'`    → public KBs visible to all
--
-- Fix: Replace with single clean policy per table that ALWAYS requires
-- company_id match. Group-based access (check_kb_group_access) is kept
-- but only for KBs within the user's own company.
--
-- Pre-flight check confirmed: only 1 user (super-admin) has cross-company
-- visibility via 2 test KBs. Zero customers affected.
-- =====================================================================

-- ===================
-- 1. KNOWLEDGE_BASES
-- ===================

-- Drop ALL existing SELECT policies
DROP POLICY IF EXISTS "Benutzer können eigene und freigegebene KBs sehen" ON public.knowledge_bases;
DROP POLICY IF EXISTS "Users can view company knowledge bases" ON public.knowledge_bases;
DROP POLICY IF EXISTS "Users can view company and public knowledge bases" ON public.knowledge_bases;
DROP POLICY IF EXISTS "Users can view their own knowledge bases" ON public.knowledge_bases;

-- New single SELECT policy: strict company isolation
CREATE POLICY "select_knowledge_bases_company_isolated"
  ON public.knowledge_bases
  FOR SELECT
  TO authenticated
  USING (
    -- Company match: user sees KBs that belong to their company
    (
      company_id IS NOT NULL
      AND company_id IN (
        SELECT p.company_id
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.company_id IS NOT NULL
      )
    )
    OR
    -- Group-based access within same company
    (
      check_kb_group_access(id)
      AND company_id IN (
        SELECT p.company_id
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.company_id IS NOT NULL
      )
    )
  );

-- ===================
-- 2. KNOWLEDGE_ITEMS
-- ===================

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "select_knowledge_items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can view company knowledge items" ON public.knowledge_items;

-- New SELECT policy: items visible only via company match
CREATE POLICY "select_knowledge_items_company_isolated"
  ON public.knowledge_items
  FOR SELECT
  TO authenticated
  USING (
    -- Direct company match on the item
    (
      company_id IS NOT NULL
      AND company_id IN (
        SELECT p.company_id
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.company_id IS NOT NULL
      )
    )
    OR
    -- Via KB membership (KB must be in user's company)
    knowledge_base_id IN (
      SELECT kb.id
      FROM public.knowledge_bases kb
      WHERE kb.company_id IS NOT NULL
        AND kb.company_id IN (
          SELECT p.company_id
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.company_id IS NOT NULL
        )
    )
  );

-- ===================
-- 3. DOCUMENTS
-- ===================

-- Drop existing SELECT policies
DROP POLICY IF EXISTS "Users can view their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can view company documents" ON public.documents;

-- New single SELECT policy: company-scoped
CREATE POLICY "select_documents_company_isolated"
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND company_id IN (
      SELECT p.company_id
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.company_id IS NOT NULL
    )
  );

-- ===================
-- 4. DOCUMENT_CHUNKS (already OK, but tighten)
-- ===================

-- Current policy goes through documents table which is now company-isolated.
-- No change needed — the documents policy cascades.

-- ===================
-- 5. VERIFICATION
-- ===================

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  RAISE NOTICE '=== HARDENED SELECT POLICIES ===';
  FOR policy_record IN
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE tablename IN ('knowledge_bases', 'knowledge_items', 'documents', 'document_chunks')
      AND cmd = 'SELECT'
    ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE '% — % (%)', policy_record.tablename, policy_record.policyname, policy_record.cmd;
  END LOOP;
END $$;
