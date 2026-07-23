/**
 * Graph einer Wissensdatenbank neu aufbauen.
 * =====================================================================
 * Proxy auf POST /api/v1/knowledge/graph-rebuild im Support-Backend.
 * Sicherheitsmuster wie retrieve-proxy: Session prüfen, KB-Zugriff über
 * RLS belegen, company_id AUSSCHLIESSLICH aus der verifizierten KB-Zeile
 * ziehen (nie aus dem Client-Body), Upstream-Fehler nie verbatim
 * durchreichen.
 *
 * Der Aufruf kehrt sofort zurück — das Backend löscht das maschinell
 * Extrahierte und reiht jedes Dokument als Auftrag ein; die Arbeit macht
 * der Worker. Manuell gepflegte Entitäten und Kanten (origin='manual')
 * überleben den Rebuild.
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
    const purge = body?.purge !== false

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

    // Mandantensicherheit: company_id kommt aus der Datenbank, nicht vom Client.
    const { data: kb, error: kbError } = await supabase
      .from('knowledge_bases')
      .select('company_id')
      .eq('id', knowledgeBaseId)
      .maybeSingle()

    if (kbError || !kb?.company_id) {
      logger.warn('[graph/rebuild] KB ohne company_id, abgelehnt', {
        knowledgeBaseId,
        error: kbError?.message,
      })
      return NextResponse.json(
        { error: 'Knowledge base ist keiner Firma zugeordnet' },
        { status: 403 }
      )
    }

    const upstream = await fetch(
      `${env.SUPPORT_BACKEND_URL}/api/v1/knowledge/graph-rebuild`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.SUPPORT_BACKEND_API_KEY,
        },
        body: JSON.stringify({
          knowledge_base_id: knowledgeBaseId,
          company_id: kb.company_id,
          purge,
        }),
        cache: 'no-store',
      }
    )

    const text = await upstream.text()

    if (!upstream.ok) {
      logger.error('[graph/rebuild] Upstream-Fehler', {
        status: upstream.status,
        body: text.slice(0, 500),
        knowledgeBaseId,
      })
      return NextResponse.json(
        { error: 'Neuaufbau derzeit nicht verfügbar' },
        { status: upstream.status >= 500 ? 502 : 400 }
      )
    }

    try {
      return NextResponse.json(text ? JSON.parse(text) : null, { status: 200 })
    } catch {
      logger.error('[graph/rebuild] Upstream lieferte kein JSON', {
        body: text.slice(0, 200),
      })
      return NextResponse.json(
        { error: 'Neuaufbau lieferte eine ungültige Antwort' },
        { status: 502 }
      )
    }
  } catch (error: any) {
    logger.error('[graph/rebuild] Unerwarteter Fehler', error)
    return NextResponse.json({ error: 'Rebuild-Proxy Fehler' }, { status: 502 })
  }
}
