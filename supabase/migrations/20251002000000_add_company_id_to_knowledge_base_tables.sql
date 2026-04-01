-- Migration: Add company_id to Knowledge Base Tables
-- Datum: 2025-10-02
-- Beschreibung: Fügt company_id zu allen relevanten Knowledge Base Tabellen hinzu

-- 1. Knowledge Bases Tabelle
ALTER TABLE public.knowledge_bases
ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.knowledge_bases
ADD CONSTRAINT knowledge_bases_company_id_fkey 
FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_company_id 
ON public.knowledge_bases(company_id);

-- 2. Documents Tabelle
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.documents
ADD CONSTRAINT documents_company_id_fkey 
FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_company_id 
ON public.documents(company_id);

-- 3. Knowledge Items Tabelle
ALTER TABLE public.knowledge_items
ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.knowledge_items
ADD CONSTRAINT knowledge_items_company_id_fkey 
FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_items_company_id 
ON public.knowledge_items(company_id);

-- 4. Document Chunks Tabelle
ALTER TABLE public.document_chunks
ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.document_chunks
ADD CONSTRAINT document_chunks_company_id_fkey 
FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_chunks_company_id 
ON public.document_chunks(company_id);

-- 5. AI Agent Configurations Tabelle
ALTER TABLE public.ai_agent_configurations
ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.ai_agent_configurations
ADD CONSTRAINT ai_agent_configurations_company_id_fkey 
FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_agent_configurations_company_id 
ON public.ai_agent_configurations(company_id);

-- 6. Workspaces Tabelle
ALTER TABLE public.workspaces
ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE public.workspaces
ADD CONSTRAINT workspaces_company_id_fkey 
FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workspaces_company_id 
ON public.workspaces(company_id);

-- 7. Process Logs Tabelle (falls existiert)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'process_logs') THEN
    ALTER TABLE public.process_logs
    ADD COLUMN IF NOT EXISTS company_id uuid;

    ALTER TABLE public.process_logs
    ADD CONSTRAINT process_logs_company_id_fkey 
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_process_logs_company_id 
    ON public.process_logs(company_id);
  END IF;
END $$;

-- 8. User Email Accounts Tabelle (falls existiert)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_email_accounts') THEN
    ALTER TABLE public.user_email_accounts
    ADD COLUMN IF NOT EXISTS company_id uuid;

    ALTER TABLE public.user_email_accounts
    ADD CONSTRAINT user_email_accounts_company_id_fkey 
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_user_email_accounts_company_id 
    ON public.user_email_accounts(company_id);
  END IF;
END $$;

-- Populate company_id for existing records based on user_id
-- Für Knowledge Bases
UPDATE public.knowledge_bases kb
SET company_id = p.company_id
FROM public.profiles p
WHERE kb.user_id = p.id
AND kb.company_id IS NULL
AND p.company_id IS NOT NULL;

-- Für Documents
UPDATE public.documents d
SET company_id = p.company_id
FROM public.profiles p
WHERE d.user_id = p.id
AND d.company_id IS NULL
AND p.company_id IS NOT NULL;

-- Für Knowledge Items
UPDATE public.knowledge_items ki
SET company_id = p.company_id
FROM public.profiles p
WHERE ki.user_id = p.id
AND ki.company_id IS NULL
AND p.company_id IS NOT NULL;

-- Für Document Chunks (via Documents)
UPDATE public.document_chunks dc
SET company_id = d.company_id
FROM public.documents d
WHERE dc.document_id = d.id
AND dc.company_id IS NULL
AND d.company_id IS NOT NULL;

-- Für AI Agent Configurations
UPDATE public.ai_agent_configurations aac
SET company_id = p.company_id
FROM public.profiles p
WHERE aac.user_id = p.id
AND aac.company_id IS NULL
AND p.company_id IS NOT NULL;

-- Für Workspaces
UPDATE public.workspaces w
SET company_id = p.company_id
FROM public.profiles p
WHERE w.user_id = p.id
AND w.company_id IS NULL
AND p.company_id IS NOT NULL;

-- Für Process Logs (falls existiert)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'process_logs') THEN
    UPDATE public.process_logs pl
    SET company_id = p.company_id
    FROM public.profiles p
    WHERE pl.user_id = p.id
    AND pl.company_id IS NULL
    AND p.company_id IS NOT NULL;
  END IF;
END $$;

-- Für User Email Accounts (falls existiert)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_email_accounts') THEN
    UPDATE public.user_email_accounts uea
    SET company_id = p.company_id
    FROM public.profiles p
    WHERE uea.user_id = p.id
    AND uea.company_id IS NULL
    AND p.company_id IS NOT NULL;
  END IF;
END $$;




