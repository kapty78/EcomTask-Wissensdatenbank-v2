// Fakten-Regenerierung für Agent-Chunk-Schreiboperationen.
//
// Repliziert exakt den Flow des UI-Buttons "Fakten neu generieren"
// (KnowledgeComponentDashboard → mark-for-regeneration → N8N_WEBHOOK_URL_FACTS
// → Realtime/Poll → cleanup-regeneration), damit Agent-Edits dieselbe
// Datenqualität erzeugen wie manuelle Edits:
//
// 1. Bestehende Facts als pending markieren (Soft-Backup; der Vercel-Cron
//    /api/cron/restore-stale-facts stellt sie nach 4 Minuten wieder her,
//    falls die Generierung fehlschlägt — der Cron löscht NIE).
// 2. Webhook mit UI-identischem Payload aufrufen (Fact-Extraktion + Embeddings).
// 3. Auf neue Facts pollen (begrenzt); erst nach verifiziertem Erfolg die
//    alten Backup-Facts endgültig löschen und den Chunk als verarbeitet markieren.
//
// Hintergrund (Vorfall 2026-07-16, USD Reisen): update_chunk_content schrieb
// neuen Chunk-Text, aber die Fact-Anker blieben auf dem alten Stand — das
// Retrieval fand weiterhin die alten, teils widersprechenden Facts, während
// der neue Regeltext für die Vektorsuche unsichtbar war.

type FactRegenerationStatus = "completed" | "queued" | "failed"

export type FactRegenerationOutcome = {
  status: FactRegenerationStatus
  /** Anzahl neu generierter Facts (bei status=completed). */
  new_facts?: number
  /** Anzahl endgültig gelöschter alter Backup-Facts (bei status=completed). */
  cleaned_old_facts?: number
  error?: string
  /** Handlungshinweis für den Agenten. */
  hint?: string
}

export type FactRegenerationChunk = {
  id: string
  content: string
  content_position?: number | null
  document_id: string
}

export type FactRegenerationDocument = {
  id: string
  title?: string | null
  file_name?: string | null
  file_type?: string | null
  file_size?: number | null
  storage_url?: string | null
  workspace_id?: string | null
  company_id?: string | null
}

const DEFAULT_WAIT_MS = 90_000
const POLL_INTERVAL_MS = 3_000
// Puffer gegen Clock-Skew zwischen Vercel und Supabase. Ältere Facts sind
// durch is_pending_regeneration=false + Markierung ausgeschlossen.
const STARTED_AT_SLACK_MS = 10_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Führt die komplette Fakten-Regenerierung für einen Chunk aus.
 *
 * Wirft NIE — der Aufrufer (z.B. update_chunk_content) hat den Chunk-Text
 * bereits gespeichert; ein Regenerierungsfehler darf den Save nicht als
 * fehlgeschlagen erscheinen lassen. Fehler landen im Outcome.
 */
export async function runChunkFactRegeneration(params: {
  serviceClient: any
  chunk: FactRegenerationChunk
  document: FactRegenerationDocument
  knowledgeBaseId: string
  userId: string
  customPrompt?: string | null
  waitMs?: number
}): Promise<FactRegenerationOutcome> {
  const { serviceClient, chunk, document, knowledgeBaseId, userId, customPrompt } = params
  const waitMs = typeof params.waitMs === "number" ? params.waitMs : DEFAULT_WAIT_MS

  const webhookUrl = process.env.N8N_WEBHOOK_URL_FACTS
  if (!webhookUrl) {
    return {
      status: "failed",
      error: "N8N_WEBHOOK_URL_FACTS ist nicht konfiguriert.",
      hint: "Facts wurden NICHT regeneriert — der Chunk-Text ist gespeichert, aber die Such-Anker sind veraltet. Konfiguration melden."
    }
  }

  // 1. Bestehende Facts als pending markieren (Backup). Nur Facts, die nicht
  // bereits in einer laufenden Regenerierung stecken.
  const startedAtIso = new Date().toISOString()
  const pollFromIso = new Date(Date.now() - STARTED_AT_SLACK_MS).toISOString()

  const { data: markedRows, error: markError } = await serviceClient
    .from("knowledge_items")
    .update({
      is_pending_regeneration: true,
      regeneration_started_at: startedAtIso
    })
    .eq("source_chunk", chunk.id)
    .eq("is_pending_regeneration", false)
    .select("id")

  if (markError) {
    return {
      status: "failed",
      error: `Bestehende Facts konnten nicht für die Regenerierung markiert werden: ${markError.message}`,
      hint: "Facts wurden NICHT regeneriert. Erneut mit regenerate_chunk_facts versuchen."
    }
  }

  const markedIds: string[] = Array.isArray(markedRows) ? markedRows.map((r: any) => r.id) : []

  const rollbackMarks = async () => {
    if (markedIds.length === 0) return
    await serviceClient
      .from("knowledge_items")
      .update({ is_pending_regeneration: false, regeneration_started_at: null })
      .in("id", markedIds)
  }

  // 2. Webhook aufrufen — Payload identisch zur UI-Route
  // /api/knowledge/regenerate-facts (source_chunk_id/source_document_id sind
  // Pflicht, damit die neuen Facts korrekt am Chunk verankert werden).
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : null

  const payload = {
    document: {
      id: document.id,
      title: document.title || document.file_name || null,
      file_name: document.file_name || null,
      file_type: document.file_type || null,
      file_size: document.file_size || null,
      storage_url: document.storage_url || null,
      workspace_id: document.workspace_id || null,
      company_id: document.company_id || null,
      knowledge_base_id: knowledgeBaseId,
      user_id: userId
    },
    chunk: {
      id: chunk.id,
      content: chunk.content,
      position: chunk.content_position ?? 0,
      document_id: chunk.document_id,
      regenerate_facts: true
    },
    options: {
      language: "de",
      max_facts_per_chunk: 20,
      create_embeddings: true,
      embedding_provider: "openai",
      source_type: "regenerate_facts",
      knowledge_base_id: knowledgeBaseId,
      source_chunk_id: chunk.id,
      source_document_id: chunk.document_id,
      supabase_host: supabaseHost,
      ...(customPrompt ? { custom_prompt: customPrompt } : {})
    }
  }

  let webhookOk = false
  let webhookError = ""
  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    webhookOk = webhookResponse.ok
    if (!webhookOk) {
      const body = await webhookResponse.text().catch(() => "")
      webhookError = `Webhook-Fehler ${webhookResponse.status}: ${body.slice(0, 160)}`
    }
  } catch (error: any) {
    webhookError = `Webhook nicht erreichbar: ${error?.message || "unbekannt"}`
  }

  if (!webhookOk) {
    // Sofortiger Rollback statt 4 Minuten auf den Cron zu warten — die alten
    // Facts bleiben so ohne Lücke aktiv.
    await rollbackMarks()
    return {
      status: "failed",
      error: webhookError,
      hint: "Facts wurden NICHT regeneriert; die bestehenden Facts sind weiterhin aktiv. Später erneut mit regenerate_chunk_facts versuchen."
    }
  }

  // 3. Auf neue Facts pollen. Erst wenn welche da sind UND die Anzahl über
  // einen Poll-Zyklus stabil bleibt (n8n schreibt ggf. in Teilbatches),
  // gilt die Regenerierung als abgeschlossen.
  const deadline = Date.now() + waitMs
  let lastCount = 0

  const countNewFacts = async (): Promise<number | null> => {
    const { count, error } = await serviceClient
      .from("knowledge_items")
      .select("id", { count: "exact", head: true })
      .eq("source_chunk", chunk.id)
      .eq("is_pending_regeneration", false)
      .gte("created_at", pollFromIso)
    if (error) return null
    return typeof count === "number" ? count : 0
  }

  while (Date.now() < deadline) {
    const current = await countNewFacts()
    if (current !== null && current > 0) {
      if (current === lastCount) {
        // 4. Verifizierter Erfolg: alte Backup-Facts endgültig löschen
        // (Gegenstück zu /api/knowledge/cleanup-regeneration) und Chunk als
        // verarbeitet markieren.
        let cleaned = 0
        if (markedIds.length > 0) {
          const { data: deletedRows } = await serviceClient
            .from("knowledge_items")
            .delete()
            .in("id", markedIds)
            .eq("is_pending_regeneration", true)
            .select("id")
          cleaned = Array.isArray(deletedRows) ? deletedRows.length : 0
        }

        await serviceClient
          .from("document_chunks")
          .update({
            processing_complete: true,
            facts_count: current,
            updated_at: new Date().toISOString()
          })
          .eq("id", chunk.id)

        return {
          status: "completed",
          new_facts: current,
          cleaned_old_facts: cleaned,
          hint: `Facts regeneriert: ${current} neue Such-Anker aktiv, ${cleaned} veraltete ersetzt.`
        }
      }
      lastCount = current
    }
    await sleep(POLL_INTERVAL_MS)
  }

  // Timeout: KEIN Rollback — die Generierung kann noch eintreffen. Falls
  // nicht, stellt der Cron die alten Facts nach 4 Minuten wieder her
  // (identisches Verhalten zum UI-Flow bei geschlossenem Tab).
  return {
    status: "queued",
    error: `Keine neuen Facts innerhalb von ${Math.round(waitMs / 1000)}s sichtbar.`,
    hint: "Regenerierung läuft ggf. noch. Vor Abschluss des Auftrags mit get_chunk_details oder search_kb_text verifizieren, ob neue Facts angekommen sind; sonst regenerate_chunk_facts erneut ausführen."
  }
}
