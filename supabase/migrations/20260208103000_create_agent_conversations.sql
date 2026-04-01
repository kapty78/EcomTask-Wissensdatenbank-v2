-- Agent Conversation Persistence
-- Erstellt Conversation- und Message-Tabellen für den KI-Agenten inkl. RLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1) CONVERSATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  knowledge_base_id uuid REFERENCES public.knowledge_bases(id) ON DELETE SET NULL,
  title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_updated_at
  ON public.agent_conversations (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_company
  ON public.agent_conversations (company_id);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_kb
  ON public.agent_conversations (knowledge_base_id);

-- ============================================================================
-- 2) MESSAGES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  knowledge_base_id uuid REFERENCES public.knowledge_bases(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content text NOT NULL,
  tool_name text,
  tool_call_id text,
  tool_status text CHECK (tool_status IN ('running', 'done', 'error')),
  tool_input jsonb,
  tool_output jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation_created_at
  ON public.agent_messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_messages_role
  ON public.agent_messages (role);

CREATE INDEX IF NOT EXISTS idx_agent_messages_kb
  ON public.agent_messages (knowledge_base_id);

-- ============================================================================
-- 3) TRIGGERS / FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.agent_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_agent_conversations_set_updated_at ON public.agent_conversations;
CREATE TRIGGER trigger_agent_conversations_set_updated_at
  BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_set_updated_at();

CREATE OR REPLACE FUNCTION public.agent_messages_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  convo_user_id uuid;
  convo_company_id uuid;
  convo_kb_id uuid;
BEGIN
  SELECT c.user_id, c.company_id, c.knowledge_base_id
    INTO convo_user_id, convo_company_id, convo_kb_id
  FROM public.agent_conversations c
  WHERE c.id = NEW.conversation_id;

  IF convo_user_id IS NULL THEN
    RAISE EXCEPTION 'Conversation % nicht gefunden', NEW.conversation_id;
  END IF;

  IF NEW.user_id IS NULL THEN
    NEW.user_id := convo_user_id;
  END IF;

  IF NEW.user_id IS DISTINCT FROM convo_user_id THEN
    RAISE EXCEPTION 'Message user_id muss zur Conversation gehören';
  END IF;

  IF NEW.company_id IS NULL THEN
    NEW.company_id := convo_company_id;
  END IF;

  IF NEW.knowledge_base_id IS NULL THEN
    NEW.knowledge_base_id := convo_kb_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_agent_messages_before_insert ON public.agent_messages;
CREATE TRIGGER trigger_agent_messages_before_insert
  BEFORE INSERT ON public.agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_messages_before_insert();

CREATE OR REPLACE FUNCTION public.agent_messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.agent_conversations
  SET
    updated_at = NEW.created_at,
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(
      REGEXP_REPLACE(COALESCE(NEW.content, ''), '\s+', ' ', 'g'),
      180
    )
  WHERE id = NEW.conversation_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_agent_messages_after_insert ON public.agent_messages;
CREATE TRIGGER trigger_agent_messages_after_insert
  AFTER INSERT ON public.agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_messages_after_insert();

-- Company-Default für Conversations via bestehender Universal-Funktion.
DROP TRIGGER IF EXISTS trigger_auto_populate_company_id_agent_conversations ON public.agent_conversations;
CREATE TRIGGER trigger_auto_populate_company_id_agent_conversations
  BEFORE INSERT ON public.agent_conversations
  FOR EACH ROW
  WHEN (NEW.company_id IS NULL)
  EXECUTE FUNCTION public.auto_populate_company_id();

-- ============================================================================
-- 4) RLS
-- ============================================================================
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own agent conversations" ON public.agent_conversations;
CREATE POLICY "Users can view own agent conversations"
  ON public.agent_conversations
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own agent conversations" ON public.agent_conversations;
CREATE POLICY "Users can create own agent conversations"
  ON public.agent_conversations
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own agent conversations" ON public.agent_conversations;
CREATE POLICY "Users can update own agent conversations"
  ON public.agent_conversations
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own agent conversations" ON public.agent_conversations;
CREATE POLICY "Users can delete own agent conversations"
  ON public.agent_conversations
  FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own agent messages" ON public.agent_messages;
CREATE POLICY "Users can view own agent messages"
  ON public.agent_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create own agent messages" ON public.agent_messages;
CREATE POLICY "Users can create own agent messages"
  ON public.agent_messages
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own agent messages" ON public.agent_messages;
CREATE POLICY "Users can update own agent messages"
  ON public.agent_messages
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own agent messages" ON public.agent_messages;
CREATE POLICY "Users can delete own agent messages"
  ON public.agent_messages
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 5) GRANTS / COMMENTS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_messages TO authenticated;

GRANT ALL ON public.agent_conversations TO service_role;
GRANT ALL ON public.agent_messages TO service_role;

COMMENT ON TABLE public.agent_conversations IS 'Gesprächs-Container für den Knowledge-KI-Agenten';
COMMENT ON TABLE public.agent_messages IS 'Nachrichtenverlauf je Agent-Conversation inkl. Tool-Events';
