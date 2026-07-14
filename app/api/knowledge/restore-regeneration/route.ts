import { NextRequest, NextResponse } from 'next/server'
import { getRouteAuth } from '@/lib/route-auth'

// Sofortiger Rollback bei Webhook-Fehler.
// Setzt is_pending_regeneration = false für die angegebenen Item-IDs,
// damit die alten Fakten sofort wieder sichtbar sind – ohne auf den 4-Minuten-Cron zu warten.
export async function POST(req: NextRequest) {
  try {
    const { itemIds, chunkId } = await req.json()

    const hasItemIds = Array.isArray(itemIds) && itemIds.length > 0
    const hasChunkId = typeof chunkId === 'string' && chunkId.length > 0

    if (!hasItemIds && !hasChunkId) {
      return NextResponse.json(
        { error: 'itemIds (array) oder chunkId ist erforderlich' },
        { status: 400 }
      )
    }

    // Auth: RLS-gescopter Client — die company-isolierte UPDATE-Policy auf
    // knowledge_items lässt nur eigene/Company-Items wiederherstellen.
    const auth = await getRouteAuth(req)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const supabase = auth.supabase

    let query = supabase
      .from('knowledge_items')
      .update({
        is_pending_regeneration: false,
        regeneration_started_at: null,
      })
      .eq('is_pending_regeneration', true)

    if (hasChunkId) {
      query = query.eq('source_chunk', chunkId)
    } else {
      query = query.in('id', itemIds)
    }

    const { data, error } = await query.select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      restoredCount: Array.isArray(data) ? data.length : 0,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
