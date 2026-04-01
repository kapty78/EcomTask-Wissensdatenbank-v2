import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Vercel Cron: läuft alle 2 Minuten.
// Findet Fakten-Chunks, deren Regenerierung vor mehr als 4 Minuten gestartet wurde
// und stellt die alten Fakten wieder her (Rollback).
// Das Löschen von "pending" Backup-Fakten nach erfolgreicher Regenerierung übernimmt
// ausschließlich der Client über /api/knowledge/cleanup-regeneration, NICHT dieser Cron.
// So wird verhindert, dass ein partieller N8N-Schreibvorgang die alten Fakten vernichtet.

const RESTORE_AFTER_MS = 4 * 60 * 1000 // 4 Minuten

export async function GET(req: NextRequest) {
  // Vercel setzt diesen Header automatisch bei Cron-Aufrufen
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const cutoff = new Date(Date.now() - RESTORE_AFTER_MS).toISOString()

  // Alle abgelaufenen "pending" Fakten laden
  const { data: staleItems, error: fetchError } = await supabase
    .from('knowledge_items')
    .select('id, source_chunk')
    .eq('is_pending_regeneration', true)
    .lt('regeneration_started_at', cutoff)

  if (fetchError) {
    console.error('[cron/restore-stale-facts] Fetch error:', fetchError.message)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!staleItems || staleItems.length === 0) {
    return NextResponse.json({ success: true, restored: 0, cleaned: 0 })
  }

  // Nach source_chunk gruppieren
  const chunkMap = new Map<string, string[]>()
  for (const item of staleItems) {
    if (!item.source_chunk) continue
    if (!chunkMap.has(item.source_chunk)) chunkMap.set(item.source_chunk, [])
    chunkMap.get(item.source_chunk)!.push(item.id)
  }

  let restored = 0

  for (const [, pendingIds] of chunkMap.entries()) {
    // Immer wiederherstellen – der Cron löscht nie.
    // Grund: N8N könnte nur teilweise geschrieben haben (z.B. 3 von 20 Fakten).
    // Würden wir bei count > 0 löschen, verlöre der User seine alten Backup-Fakten.
    // Cleanup nach echtem Erfolg läuft ausschließlich über /api/knowledge/cleanup-regeneration.
    const { error } = await supabase
      .from('knowledge_items')
      .update({
        is_pending_regeneration: false,
        regeneration_started_at: null,
      })
      .in('id', pendingIds)

    if (!error) restored += pendingIds.length
  }

  console.log(`[cron/restore-stale-facts] restored=${restored}`)
  return NextResponse.json({ success: true, restored })
}
