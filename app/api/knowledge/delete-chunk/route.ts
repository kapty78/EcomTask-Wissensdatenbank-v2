import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getRouteAuth } from '@/lib/route-auth'
import { enqueueGraphJob, resolveGraphTarget } from '@/lib/knowledge-base/graph-enqueue'

export async function DELETE(request: NextRequest) {
  try {
    // Auth check (Bearer im Embedded-Modus, sonst Cookies)
    const auth = await getRouteAuth(request)
    if (!auth) {
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

    // Graph-Ziel VOR dem Löschen auflösen: danach sind die knowledge_items
    // dieses Chunks weg und die KB liesse sich nicht mehr daraus ableiten.
    const { data: chunkRow } = await supabase
      .from('document_chunks')
      .select('document_id')
      .eq('id', chunkId)
      .maybeSingle()
    const graphTarget = chunkRow?.document_id
      ? await resolveGraphTarget(chunkRow.document_id)
      : null

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

    // Graph nachziehen: der Extraktor laeuft ueber die verbliebenen Chunks
    // und der Prune-Schritt raeumt Entitaeten weg, deren einziger Anker
    // gerade verschwunden ist. Ohne das bleiben die Kanten des geloeschten
    // Inhalts fuer immer im Graphen stehen.
    if (graphTarget) {
      await enqueueGraphJob(graphTarget, 'delete')
    }

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
