import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { processDocument } from '@/lib/cursor-documents/processing'

// Vercel Function Configuration
export const maxDuration = 60 // seconds
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SUPPORTED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
]

export async function POST(req: NextRequest) {
  console.log('--- API /api/cursor/upload ---')

  try {
    // Extract auth token from request
    const authHeader = req.headers.get('authorization')
    const authToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

    if (!authToken) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Supabase client with user token (RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
        global: {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      }
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse FormData
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const title = (formData.get('title') as string | null) ?? file.name
    const description = formData.get('description') as string | null
    const knowledgeBaseId = formData.get('knowledge_base_id') as string | null

    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: 'Missing knowledge_base_id – Bitte eine Wissensbasis auswählen.' },
        { status: 400 }
      )
    }

    if (file.size === 0) {
      return NextResponse.json({ error: 'Leere Datei' }, { status: 400 })
    }

    // Size checks (Vercel)
    const VERCEL_BODY_LIMIT = 4 * 1024 * 1024 // 4MB
    const MAX_FILE_SIZE = 60 * 1024 * 1024 // 60MB

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: 'Datei zu groß',
          message: `Die Datei ist ${(file.size / 1024 / 1024).toFixed(2)}MB groß. Das Maximum ist 60MB.`,
          max_size_mb: 60,
          current_size_mb: Math.round((file.size / 1024 / 1024) * 100) / 100,
        },
        { status: 413 }
      )
    }

    if (file.size > VERCEL_BODY_LIMIT) {
      return NextResponse.json(
        {
          error: 'Datei zu groß für direkten Upload',
          message: 'Dateien über 4MB müssen über die upload-large Route hochgeladen werden.',
          redirect_to: 'upload-large',
          file_size_mb: Math.round((file.size / 1024 / 1024) * 100) / 100,
        },
        { status: 413 }
      )
    }

    if (!SUPPORTED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Nicht unterstützter Dateityp' }, { status: 400 })
    }

    // Load company_id from profile (company-wide access)
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single()

    const companyId = profile?.company_id ?? undefined

    console.log(`User: ${user.id}`)
    console.log(`File: ${file.name} (${file.type}, ${file.size} bytes)`)
    console.log(`KB: ${knowledgeBaseId}, company: ${companyId ?? 'n/a'}`)

    // Single source of truth: processing.ts uploads + extracts + chunks + n8n dispatch
    const documentId = await processDocument(
      file,
      user.id,
      title || undefined,
      description || undefined,
      companyId,
      knowledgeBaseId
    )

    return NextResponse.json({
      success: true,
      document_id: documentId,
      message: 'Dokument hochgeladen. Verarbeitung läuft.',
      knowledge_item_status: { status: 'processing', message: 'Extraktion/Chunking & Übergabe an Server läuft.' },
    })
  } catch (error: any) {
    console.error('Error in /api/cursor/upload:', error)
    return NextResponse.json(
      { error: `Upload fehlgeschlagen: ${error.message}`, details: error.stack },
      { status: 400 }
    )
  }
}