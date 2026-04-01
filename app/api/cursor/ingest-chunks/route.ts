import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface IngestChunksBody {
  fileName: string
  fileType?: string
  fileSize?: number
  title?: string
  description?: string
  workspaceId?: string
  knowledgeBaseId?: string
  chunks: Array<{ position: number; content: string }>
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    const authToken = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null

    if (!authToken) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        },
        global: {
          headers: {
            Authorization: `Bearer ${authToken}`
          }
        }
      }
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ✅ COMPANY SHARING: Lade company_id aus Profil
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.company_id) {
      return NextResponse.json({ error: 'Keine Company zugewiesen. Bitte Administrator kontaktieren.' }, { status: 403 })
    }

    const userCompanyId = profile.company_id

    const body = (await req.json()) as IngestChunksBody
    const { fileName, fileType, fileSize, title, description, workspaceId, knowledgeBaseId, chunks } = body

    if (!fileName || !Array.isArray(chunks) || chunks.length === 0) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Create document record
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .insert({
        file_name: fileName,
        file_type: fileType || 'text/plain',
        file_size: fileSize || null,
        storage_url: null,
        title: title || fileName,
        description: description || null,
        user_id: user.id,
        workspace_id: workspaceId || null
      })
      .select()
      .single()

    if (docError || !document) {
      return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
    }

    // Initial status
    await supabaseAdmin
      .from('document_processing_status')
      .upsert({
        document_id: document.id,
        status: 'processing',
        progress: 35,
        message: 'Clientseitige Chunks empfangen – speichere in der Datenbank...',
        updated_at: new Date().toISOString()
      })

    // Insert chunks
    const records = chunks.map(c => ({
      document_id: document.id,
      content: c.content,
      content_position: c.position,
      chunk_size: c.content?.length || 0,
      created_at: new Date().toISOString(),
      processing_complete: false
    }))

    const { error: insertError } = await supabaseAdmin
      .from('document_chunks')
      .insert(records)

    if (insertError) {
      return NextResponse.json({ error: `Failed to insert chunks: ${insertError.message}` }, { status: 500 })
    }

    await supabaseAdmin
      .from('document_processing_status')
      .upsert({
        document_id: document.id,
        status: 'processing',
        progress: 60,
        message: `${records.length} Chunks gespeichert. Übergabe an Server...`,
        updated_at: new Date().toISOString()
      })

    // Start processing orchestration (re-use existing endpoint)
    try {
      const host = req.headers.get('host')
      const protocol = req.headers.get('x-forwarded-proto') || 'https'
      const baseUrl = host ? `${protocol}://${host}` : 'http://localhost:3000'

      await fetch(`${baseUrl}/api/cursor/process-document-chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: document.id,
          userId: user.id,
          knowledgeBaseId: knowledgeBaseId || undefined,
          apiKey: process.env.API_SECRET_KEY
        })
      }).catch(() => {})
    } catch {}

    return NextResponse.json({
      success: true,
      documentId: document.id,
      chunks: records.length,
      message: 'Chunks gespeichert. Server-Verarbeitung gestartet.'
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Ingest failed' }, { status: 500 })
  }
}


