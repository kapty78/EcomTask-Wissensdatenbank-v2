/**
 * Graph-Status einer Wissensdatenbank.
 * =====================================================================
 * Beantwortet die Frage, die man bisher nur per SQL beantworten konnte:
 * "Steht in meinem Graphen eigentlich das, was in meiner Wissensdatenbank
 * steht?" — Entitäten/Kanten/Themen, offene und gescheiterte Aufträge,
 * und vor allem der Vergleich "letzte Extraktion vs. jüngster Fakt".
 *
 * Genau dieser Vergleich hat den Rückstand sichtbar gemacht: bei USD Reisen
 * war der jüngste Fakt vom 22.07., die jüngste Entität vom 21.07., und
 * 16 von 37 Dokumenten waren nie extrahiert worden.
 *
 * Liest direkt aus der Datenbank statt über das Support-Backend: der Status
 * soll auch dann stimmen, wenn das Backend gerade neu deployt wird — der
 * "N Aufträge warten"-Fall ist ja genau dann interessant.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

import { authorizeKbRequest } from '@/lib/kb-access'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const knowledgeBaseId = searchParams.get('knowledge_base_id')

    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: 'knowledge_base_id ist erforderlich' },
        { status: 400 }
      )
    }

    const authz = await authorizeKbRequest(request, knowledgeBaseId)
    if (!authz.ok) return authz.response

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase.rpc('graph_kb_status', {
      p_kb_id: knowledgeBaseId,
    })

    if (error) {
      console.error('[graph/status] RPC-Fehler:', error.message)
      return NextResponse.json(
        { error: 'Graph-Status konnte nicht gelesen werden' },
        { status: 500 }
      )
    }

    const s = (Array.isArray(data) ? data[0] : data) ?? {}

    const { data: jobs } = await supabase
      .from('knowledge_graph_jobs')
      .select('id, document_id, reason, status, attempts, last_error, created_at, finished_at')
      .eq('knowledge_base_id', knowledgeBaseId)
      .order('created_at', { ascending: false })
      .limit(20)

    // "Aktuell" heißt: nichts offen, kein Dokument ohne Extraktion, und
    // kein Fakt jünger als die letzte Extraktion.
    const pending = Number(s.documents_pending ?? 0)
    const queued = Number(s.jobs_queued ?? 0)
    const running = Number(s.jobs_running ?? 0)
    const newestFact: string | null = s.newest_fact ?? null
    const lastExtraction: string | null = s.last_extraction ?? null

    const lagsBehind =
      newestFact !== null &&
      (lastExtraction === null || new Date(newestFact) > new Date(lastExtraction))

    const upToDate = pending === 0 && queued === 0 && running === 0 && !lagsBehind

    return NextResponse.json({
      knowledge_base_id: knowledgeBaseId,
      up_to_date: upToDate,
      lags_behind: lagsBehind,
      entities: Number(s.entities ?? 0),
      relations: Number(s.relations ?? 0),
      communities: Number(s.communities ?? 0),
      documents_total: Number(s.documents_total ?? 0),
      documents_pending: pending,
      jobs_queued: queued,
      jobs_running: running,
      jobs_failed: Number(s.jobs_failed ?? 0),
      last_extraction: lastExtraction,
      newest_fact: newestFact,
      last_error: s.last_error ?? null,
      recent_jobs: jobs ?? [],
    })
  } catch (error: any) {
    console.error('[graph/status] Unerwarteter Fehler:', error)
    return NextResponse.json(
      { error: 'Graph-Status Fehler' },
      { status: 500 }
    )
  }
}
