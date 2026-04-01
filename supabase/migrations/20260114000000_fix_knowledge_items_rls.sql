-- Migration: Fix RLS Policies für knowledge_items und document_chunks
-- Basierend auf dem tatsächlichen Schema
-- Datum: 2026-01-14

-- ============================================
-- STEP 1: Lösche ALLE bestehenden Policies für knowledge_items
-- ============================================

DROP POLICY IF EXISTS "company_read" ON public.knowledge_items;
DROP POLICY IF EXISTS "company_insert" ON public.knowledge_items;
DROP POLICY IF EXISTS "company_update" ON public.knowledge_items;
DROP POLICY IF EXISTS "company_delete" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can view company knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can create knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can insert own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can update own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can delete own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can view their own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can insert their own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can update their own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can delete their own knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Allow service_role full access on knowledge_items" ON public.knowledge_items;
DROP POLICY IF EXISTS "service_role_full_access_knowledge_items" ON public.knowledge_items;
DROP POLICY IF EXISTS "select_knowledge_items" ON public.knowledge_items;
DROP POLICY IF EXISTS "insert_knowledge_items" ON public.knowledge_items;
DROP POLICY IF EXISTS "update_knowledge_items" ON public.knowledge_items;
DROP POLICY IF EXISTS "delete_knowledge_items" ON public.knowledge_items;

-- ============================================
-- STEP 2: Lösche ALLE bestehenden Policies für document_chunks
-- ============================================

DROP POLICY IF EXISTS "Users can view company document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can view chunks of their documents" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can create document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can insert chunks for their documents" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can insert document chunks for company documents" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can update own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can update company document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can update document chunks for company documents" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can delete own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can delete document chunks for company documents" ON public.document_chunks;
DROP POLICY IF EXISTS "p_read_document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Allow service_role full access on document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "service_role_full_access_document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "select_document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "insert_document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "update_document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "delete_document_chunks" ON public.document_chunks;

-- ============================================
-- STEP 3: Policies für knowledge_items
-- knowledge_items hat: knowledge_base_id, user_id, company_id, document_id
-- ============================================

-- Service Role: Voller Zugriff
CREATE POLICY "service_role_full_access_knowledge_items"
    ON public.knowledge_items
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- SELECT: Benutzer sehen Items
CREATE POLICY "select_knowledge_items"
    ON public.knowledge_items
    FOR SELECT
    TO authenticated
    USING (
        -- Eigene Items
        user_id = auth.uid()
        OR
        -- Items mit gleicher company_id wie User
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
        -- Items aus Knowledge Bases die der User sehen darf
        knowledge_base_id IN (
            SELECT kb.id 
            FROM public.knowledge_bases kb
            WHERE 
                kb.user_id = auth.uid()
                OR kb.sharing = 'public'
                OR (
                    kb.company_id IS NOT NULL 
                    AND kb.company_id IN (
                        SELECT p.company_id 
                        FROM public.profiles p 
                        WHERE p.id = auth.uid() 
                        AND p.company_id IS NOT NULL
                    )
                )
        )
    );

-- INSERT: Benutzer können Items erstellen
CREATE POLICY "insert_knowledge_items"
    ON public.knowledge_items
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        OR
        knowledge_base_id IN (
            SELECT kb.id 
            FROM public.knowledge_bases kb
            WHERE 
                kb.user_id = auth.uid()
                OR (
                    kb.company_id IS NOT NULL 
                    AND kb.company_id IN (
                        SELECT p.company_id 
                        FROM public.profiles p 
                        WHERE p.id = auth.uid()
                    )
                )
        )
    );

-- UPDATE: Benutzer können Items bearbeiten
CREATE POLICY "update_knowledge_items"
    ON public.knowledge_items
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        OR
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
        knowledge_base_id IN (
            SELECT kb.id 
            FROM public.knowledge_bases kb
            WHERE 
                kb.user_id = auth.uid()
                OR (
                    kb.company_id IS NOT NULL 
                    AND kb.company_id IN (
                        SELECT p.company_id 
                        FROM public.profiles p 
                        WHERE p.id = auth.uid()
                    )
                )
        )
    );

-- DELETE: Benutzer können Items löschen
CREATE POLICY "delete_knowledge_items"
    ON public.knowledge_items
    FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid()
        OR
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
        knowledge_base_id IN (
            SELECT kb.id 
            FROM public.knowledge_bases kb
            WHERE 
                kb.user_id = auth.uid()
                OR (
                    kb.company_id IS NOT NULL 
                    AND kb.company_id IN (
                        SELECT p.company_id 
                        FROM public.profiles p 
                        WHERE p.id = auth.uid()
                    )
                )
        )
    );

-- ============================================
-- STEP 4: Policies für document_chunks
-- document_chunks hat NUR: document_id (keine company_id!)
-- Zugriff muss über documents Tabelle gehen
-- ============================================

-- Service Role: Voller Zugriff
CREATE POLICY "service_role_full_access_document_chunks"
    ON public.document_chunks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- SELECT: Benutzer sehen Chunks über Documents
CREATE POLICY "select_document_chunks"
    ON public.document_chunks
    FOR SELECT
    TO authenticated
    USING (
        -- Chunks von eigenen Dokumenten
        document_id IN (
            SELECT d.id 
            FROM public.documents d
            WHERE d.user_id = auth.uid()
        )
        OR
        -- Chunks von Company Dokumenten (documents.company_id)
        document_id IN (
            SELECT d.id 
            FROM public.documents d
            WHERE d.company_id IS NOT NULL 
            AND d.company_id IN (
                SELECT p.company_id 
                FROM public.profiles p 
                WHERE p.id = auth.uid() 
                AND p.company_id IS NOT NULL
            )
        )
    );

-- INSERT: Benutzer können Chunks erstellen
CREATE POLICY "insert_document_chunks"
    ON public.document_chunks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        document_id IN (
            SELECT d.id 
            FROM public.documents d
            WHERE d.user_id = auth.uid()
        )
        OR
        document_id IN (
            SELECT d.id 
            FROM public.documents d
            WHERE d.company_id IS NOT NULL 
            AND d.company_id IN (
                SELECT p.company_id 
                FROM public.profiles p 
                WHERE p.id = auth.uid()
            )
        )
    );

-- UPDATE: Benutzer können Chunks bearbeiten
CREATE POLICY "update_document_chunks"
    ON public.document_chunks
    FOR UPDATE
    TO authenticated
    USING (
        document_id IN (
            SELECT d.id 
            FROM public.documents d
            WHERE d.user_id = auth.uid()
        )
        OR
        document_id IN (
            SELECT d.id 
            FROM public.documents d
            WHERE d.company_id IS NOT NULL 
            AND d.company_id IN (
                SELECT p.company_id 
                FROM public.profiles p 
                WHERE p.id = auth.uid()
            )
        )
    );

-- DELETE: Benutzer können Chunks löschen
CREATE POLICY "delete_document_chunks"
    ON public.document_chunks
    FOR DELETE
    TO authenticated
    USING (
        document_id IN (
            SELECT d.id 
            FROM public.documents d
            WHERE d.user_id = auth.uid()
        )
        OR
        document_id IN (
            SELECT d.id 
            FROM public.documents d
            WHERE d.company_id IS NOT NULL 
            AND d.company_id IN (
                SELECT p.company_id 
                FROM public.profiles p 
                WHERE p.id = auth.uid()
            )
        )
    );

-- ============================================
-- STEP 5: Sicherstellen dass RLS aktiviert ist
-- ============================================

ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 6: Verification
-- ============================================

DO $$
DECLARE
    policy_record RECORD;
BEGIN
    RAISE NOTICE '=== knowledge_items policies ===';
    FOR policy_record IN 
        SELECT policyname, cmd, roles 
        FROM pg_policies 
        WHERE tablename = 'knowledge_items'
    LOOP
        RAISE NOTICE 'Policy: %, Command: %, Roles: %', 
            policy_record.policyname, 
            policy_record.cmd, 
            policy_record.roles;
    END LOOP;
    
    RAISE NOTICE '=== document_chunks policies ===';
    FOR policy_record IN 
        SELECT policyname, cmd, roles 
        FROM pg_policies 
        WHERE tablename = 'document_chunks'
    LOOP
        RAISE NOTICE 'Policy: %, Command: %, Roles: %', 
            policy_record.policyname, 
            policy_record.cmd, 
            policy_record.roles;
    END LOOP;
END $$;
