import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

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
