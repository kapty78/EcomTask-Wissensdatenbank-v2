import { NextRequest, NextResponse } from 'next/server'
import { getRouteAuth } from '@/lib/route-auth'

// Wird nach erfolgreicher Fakten-Regenerierung aufgerufen.
// Löscht die alten, als "pending" markierten Fakten endgültig.
export async function POST(req: NextRequest) {
  try {
    const { chunkId } = await req.json()

    if (!chunkId) {
      return NextResponse.json(
        { error: 'chunkId ist erforderlich' },
        { status: 400 }
      )
    }

    // Auth: RLS-gescopter Client stellt sicher, dass NUR eigene/Company-Items
    // gelöscht werden (knowledge_items DELETE-Policy ist company-isoliert).
    const auth = await getRouteAuth(req)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const supabase = auth.supabase

    const { error } = await supabase
      .from('knowledge_items')
      .delete()
      .eq('source_chunk', chunkId)
      .eq('is_pending_regeneration', true)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
