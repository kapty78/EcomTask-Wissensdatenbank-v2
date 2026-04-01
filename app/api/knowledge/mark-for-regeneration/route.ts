import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Markiert bestehende Fakten als "pending regeneration" (Soft-Delete).
// Sie bleiben in der DB als Backup, bis der Cron sie bereinigt oder wiederherstellt.
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const startedAt = new Date().toISOString()
    let query = supabase
      .from('knowledge_items')
      .update({
        is_pending_regeneration: true,
        regeneration_started_at: startedAt,
      })
      .eq('is_pending_regeneration', false)

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
      markedCount: Array.isArray(data) ? data.length : 0,
      startedAt,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
