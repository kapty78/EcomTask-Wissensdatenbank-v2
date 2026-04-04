import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    console.log('[server-callback] Received POST callback:', body)
    // Vereinheitlichte Logik: benutze dieselbe sichere Verarbeitung wie beim GET
    return await processCallback(body)
  } catch (error: any) {
    console.error('[server-callback] Error:', error)
    return NextResponse.json({ 
      error: `Callback processing failed: ${error.message}` 
    }, { status: 500 })
  }
}

// GET handler für Redirect mit Query-Parametern
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    
    const body = {
      documentId: searchParams.get('documentId'),
      event: searchParams.get('event'),
      status: searchParams.get('status'),
      success: searchParams.get('success') === 'true',
      totalFacts: searchParams.get('totalFacts') ? parseInt(searchParams.get('totalFacts')!) : undefined,
      message: searchParams.get('message'),
      error: searchParams.get('error'),
      progress: searchParams.get('progress') ? parseInt(searchParams.get('progress')!) : undefined,
      processedChunks: searchParams.get('processedChunks') ? parseInt(searchParams.get('processedChunks')!) : undefined,
      totalChunks: searchParams.get('totalChunks') ? parseInt(searchParams.get('totalChunks')!) : undefined,
      round: searchParams.get('round') ? parseInt(searchParams.get('round')!) : undefined,
      totalRounds: searchParams.get('totalRounds') ? parseInt(searchParams.get('totalRounds')!) : undefined
    }
    
    console.log('[server-callback] Received GET callback:', body)
    
    // Verwende die gleiche Logik wie POST
    return await processCallback(body)
    
  } catch (error: any) {
    console.error('[server-callback] GET Error:', error)
    return NextResponse.json({ 
      error: `GET Callback processing failed: ${error.message}` 
    }, { status: 500 })
  }
}

// Gemeinsame Verarbeitungslogik
async function processCallback(body: any) {
  const {
    documentId,
    chunkId,
    status,
    success,
    totalFacts,
    newFacts,
    message,
    error,
    event,
    progress,
    processedChunks,
    totalChunks,
    round,
    totalRounds
  } = body

  if (!documentId) {
    return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })
  }

  // Supabase Admin Client
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Lade aktuellen Status, um inkrementelle Fortschritte berechnen zu können
  let existingProgress = 0
  let existingStatus = 'processing'
  try {
    const { data: currentStatus } = await supabaseAdmin
      .from('document_processing_status')
      .select('progress, status')
      .eq('document_id', documentId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    existingProgress = (currentStatus?.progress as number) || 0
    existingStatus = currentStatus?.status || 'processing'
  } catch {}

  // 🛡️ Schutz: Überschreibe completed/failed nie mit processing (außer bei Fakten-Regenerierung)
  if ((existingStatus === 'completed' || existingStatus === 'failed') && 
      (event === 'facts_progress' || event === 'chunk_processed' || event === 'round_completed' || event === 'processing_started' || event === 'chunks_ready') &&
      !['facts_regenerated', 'facts_regeneration_started', 'facts_regeneration_completed'].includes(event)) {
    console.log(`[server-callback] Ignoring ${event} - document ${documentId} already ${existingStatus}`)
    return NextResponse.json({ 
      success: true, 
      message: `Ignored ${event} - document already ${existingStatus}` 
    })
  }

  // 🛡️ Progress-Schutz: Niemals Progress nach unten setzen (außer bei completed)
  if (event !== 'completed' && event !== 'failed') {
    let eventProgress = existingProgress
    
    if (typeof progress === 'number') {
      eventProgress = progress
    } else {
      switch (event) {
        case 'processing_started': eventProgress = 10; break
        case 'chunks_ready': eventProgress = 60; break
        case 'facts_progress': eventProgress = Math.max(existingProgress + 5, 70); break
        default: eventProgress = existingProgress; break
      }
    }
    
    if (eventProgress < existingProgress) {
      console.log(`[server-callback] Ignoring ${event} - would decrease progress from ${existingProgress}% to ${eventProgress}%`)
      return NextResponse.json({ 
        success: true, 
        message: `Ignored ${event} - would decrease progress` 
      })
    }
  }

  // Compute status/progress/message depending on event or legacy fields
  let targetStatus: 'processing' | 'completed' | 'failed' = 'processing'
  let targetProgress: number = 0
  let targetMessage: string = message || ''

  if (typeof progress === 'number') {
    targetProgress = Math.min(100, Math.max(0, progress))
  } else if (typeof processedChunks === 'number' && typeof totalChunks === 'number' && totalChunks > 0) {
    // Map chunk progress: 60%..95%
    const ratio = Math.min(1, Math.max(0, processedChunks / totalChunks))
    targetProgress = Math.round(60 + ratio * 35) // 60..95
  }

  // Build default messages per event
  switch (event) {
    case 'processing_started':
      targetStatus = 'processing'
      targetProgress = typeof targetProgress === 'number' && targetProgress > 0 ? targetProgress : 10
      targetMessage = targetMessage || 'Verarbeitung auf dem Server gestartet.'
      break
    case 'chunks_ready':
      targetStatus = 'processing'
      targetProgress = targetProgress || 60
      targetMessage = targetMessage || `${totalChunks ?? ''} Chunks erstellt.`
      break
    case 'chunk_processed':
      targetStatus = 'processing'
      targetMessage = targetMessage || `Chunk ${processedChunks}/${totalChunks} verarbeitet.`
      break
    case 'round_completed':
      targetStatus = 'processing'
      targetMessage = targetMessage || `Runde ${round}/${totalRounds} abgeschlossen.`
      // Map rounds to 70..90 if no progress provided
      if (typeof progress !== 'number' && typeof totalRounds === 'number' && totalRounds > 0) {
        const r = Math.min(1, Math.max(0, (round ?? 0) / totalRounds))
        targetProgress = Math.max(targetProgress, Math.round(70 + r * 20))
      }
      break
    case 'facts_progress':
      targetStatus = 'processing'
      // Variante A: Es kommt ein expliziter progress -> verwenden
      if (typeof progress === 'number') {
        targetProgress = Math.min(95, Math.max(existingProgress, progress))
      } else if (typeof totalRounds === 'number' && totalRounds > 0) {
        // Variante B: Rundenfortschritt -> mappe 70..95
        const r = Math.min(1, Math.max(0, (round ?? 0) / totalRounds))
        targetProgress = Math.max(existingProgress, Math.round(70 + r * 25))
      } else if (typeof processedChunks === 'number' && typeof totalChunks === 'number' && totalChunks > 0) {
        // Variante C: Chunksfortschritt -> mappe 70..95
        const ratio = Math.min(1, Math.max(0, processedChunks / totalChunks))
        targetProgress = Math.max(existingProgress, Math.round(70 + ratio * 25))
      } else {
        // Variante D: Bei uns zählen -> aus DB ermitteln, sonst inkrementell
        try {
          const { count: totalCnt } = await supabaseAdmin
            .from('document_chunks')
            .select('id', { count: 'exact', head: true })
            .eq('document_id', documentId)

          let processedCnt = 0
          // Erst versuchen: processing_complete = true
          try {
            const { count } = await supabaseAdmin
              .from('document_chunks')
              .select('id', { count: 'exact', head: true })
              .eq('document_id', documentId)
              .eq('processing_complete', true as any)
            processedCnt = count ?? 0
          } catch {
            // Fallback: facts_count > 0
            try {
              const { count } = await supabaseAdmin
                .from('document_chunks')
                .select('id', { count: 'exact', head: true })
                .eq('document_id', documentId)
                .gt('facts_count' as any, 0)
              processedCnt = count ?? 0
            } catch {}
          }

          if (typeof totalCnt === 'number' && totalCnt > 0) {
            const ratio = Math.min(1, Math.max(0, processedCnt / totalCnt))
            targetProgress = Math.max(existingProgress, Math.round(70 + ratio * 25))
            targetMessage = targetMessage || `Chunk ${processedCnt}/${totalCnt} verarbeitet.`
          } else {
            const base = existingProgress > 0 ? existingProgress : 70
            targetProgress = Math.min(95, base + 5)
          }
        } catch {
          const base = existingProgress > 0 ? existingProgress : 70
          targetProgress = Math.min(95, base + 5)
        }
      }
      // Bevorzuge übergebenen Status-Text, sonst message, sonst Default
      targetMessage = (body.status as string) || targetMessage || 'Fakten werden extrahiert...'
      break
    case 'facts_regeneration_started':
      targetStatus = 'processing'
      targetProgress = typeof targetProgress === 'number' && targetProgress > 0 ? targetProgress : existingProgress
      targetMessage = targetMessage || `Fakten für Chunk werden neu generiert...`
      break
    case 'facts_regenerated':
    case 'facts_regeneration_completed':
      // Fakten-Regenerierung ist abgeschlossen - Status bleibt wie er war
      targetStatus = existingStatus === 'failed' ? 'processing' : existingStatus as any
      targetProgress = existingProgress
      targetMessage = targetMessage || `Fakten für Chunk erfolgreich regeneriert. ${newFacts || totalFacts || 0} neue Fakten erstellt.`
      
      // Bei Fakten-Regenerierung senden wir eine separate Benachrichtigung
      if (chunkId) {
        console.log(`[server-callback] Facts regenerated for chunk ${chunkId}: ${newFacts || totalFacts || 0} facts`)
        // Hier könnte später ein Realtime-Update per WebSocket gesendet werden
      }
      break
    case 'completed':
      targetStatus = 'completed'
      targetProgress = 100
      targetMessage = targetMessage || `Verarbeitung erfolgreich abgeschlossen. ${totalFacts || 0} Fakten extrahiert.`
      break
    case 'failed':
      targetStatus = 'failed'
      targetProgress = 0
      targetMessage = targetMessage || `Verarbeitung fehlgeschlagen: ${error || 'Unbekannter Fehler'}`
      break
    default:
      // Legacy mapping by success/status
      if (typeof success === 'boolean') {
        targetStatus = success ? 'completed' : 'failed'
        targetProgress = success ? 100 : 0
        targetMessage = targetMessage || (success
          ? `Verarbeitung erfolgreich abgeschlossen. ${totalFacts || 0} Fakten extrahiert.`
          : `Verarbeitung fehlgeschlagen: ${error || 'Unbekannter Fehler'}`)
      } else if (status === 'completed') {
        targetStatus = 'completed'
        targetProgress = 100
        targetMessage = targetMessage || `Verarbeitung erfolgreich abgeschlossen. ${totalFacts || 0} Fakten extrahiert.`
      } else if (status === 'failed') {
        targetStatus = 'failed'
        targetProgress = 0
        targetMessage = targetMessage || `Verarbeitung fehlgeschlagen: ${error || 'Unbekannter Fehler'}`
      } else {
        targetStatus = 'processing'
        targetProgress = targetProgress || 50
        targetMessage = targetMessage || 'Verarbeitung läuft...'
      }
      break
  }

  await supabaseAdmin
    .from('document_processing_status')
    .upsert({
      document_id: documentId,
      status: targetStatus as any,
      progress: targetProgress,
      message: targetMessage,
      error: targetStatus === 'failed' ? (error || 'Server processing failed') : null,
      updated_at: new Date().toISOString()
    })

  console.log(`[server-callback] Updated document ${documentId} status to ${targetStatus} (${targetProgress}%)`)

  // ✅ Knowledge Graph Extraction: Trigger nach erfolgreicher Fakten-Extraktion
  if (targetStatus === 'completed' && documentId) {
    const graphBackendUrl = process.env.SUPPORT_BACKEND_URL
    const graphApiKey = process.env.SUPPORT_BACKEND_API_KEY
    if (graphBackendUrl && graphApiKey) {
      try {
        // Lade company_id und knowledge_base_id für dieses Dokument
        const { data: doc } = await supabaseAdmin
          .from('documents')
          .select('company_id')
          .eq('id', documentId)
          .single()

        // knowledge_base_id aus den knowledge_items dieses Dokuments ermitteln
        const { data: kbItem } = await supabaseAdmin
          .from('knowledge_items')
          .select('knowledge_base_id')
          .eq('document_id', documentId)
          .limit(1)
          .maybeSingle()

        const companyId = doc?.company_id
        const kbId = kbItem?.knowledge_base_id

        if (companyId && kbId) {
          fetch(`${graphBackendUrl}/api/v1/knowledge/graph-extract`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': graphApiKey,
            },
            body: JSON.stringify({
              knowledge_base_id: kbId,
              company_id: companyId,
              document_id: documentId,
            }),
          }).catch((err) =>
            console.error('[Graph] Fire-and-forget graph extraction failed:', err)
          )
          console.log(`[server-callback] Graph extraction triggered for document ${documentId}`)
        } else {
          console.log(`[server-callback] Skipping graph extraction: missing company_id (${companyId}) or kb_id (${kbId})`)
        }
      } catch (err) {
        console.error('[server-callback] Error triggering graph extraction:', err)
      }
    }
  }

  // ✅ NEU: Spezielle Behandlung für Fakten-Regenerierung
  if (event === 'facts_regenerated' || event === 'facts_regeneration_completed') {
    return NextResponse.json({ 
      success: true, 
      message: 'Facts regeneration completed successfully',
      event: 'facts_regenerated',
      chunkId,
      newFacts: newFacts || totalFacts,
      documentId
    })
  }

  return NextResponse.json({ 
    success: true, 
    message: 'Status updated successfully' 
  })
}
