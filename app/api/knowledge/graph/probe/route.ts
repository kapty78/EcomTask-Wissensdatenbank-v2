/**
 * Graph-Tester: Frage gegen den Knowledge Graph stellen.
 * =====================================================================
 * Proxy auf POST /api/v1/knowledge/graph-probe im Support-Backend.
 * Sicherheitsmuster wie retrieve-proxy: Session prüfen, KB-Zugriff über
 * RLS belegen, company_id AUSSCHLIESSLICH aus der verifizierten KB-Zeile
 * (nie aus dem Client-Body), Upstream-Fehler nie verbatim durchreichen.
 *
 * Der Backend-Lauf macht dieselben zwei RPCs wie der Produktivpfad,
 * protokolliert aber jede Zwischenstufe: getroffene Entitäten mit
 * Similarity, ausgehende Kanten mit Typ/Confidence/Herkunft, die
 * erreichten Chunks — und explizit, was NICHT geklappt hat.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

import { env } from '@/lib/env'
import { authorizeKbRequest } from '@/lib/kb-access'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const knowledgeBaseId =
      typeof body?.knowledge_base_id === 'string' ? body.knowledge_base_id : null
    const query = typeof body?.query === 'string' ? body.query.trim() : ''

    if (!knowledgeBaseId || !query) {
      return NextResponse.json(
        { error: 'knowledge_base_id und query sind erforderlich' },
        { status: 400 }
      )
    }

    const authz = await authorizeKbRequest(request, knowledgeBaseId)
    if (!authz.ok) return authz.response

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: kb, error: kbError } = await supabase
      .from('knowledge_bases')
      .select('company_id')
      .eq('id', knowledgeBaseId)
      .maybeSingle()

    if (kbError || !kb?.company_id) {
      logger.warn('[graph/probe] KB ohne company_id, abgelehnt', {
        knowledgeBaseId,
        error: kbError?.message,
      })
      return NextResponse.json(
        { error: 'Knowledge base ist keiner Firma zugeordnet' },
        { status: 403 }
      )
    }

    const upstream = await fetch(
      `${env.SUPPORT_BACKEND_URL}/api/v1/knowledge/graph-probe`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.SUPPORT_BACKEND_API_KEY,
        },
        body: JSON.stringify({
          knowledge_base_id: knowledgeBaseId,
          company_id: kb.company_id,
          query,
          // Regler aus dem UI, mit den Produktivwerten als Vorgabe.
          match_count: Number(body?.match_count) || 5,
          similarity_threshold: Number(body?.similarity_threshold) || 0.5,
          max_hops: Number(body?.max_hops) || 2,
          max_results: Number(body?.max_results) || 20,
        }),
        cache: 'no-store',
      }
    )

    const text = await upstream.text()

    if (!upstream.ok) {
      logger.error('[graph/probe] Upstream-Fehler', {
        status: upstream.status,
        body: text.slice(0, 500),
        knowledgeBaseId,
      })
      return NextResponse.json(
        { error: 'Graph-Test derzeit nicht verfügbar' },
        { status: upstream.status >= 500 ? 502 : 400 }
      )
    }

    try {
      return NextResponse.json(text ? JSON.parse(text) : null, { status: 200 })
    } catch {
      logger.error('[graph/probe] Upstream lieferte kein JSON', {
        body: text.slice(0, 200),
      })
      return NextResponse.json(
        { error: 'Graph-Test lieferte eine ungültige Antwort' },
        { status: 502 }
      )
    }
  } catch (error: any) {
    logger.error('[graph/probe] Unerwarteter Fehler', error)
    return NextResponse.json({ error: 'Probe-Proxy Fehler' }, { status: 502 })
  }
}
