-- Migration: Add Triggers for Auto-Populating company_id
-- Datum: 2025-10-02
-- Beschreibung: Erstellt Trigger für automatisches Setzen von company_id bei neuen Einträgen

-- Universal Function für auto-populate company_id
CREATE OR REPLACE FUNCTION public.auto_populate_company_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Nur setzen, wenn company_id noch NULL ist und user_id vorhanden
  IF NEW.company_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id
    FROM public.profiles
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger für Knowledge Bases
DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_knowledge_bases ON public.knowledge_bases;
CREATE TRIGGER trigger_auto_populate_company_id_knowledge_bases
  BEFORE INSERT ON public.knowledge_bases
  FOR EACH ROW
  WHEN (NEW.company_id IS NULL)
  EXECUTE FUNCTION public.auto_populate_company_id();

-- Trigger für Documents
DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_documents ON public.documents;
CREATE TRIGGER trigger_auto_populate_company_id_documents
  BEFORE INSERT ON public.documents
  FOR EACH ROW
  WHEN (NEW.company_id IS NULL)
  EXECUTE FUNCTION public.auto_populate_company_id();

-- Trigger für Knowledge Items
DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_knowledge_items ON public.knowledge_items;
CREATE TRIGGER trigger_auto_populate_company_id_knowledge_items
  BEFORE INSERT ON public.knowledge_items
  FOR EACH ROW
  WHEN (NEW.company_id IS NULL)
  EXECUTE FUNCTION public.auto_populate_company_id();

-- Trigger für AI Agent Configurations
DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_ai_agent_configurations ON public.ai_agent_configurations;
CREATE TRIGGER trigger_auto_populate_company_id_ai_agent_configurations
  BEFORE INSERT ON public.ai_agent_configurations
  FOR EACH ROW
  WHEN (NEW.company_id IS NULL)
  EXECUTE FUNCTION public.auto_populate_company_id();

-- Trigger für Workspaces
DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_workspaces ON public.workspaces;
CREATE TRIGGER trigger_auto_populate_company_id_workspaces
  BEFORE INSERT ON public.workspaces
  FOR EACH ROW
  WHEN (NEW.company_id IS NULL)
  EXECUTE FUNCTION public.auto_populate_company_id();

-- Spezielle Funktion für Document Chunks (nutzt document_id statt user_id)
CREATE OR REPLACE FUNCTION public.auto_populate_company_id_from_document()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.document_id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id
    FROM public.documents
    WHERE id = NEW.document_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger für Document Chunks
DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_document_chunks ON public.document_chunks;
CREATE TRIGGER trigger_auto_populate_company_id_document_chunks
  BEFORE INSERT ON public.document_chunks
  FOR EACH ROW
  WHEN (NEW.company_id IS NULL)
  EXECUTE FUNCTION public.auto_populate_company_id_from_document();

-- Conditional Triggers für optionale Tabellen

-- Process Logs
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'process_logs') THEN
    DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_process_logs ON public.process_logs;
    CREATE TRIGGER trigger_auto_populate_company_id_process_logs
      BEFORE INSERT ON public.process_logs
      FOR EACH ROW
      WHEN (NEW.company_id IS NULL)
      EXECUTE FUNCTION public.auto_populate_company_id();
  END IF;
END $$;

-- User Email Accounts
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_email_accounts') THEN
    DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_user_email_accounts ON public.user_email_accounts;
    CREATE TRIGGER trigger_auto_populate_company_id_user_email_accounts
      BEFORE INSERT ON public.user_email_accounts
      FOR EACH ROW
      WHEN (NEW.company_id IS NULL)
      EXECUTE FUNCTION public.auto_populate_company_id();
  END IF;
END $$;




