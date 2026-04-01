-- Migration: Fix document_chunks RLS policy for company-wide editing
-- Date: 2025-10-04
-- Description: Update document_chunks UPDATE and DELETE policies to allow company-wide editing
-- Note: Works with or without company_id column

-- Drop existing policies and recreate with company_id support
DROP POLICY IF EXISTS "Users can update own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can update company document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can delete own document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can delete company document chunks" ON public.document_chunks;

-- UPDATE: Company-weite Bearbeitung für Chunks erlauben (via Documents)
CREATE POLICY "Users can update company document chunks"
  ON public.document_chunks
  FOR UPDATE
  USING (
    -- Chunks von Dokumenten die zur gleichen Company gehören (via documents Tabelle)
    document_id IN (
      SELECT d.id 
      FROM public.documents d
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE d.company_id = p.company_id
      AND p.company_id IS NOT NULL
    )
    OR
    -- Chunks von eigenen Dokumenten (fallback für persönliche Dokumente)
    document_id IN (
      SELECT id FROM public.documents WHERE user_id = auth.uid()
    )
  );

-- DELETE: Company-weite Löschung für Chunks erlauben (nur für Company-Admins oder eigene)
CREATE POLICY "Users can delete company document chunks"
  ON public.document_chunks
  FOR DELETE
  USING (
    -- Company-Admins können alle Company-Chunks löschen (via documents)
    EXISTS (
      SELECT 1 
      FROM public.company_admins ca
      JOIN public.profiles p ON p.id = auth.uid()
      JOIN public.documents d ON d.id = document_chunks.document_id
      WHERE ca.user_id = auth.uid()
      AND ca.company_id = p.company_id
      AND d.company_id = p.company_id
    )
    OR
    -- Chunks von eigenen Dokumenten können gelöscht werden
    document_id IN (
      SELECT id FROM public.documents WHERE user_id = auth.uid()
    )
  );

-- Ensure RLS is enabled
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
