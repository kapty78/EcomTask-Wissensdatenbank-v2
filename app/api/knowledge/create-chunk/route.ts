import { createClient } from '@supabase/supabase-js'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { generateEmbeddings } from '@/lib/generate-local-embedding'

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const cookieStore = cookies()
    const authClient = createRouteHandlerClient({ cookies: () => cookieStore })
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { documentId, content, knowledgeBaseId, userId } = await request.json()

    if (!documentId || !content) {
      return NextResponse.json(
        { error: 'Document-ID und Inhalt sind erforderlich' },
        { status: 400 }
      )
    }

    // Supabase Client mit Service Key für Admin-Operationen
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    console.log('➕ Chunk-Erstellung gestartet für Document:', documentId)

    // Ermittle die höchste content_position für das Dokument
    const { data: existingChunks, error: positionError } = await supabase
      .from('document_chunks')
      .select('content_position')
      .eq('document_id', documentId)
      .order('content_position', { ascending: false })
      .limit(1)

    if (positionError) {
      console.error('❌ Fehler beim Abrufen der Position:', positionError)
      return NextResponse.json(
        { error: 'Fehler beim Ermitteln der Chunk-Position', details: positionError.message },
        { status: 500 }
      )
    }

    const nextPosition = existingChunks && existingChunks.length > 0 
      ? (existingChunks[0].content_position || 0) + 1 
      : 0

    // Neuen Chunk erstellen
    const newChunk = {
      document_id: documentId,
      content,
      content_position: nextPosition,
      content_length: content.length,
      content_tokens: Math.ceil(content.split(/\s+/).length * 1.33),
      processing_complete: false,
      created_at: new Date().toISOString(),
    }

    const { data: createdChunk, error: chunkError } = await supabase
      .from('document_chunks')
      .insert(newChunk)
      .select()
      .single()

    if (chunkError || !createdChunk) {
      console.error('❌ Fehler beim Erstellen des Chunks:', chunkError)
      return NextResponse.json(
        { error: 'Fehler beim Erstellen des Chunks', details: chunkError?.message },
        { status: 500 }
      )
    }

    console.log('✅ Chunk erfolgreich erstellt:', createdChunk.id)

    // Optional: Wenn knowledgeBaseId und userId vorhanden sind, extrahiere Fakten
    // Dies könnte auch asynchron über einen separaten Endpoint erfolgen
    if (knowledgeBaseId && userId) {
      console.log('ℹ️ Faktenextraktion für neuen Chunk kann über separaten Endpoint erfolgen')
    }

    return NextResponse.json({ 
      success: true, 
      chunk: createdChunk,
      message: 'Chunk erfolgreich erstellt'
    })

  } catch (error) {
    console.error('💥 Unerwarteter Fehler beim Chunk-Create:', error)
    return NextResponse.json(
      { 
        error: 'Interner Server-Fehler',
        details: error instanceof Error ? error.message : 'Unbekannter Fehler'
      },
      { status: 500 }
    )
  }
}

