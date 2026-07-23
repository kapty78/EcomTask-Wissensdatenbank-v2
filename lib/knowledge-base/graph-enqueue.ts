/**
 * Knowledge-Graph: Extraktions-Auftraege einreihen.
 * =====================================================================
 * Vorher gab es genau EINEN Weg in den Graphen: ein nacktes
 * `fetch(...).catch(console.error)` im n8n-Callback, das im Backend in
 * FastAPI-BackgroundTasks landete. Kein Retry, kein Journal — jeder Deploy
 * oder Crash waehrend der Extraktion verlor den Auftrag lautlos. Und kein
 * einziger Pflege-Pfad (Chunk anlegen, Fakt loeschen, Quelle entfernen)
 * hat den Graphen ueberhaupt angefasst. Messbare Folge in der Live-DB:
 * 16 von 37 USD-Dokumenten standen dauerhaft auf 'pending', und der Graph
 * hing 1,5 Tage hinter dem Wissensstand her.
 *
 * Jetzt schreiben alle Schreibpfade direkt in die Outbox
 * `knowledge_graph_jobs` (RPC `enqueue_graph_job`). Bewusst per DB statt
 * per HTTP ans Backend: der Auftrag ueberlebt damit auch ein Backend, das
 * gerade neu deployt wird oder nicht erreichbar ist. Der Worker im
 * Support-Backend holt ihn ab, sobald er wieder laeuft.
 *
 * Idempotent: liegt fuer dasselbe Ziel schon ein offener Auftrag, wird
 * kein zweiter angelegt. Zehn Chunk-Edits hintereinander ergeben also
 * eine Extraktion, nicht zehn.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/lib/utils/logger'

export type GraphJobReason =
  | 'upload'
  | 'chunk_edit'
  | 'delete'
  | 'manual'
  | 'reconcile'
  | 'rebuild'

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface EnqueueTarget {
  companyId: string
  knowledgeBaseId: string
  documentId?: string | null
  sourceName?: string | null
}

/**
 * Reiht einen Auftrag ein. Wirft NIE — der Aufrufer hat seine eigentliche
 * Arbeit (Chunk speichern, Fakt loeschen) bereits erledigt und darf daran
 * nicht scheitern, nur weil die Queue klemmt. Der Reconciler im Backend
 * findet die Luecke dann spaetestens beim naechsten Durchlauf.
 */
export async function enqueueGraphJob(
  target: EnqueueTarget,
  reason: GraphJobReason
): Promise<string | null> {
  const { companyId, knowledgeBaseId, documentId, sourceName } = target
  if (!companyId || !knowledgeBaseId) {
    logger.warn('[graph-enqueue] company_id oder knowledge_base_id fehlt', {
      companyId,
      knowledgeBaseId,
      reason,
    })
    return null
  }

  try {
    const { data, error } = await adminClient().rpc('enqueue_graph_job', {
      p_company_id: companyId,
      p_knowledge_base_id: knowledgeBaseId,
      p_document_id: documentId ?? null,
      p_source_name: sourceName ?? null,
      p_reason: reason,
    })

    if (error) {
      logger.error('[graph-enqueue] RPC fehlgeschlagen', {
        message: error.message,
        knowledgeBaseId,
        documentId,
        reason,
      })
      return null
    }

    logger.info('[graph-enqueue] Auftrag eingereiht', {
      jobId: data,
      knowledgeBaseId,
      documentId,
      reason,
    })
    return (data as string) ?? null
  } catch (err) {
    logger.error('[graph-enqueue] Unerwarteter Fehler', err)
    return null
  }
}

/**
 * Bequemer Einstieg fuer alle Pfade, die nur eine `documentId` kennen.
 * Loest knowledge_base_id und company_id ueber die Fakten des Dokuments auf.
 *
 * Achtung: bei DELETE-Pfaden VOR dem Loeschen aufrufen — danach gibt es
 * keine knowledge_items mehr, aus denen sich die KB ableiten liesse.
 * Deshalb gibt es `resolveGraphTarget`, das man vorab aufrufen und dessen
 * Ergebnis man nach dem Loeschen an `enqueueGraphJob` weiterreichen kann.
 */
export async function resolveGraphTarget(
  documentId: string
): Promise<EnqueueTarget | null> {
  try {
    const { data, error } = await adminClient()
      .from('knowledge_items')
      .select('knowledge_base_id, company_id')
      .eq('document_id', documentId)
      .limit(1)
      .maybeSingle()

    if (error || !data?.knowledge_base_id || !data?.company_id) {
      logger.warn('[graph-enqueue] Ziel fuer Dokument nicht aufloesbar', {
        documentId,
        error: error?.message,
      })
      return null
    }

    return {
      companyId: data.company_id,
      knowledgeBaseId: data.knowledge_base_id,
      documentId,
    }
  } catch (err) {
    logger.error('[graph-enqueue] resolveGraphTarget fehlgeschlagen', err)
    return null
  }
}

/** Kurzform: aufloesen und einreihen in einem Schritt. */
export async function enqueueGraphJobForDocument(
  documentId: string,
  reason: GraphJobReason
): Promise<string | null> {
  const target = await resolveGraphTarget(documentId)
  if (!target) return null
  return enqueueGraphJob(target, reason)
}

/**
 * Fuer Loeschpfade: markiert die KB als graph-relevant veraendert, ohne ein
 * bestimmtes Dokument. Der Extraktor laeuft dann ueber die verbliebenen
 * Fakten der Quelle und der Prune-Schritt raeumt verwaiste Entitaeten weg.
 */
export async function enqueueGraphJobForKb(
  companyId: string,
  knowledgeBaseId: string,
  sourceName: string | null,
  reason: GraphJobReason
): Promise<string | null> {
  return enqueueGraphJob(
    { companyId, knowledgeBaseId, sourceName },
    reason
  )
}
