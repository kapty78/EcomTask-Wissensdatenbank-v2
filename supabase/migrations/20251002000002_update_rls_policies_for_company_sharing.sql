-- Migration: Update RLS Policies für Company Sharing
-- Datum: 2025-10-02
-- Beschreibung: Aktualisiert RLS Policies für Company-weites Data Sharing

-- ============================================
-- 1. KNOWLEDGE BASES POLICIES
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own knowledge bases" ON public.knowledge_bases;
DROP POLICY IF EXISTS "Users can insert their own knowledge bases" ON public.knowledge_bases;
DROP POLICY IF EXISTS "Users can update their own knowledge bases" ON public.knowledge_bases;
DROP POLICY IF EXISTS "Users can delete their own knowledge bases" ON public.knowledge_bases;

-- SELECT: Benutzer sehen alle KBs ihrer Company + Public KBs
CREATE POLICY "Users can view company and public knowledge bases"
  ON public.knowledge_bases
  FOR SELECT
  USING (
    -- Eigene Company KBs
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    -- Public KBs
    sharing = 'public'
    OR
    -- Eigene KBs (falls kein company_id gesetzt)
    user_id = auth.uid()
  );

-- INSERT: Benutzer können KBs erstellen (company_id wird via Trigger gesetzt)
CREATE POLICY "Users can create knowledge bases"
  ON public.knowledge_bases
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Benutzer können alle Company-KBs bearbeiten
CREATE POLICY "Users can update company knowledge bases"
  ON public.knowledge_bases
  FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

-- DELETE: Nur eigene KBs oder Admin
CREATE POLICY "Users can delete own knowledge bases or company admin"
  ON public.knowledge_bases
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.company_admins ca
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE ca.user_id = auth.uid()
      AND ca.company_id = p.company_id
      AND p.company_id = knowledge_bases.company_id
    )
  );

-- ============================================
-- 2. DOCUMENTS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete their own documents" ON public.documents;

-- SELECT: Alle Company-Dokumente sichtbar
CREATE POLICY "Users can view company documents"
  ON public.documents
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

-- INSERT: Benutzer können Dokumente erstellen
CREATE POLICY "Users can create documents"
  ON public.documents
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Nur eigene Dokumente
CREATE POLICY "Users can update own documents"
  ON public.documents
  FOR UPDATE
  USING (user_id = auth.uid());

-- DELETE: Nur eigene Dokumente
CREATE POLICY "Users can delete own documents"
  ON public.documents
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- 3. KNOWLEDGE ITEMS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view their own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can insert their own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can update their own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can delete their own knowledge items" ON public.knowledge_items;

-- SELECT: Alle Company-Items sichtbar
CREATE POLICY "Users can view company knowledge items"
  ON public.knowledge_items
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    user_id = auth.uid()
    OR
    -- Items aus Public Knowledge Bases
    knowledge_base_id IN (
      SELECT id FROM public.knowledge_bases WHERE sharing = 'public'
    )
  );

-- INSERT: Benutzer können Items erstellen
CREATE POLICY "Users can create knowledge items"
  ON public.knowledge_items
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Nur eigene Items
CREATE POLICY "Users can update own knowledge items"
  ON public.knowledge_items
  FOR UPDATE
  USING (user_id = auth.uid());

-- DELETE: Nur eigene Items
CREATE POLICY "Users can delete own knowledge items"
  ON public.knowledge_items
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- 4. DOCUMENT CHUNKS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view their own chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can insert their own chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can update their own chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can delete their own chunks" ON public.document_chunks;

-- SELECT: Alle Company-Chunks sichtbar
CREATE POLICY "Users can view company document chunks"
  ON public.document_chunks
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    -- Chunks von eigenen Dokumenten
    document_id IN (
      SELECT id FROM public.documents WHERE user_id = auth.uid()
    )
  );

-- INSERT: Benutzer können Chunks erstellen (via Document ownership)
CREATE POLICY "Users can create document chunks"
  ON public.document_chunks
  FOR INSERT
  WITH CHECK (
    document_id IN (
      SELECT id FROM public.documents WHERE user_id = auth.uid()
    )
  );

-- UPDATE: Nur Chunks von eigenen Dokumenten
CREATE POLICY "Users can update own document chunks"
  ON public.document_chunks
  FOR UPDATE
  USING (
    document_id IN (
      SELECT id FROM public.documents WHERE user_id = auth.uid()
    )
  );

-- DELETE: Nur Chunks von eigenen Dokumenten
CREATE POLICY "Users can delete own document chunks"
  ON public.document_chunks
  FOR DELETE
  USING (
    document_id IN (
      SELECT id FROM public.documents WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- 5. AI AGENT CONFIGURATIONS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view their own configurations" ON public.ai_agent_configurations;
DROP POLICY IF EXISTS "Users can insert their own configurations" ON public.ai_agent_configurations;
DROP POLICY IF EXISTS "Users can update their own configurations" ON public.ai_agent_configurations;
DROP POLICY IF EXISTS "Users can delete their own configurations" ON public.ai_agent_configurations;

-- SELECT: Alle Company-Konfigurationen sichtbar
CREATE POLICY "Users can view company ai configurations"
  ON public.ai_agent_configurations
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

-- INSERT: Benutzer können Konfigurationen erstellen
CREATE POLICY "Users can create ai configurations"
  ON public.ai_agent_configurations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Alle Company-Benutzer können Konfigurationen bearbeiten
CREATE POLICY "Users can update company ai configurations"
  ON public.ai_agent_configurations
  FOR UPDATE
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

-- DELETE: Nur eigene Konfigurationen oder Admins
CREATE POLICY "Users can delete own ai configurations"
  ON public.ai_agent_configurations
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.company_admins ca
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE ca.user_id = auth.uid()
      AND ca.company_id = p.company_id
      AND p.company_id = ai_agent_configurations.company_id
    )
  );

-- ============================================
-- 6. WORKSPACES POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can insert their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can delete their own workspaces" ON public.workspaces;

-- SELECT: Alle Company-Workspaces sichtbar
CREATE POLICY "Users can view company workspaces"
  ON public.workspaces
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.profiles WHERE id = auth.uid()
    )
    OR
    user_id = auth.uid()
  );

-- INSERT: Benutzer können Workspaces erstellen
CREATE POLICY "Users can create workspaces"
  ON public.workspaces
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Nur eigene Workspaces
CREATE POLICY "Users can update own workspaces"
  ON public.workspaces
  FOR UPDATE
  USING (user_id = auth.uid());

-- DELETE: Nur eigene Workspaces
CREATE POLICY "Users can delete own workspaces"
  ON public.workspaces
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- 7. CONDITIONAL POLICIES (Optional Tables)
-- ============================================

-- Process Logs
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'process_logs') THEN
    -- Drop existing
    DROP POLICY IF EXISTS "Users can view own process logs" ON public.process_logs;
    DROP POLICY IF EXISTS "Users can insert process logs" ON public.process_logs;
    
    -- SELECT: Alle Company-Logs sichtbar
    CREATE POLICY "Users can view company process logs"
      ON public.process_logs
      FOR SELECT
      USING (
        company_id IN (
          SELECT company_id FROM public.profiles WHERE id = auth.uid()
        )
        OR
        user_id = auth.uid()
      );
    
    -- INSERT: Benutzer können Logs erstellen
    CREATE POLICY "Users can create process logs"
      ON public.process_logs
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- User Email Accounts
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_email_accounts') THEN
    -- Drop existing
    DROP POLICY IF EXISTS "Users can view own email accounts" ON public.user_email_accounts;
    DROP POLICY IF EXISTS "Users can manage own email accounts" ON public.user_email_accounts;
    
    -- SELECT: Company-weit lesbar (für Filter-Zwecke)
    CREATE POLICY "Users can view company email accounts"
      ON public.user_email_accounts
      FOR SELECT
      USING (
        company_id IN (
          SELECT company_id FROM public.profiles WHERE id = auth.uid()
        )
        OR
        user_id = auth.uid()
      );
    
    -- INSERT: Benutzer können Email Accounts erstellen
    CREATE POLICY "Users can create email accounts"
      ON public.user_email_accounts
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
    
    -- UPDATE: Nur eigene Email Accounts
    CREATE POLICY "Users can update own email accounts"
      ON public.user_email_accounts
      FOR UPDATE
      USING (user_id = auth.uid());
    
    -- DELETE: Nur eigene Email Accounts
    CREATE POLICY "Users can delete own email accounts"
      ON public.user_email_accounts
      FOR DELETE
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Enable RLS auf allen Tabellen (falls noch nicht aktiviert)
ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- Conditional RLS Enable
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'process_logs') THEN
    ALTER TABLE public.process_logs ENABLE ROW LEVEL SECURITY;
  END IF;
  
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_email_accounts') THEN
    ALTER TABLE public.user_email_accounts ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;




