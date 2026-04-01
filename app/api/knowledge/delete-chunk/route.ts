import { createClient } from '@supabase/supabase-js'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(request: NextRequest) {
  try {
    // Auth check
    const cookieStore = cookies()
    const authClient = createRouteHandlerClient({ cookies: () => cookieStore })
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { chunkId } = await request.json()

    if (!chunkId) {
      return NextResponse.json(
        { error: 'Chunk-ID ist erforderlich' },
        { status: 400 }
      )
    }

    // Supabase Client mit Service Key für Admin-Operationen
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    console.log('🗑️ Chunk-Löschung gestartet für:', chunkId)

    // Zuerst alle zugehörigen Knowledge Items (Fakten) löschen
    const { error: factsDeleteError } = await supabase
      .from('knowledge_items')
      .delete()
      .eq('source_chunk', chunkId)

    if (factsDeleteError) {
      console.error('❌ Fehler beim Löschen der Fakten:', factsDeleteError)
      return NextResponse.json(
        { error: 'Fehler beim Löschen der zugehörigen Fakten', details: factsDeleteError.message },
        { status: 500 }
      )
    }

    // Dann den Chunk selbst löschen
    const { error: chunkDeleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('id', chunkId)

    if (chunkDeleteError) {
      console.error('❌ Fehler beim Löschen des Chunks:', chunkDeleteError)
      return NextResponse.json(
        { error: 'Fehler beim Löschen des Chunks', details: chunkDeleteError.message },
        { status: 500 }
      )
    }

    console.log('✅ Chunk und zugehörige Fakten erfolgreich gelöscht:', chunkId)

    return NextResponse.json({ 
      success: true, 
      message: 'Chunk und alle zugehörigen Fakten erfolgreich gelöscht'
    })

  } catch (error) {
    console.error('💥 Unerwarteter Fehler beim Chunk-Delete:', error)
    return NextResponse.json(
      { 
        error: 'Interner Server-Fehler',
        details: error instanceof Error ? error.message : 'Unbekannter Fehler'
      },
      { status: 500 }
    )
  }
}
