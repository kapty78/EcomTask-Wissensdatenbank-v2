/**
 * Verknüpfungen im Knowledge Graph von Hand ziehen und lösen.
 * =====================================================================
 * POST   — Kante zwischen zwei Entitäten anlegen
 * DELETE — Kante entfernen
 *
 * Manuelle Kanten bekommen origin='manual', confidence 'extracted' und
 * weight 1.0: sie sind die bestbelegte Sorte, die es gibt — ein Mensch hat
 * sie gesetzt. Der Extraktor überschreibt sie nie, der Neuaufbau lässt sie
 * stehen, und in der Traversierung ranken sie vor allem Geratenen.
 */
import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

import { authorizeKbRequest } from "@/lib/kb-access"
import { enqueueGraphJob } from "@/lib/knowledge-base/graph-enqueue"
import { logger } from "@/lib/utils/logger"

export const dynamic = "force-dynamic"

/** Muss zu VALID_RELATION_TYPES in graph_service.py passen. */
const VALID_RELATION_TYPES = new Set([
  "manages", "belongs_to", "requires", "produces", "located_at",
  "part_of", "follows", "related_to", "responsible_for", "uses", "defines",
])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const sourceId = typeof body?.source_entity_id === "string" ? body.source_entity_id : null
    const targetId = typeof body?.target_entity_id === "string" ? body.target_entity_id : null
    const relationType = typeof body?.relation_type === "string" ? body.relation_type : ""
    const description = typeof body?.description === "string" ? body.description.trim() : ""

    if (!sourceId || !targetId || !VALID_RELATION_TYPES.has(relationType)) {
      return NextResponse.json(
        { error: "source_entity_id, target_entity_id und ein gültiger relation_type sind erforderlich" },
        { status: 400 }
      )
    }
    if (sourceId === targetId) {
      return NextResponse.json(
        { error: "Eine Entität kann nicht mit sich selbst verknüpft werden" },
        { status: 400 }
      )
    }

    const supabase = admin()
    const { data: ends } = await supabase
      .from("knowledge_entities")
      .select("id, knowledge_base_id, company_id")
      .in("id", [sourceId, targetId])

    if (!ends || ends.length !== 2) {
      return NextResponse.json({ error: "Entität nicht gefunden" }, { status: 404 })
    }
    // Beide Enden müssen in derselben Wissensdatenbank liegen — sonst
    // entstünde eine Kante quer über Mandanten hinweg.
    if (ends[0].knowledge_base_id !== ends[1].knowledge_base_id) {
      return NextResponse.json(
        { error: "Beide Entitäten müssen zur selben Wissensdatenbank gehören" },
        { status: 400 }
      )
    }

    const knowledgeBaseId = ends[0].knowledge_base_id
    const authz = await authorizeKbRequest(request, knowledgeBaseId)
    if (!authz.ok) return authz.response

    const { data: created, error } = await supabase
      .from("knowledge_relations")
      .upsert(
        {
          company_id: ends[0].company_id,
          knowledge_base_id: knowledgeBaseId,
          source_entity_id: sourceId,
          target_entity_id: targetId,
          relation_type: relationType,
          description,
          weight: 1.0,
          // Von einem Menschen gesetzt — das ist die bestbelegte Kante,
          // die es geben kann.
          confidence_tag: "extracted",
          origin: "manual",
          edited_by: authz.auth?.user?.id ?? null,
        },
        { onConflict: "source_entity_id,target_entity_id,relation_type" }
      )
      .select("id, source_entity_id, target_entity_id, relation_type, description, origin")
      .single()

    if (error) {
      logger.error("[graph/relation] Anlegen fehlgeschlagen", error.message)
      return NextResponse.json({ error: "Verknüpfung konnte nicht angelegt werden" }, { status: 500 })
    }

    await enqueueGraphJob({ companyId: ends[0].company_id, knowledgeBaseId }, "manual")
    return NextResponse.json({ relation: created }, { status: 201 })
  } catch (error: any) {
    logger.error("[graph/relation] POST unerwarteter Fehler", error)
    return NextResponse.json({ error: "Verknüpfung konnte nicht angelegt werden" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const relationId = typeof body?.relation_id === "string" ? body.relation_id : null
    if (!relationId) {
      return NextResponse.json({ error: "relation_id ist erforderlich" }, { status: 400 })
    }

    const supabase = admin()
    const { data: relation } = await supabase
      .from("knowledge_relations")
      .select("id, knowledge_base_id, company_id")
      .eq("id", relationId)
      .maybeSingle()

    if (!relation) {
      return NextResponse.json({ error: "Verknüpfung nicht gefunden" }, { status: 404 })
    }

    const authz = await authorizeKbRequest(request, relation.knowledge_base_id)
    if (!authz.ok) return authz.response

    const { error } = await supabase.from("knowledge_relations").delete().eq("id", relationId)
    if (error) {
      logger.error("[graph/relation] Löschen fehlgeschlagen", error.message)
      return NextResponse.json({ error: "Verknüpfung konnte nicht gelöscht werden" }, { status: 500 })
    }

    await enqueueGraphJob(
      { companyId: relation.company_id, knowledgeBaseId: relation.knowledge_base_id },
      "manual"
    )
    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error("[graph/relation] DELETE unerwarteter Fehler", error)
    return NextResponse.json({ error: "Verknüpfung konnte nicht gelöscht werden" }, { status: 500 })
  }
}
