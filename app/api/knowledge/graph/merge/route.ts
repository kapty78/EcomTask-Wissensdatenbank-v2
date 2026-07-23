/**
 * Zwei Entitäten zu einer zusammenführen.
 * =====================================================================
 * Der Extraktor erzeugt trotz aller Normalisierung weiterhin Varianten
 * desselben Begriffs ("Gutschein" / "Gutscheincode" / "Gutschein-Code").
 * Jede Variante trägt eigene Kanten, also erreicht die Traversierung von
 * einer aus nur einen Teil der Nachbarschaft. Hier kann der Nutzer das
 * von Hand richtigstellen.
 *
 * Die eigentliche Arbeit macht die SQL-Funktion merge_knowledge_entities:
 * Kanten und Anker umhängen, Erwähnungen addieren, den aufgegebenen Typ
 * als Nebentyp behalten, Kollisionen und Selbstschleifen vorher wegräumen.
 * Ist eine der beiden manuell gepflegt, bleibt das Ergebnis manuell und
 * überlebt jeden Neuaufbau.
 */
import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

import { authorizeKbRequest } from "@/lib/kb-access"
import { enqueueGraphJob } from "@/lib/knowledge-base/graph-enqueue"
import { logger } from "@/lib/utils/logger"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const keepId = typeof body?.keep_entity_id === "string" ? body.keep_entity_id : null
    const dropId = typeof body?.drop_entity_id === "string" ? body.drop_entity_id : null

    if (!keepId || !dropId) {
      return NextResponse.json(
        { error: "keep_entity_id und drop_entity_id sind erforderlich" },
        { status: 400 }
      )
    }
    if (keepId === dropId) {
      return NextResponse.json(
        { error: "Eine Entität kann nicht mit sich selbst zusammengeführt werden" },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: both } = await supabase
      .from("knowledge_entities")
      .select("id, name, knowledge_base_id, company_id")
      .in("id", [keepId, dropId])

    if (!both || both.length !== 2) {
      return NextResponse.json({ error: "Entität nicht gefunden" }, { status: 404 })
    }
    if (both[0].knowledge_base_id !== both[1].knowledge_base_id) {
      return NextResponse.json(
        { error: "Beide Entitäten müssen zur selben Wissensdatenbank gehören" },
        { status: 400 }
      )
    }

    const knowledgeBaseId = both[0].knowledge_base_id
    const authz = await authorizeKbRequest(request, knowledgeBaseId)
    if (!authz.ok) return authz.response

    const { data: result, error } = await supabase.rpc("merge_knowledge_entities", {
      p_keep: keepId,
      p_drop: dropId,
    })

    if (error) {
      logger.error("[graph/merge] RPC fehlgeschlagen", error.message)
      return NextResponse.json({ error: "Zusammenführen fehlgeschlagen" }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Das Embedding der behaltenen Entität hat die RPC verworfen — sie steht
    // jetzt für mehr als vorher. Der Auftrag erzeugt es neu und clustert nach.
    await enqueueGraphJob({ companyId: both[0].company_id, knowledgeBaseId }, "manual")

    return NextResponse.json({ result })
  } catch (error: any) {
    logger.error("[graph/merge] Unerwarteter Fehler", error)
    return NextResponse.json({ error: "Zusammenführen fehlgeschlagen" }, { status: 500 })
  }
}
