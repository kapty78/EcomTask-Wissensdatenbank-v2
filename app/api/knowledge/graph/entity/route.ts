/**
 * Entitäten des Knowledge Graph von Hand pflegen.
 * =====================================================================
 * POST   — neue Entität anlegen
 * PATCH  — Name / Typ / Beschreibung ändern
 * DELETE — Entität entfernen (samt ihrer Kanten, per ON DELETE CASCADE)
 *
 * Alles, was hier entsteht oder angefasst wird, bekommt origin='manual'.
 * Das ist der Vertrag mit dem Nutzer: der Extraktor überschreibt solche
 * Zeilen nie, der Prune-Lauf löscht sie nie, und der komplette Neuaufbau
 * lässt sie stehen. Wer sich die Mühe macht, eine Verknüpfung selbst zu
 * setzen, soll sie nicht beim nächsten Upload wieder verlieren.
 *
 * Nach jeder Änderung wird das Embedding verworfen (der Extraktor erzeugt
 * es beim nächsten Lauf neu — ohne Embedding findet match_graph_entities
 * die Entität nicht) und ein Auftrag für das Re-Clustering eingereiht.
 */
import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

import { authorizeKbRequest } from "@/lib/kb-access"
import { enqueueGraphJob } from "@/lib/knowledge-base/graph-enqueue"
import { logger } from "@/lib/utils/logger"

export const dynamic = "force-dynamic"

/** Muss zu VALID_ENTITY_TYPES in graph_service.py passen. */
const VALID_ENTITY_TYPES = new Set([
  "person", "organization", "location", "role", "feature", "rule",
  "step", "spec", "contact", "definition", "process", "product",
])

/**
 * Muss zu _normalize_name() in graph_service.py passen — sonst legt das UI
 * einen Knoten an, den der Extraktor beim nächsten Lauf als neuen Begriff
 * behandelt, und die Dublette ist wieder da.
 */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-–—/_.,;:()"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Liest die KB einer Entität und prüft, dass der Aufrufer sie sehen darf. */
async function authorizeEntity(request: NextRequest, entityId: string) {
  const supabase = admin()
  const { data: entity } = await supabase
    .from("knowledge_entities")
    .select("id, knowledge_base_id, company_id, origin")
    .eq("id", entityId)
    .maybeSingle()

  if (!entity) {
    return { ok: false as const, response: NextResponse.json({ error: "Entität nicht gefunden" }, { status: 404 }) }
  }
  const authz = await authorizeKbRequest(request, entity.knowledge_base_id)
  if (!authz.ok) return { ok: false as const, response: authz.response }
  return { ok: true as const, entity, supabase }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const knowledgeBaseId = typeof body?.knowledge_base_id === "string" ? body.knowledge_base_id : null
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const entityType = typeof body?.entity_type === "string" ? body.entity_type : ""
    const description = typeof body?.description === "string" ? body.description.trim() : ""

    if (!knowledgeBaseId || !name || !VALID_ENTITY_TYPES.has(entityType)) {
      return NextResponse.json(
        { error: "knowledge_base_id, name und ein gültiger entity_type sind erforderlich" },
        { status: 400 }
      )
    }

    const authz = await authorizeKbRequest(request, knowledgeBaseId)
    if (!authz.ok) return authz.response

    const supabase = admin()
    const { data: kb } = await supabase
      .from("knowledge_bases")
      .select("company_id")
      .eq("id", knowledgeBaseId)
      .maybeSingle()

    if (!kb?.company_id) {
      return NextResponse.json({ error: "Knowledge base ist keiner Firma zugeordnet" }, { status: 403 })
    }

    const nameNormalized = normalizeName(name)
    if (!nameNormalized) {
      return NextResponse.json({ error: "Name enthält keine verwertbaren Zeichen" }, { status: 400 })
    }

    // Gibt es den Begriff schon? Dann keine Dublette anlegen, sondern die
    // vorhandene Entität zurückgeben — sonst baut das UI genau das Problem
    // wieder auf, das die Zusammenführung gerade behoben hat.
    const { data: existing } = await supabase
      .from("knowledge_entities")
      .select("id, name, entity_type")
      .eq("knowledge_base_id", knowledgeBaseId)
      .eq("name_normalized", nameNormalized)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { entity: existing, already_existed: true },
        { status: 200 }
      )
    }

    const { data: created, error } = await supabase
      .from("knowledge_entities")
      .insert({
        company_id: kb.company_id,
        knowledge_base_id: knowledgeBaseId,
        name,
        name_normalized: nameNormalized,
        entity_type: entityType,
        description,
        origin: "manual",
        edited_by: authz.auth?.user?.id ?? null,
      })
      .select("id, name, entity_type, description, origin")
      .single()

    if (error) {
      logger.error("[graph/entity] Anlegen fehlgeschlagen", error.message)
      return NextResponse.json({ error: "Entität konnte nicht angelegt werden" }, { status: 500 })
    }

    await enqueueGraphJob({ companyId: kb.company_id, knowledgeBaseId }, "manual")
    return NextResponse.json({ entity: created }, { status: 201 })
  } catch (error: any) {
    logger.error("[graph/entity] POST unerwarteter Fehler", error)
    return NextResponse.json({ error: "Entität konnte nicht angelegt werden" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const entityId = typeof body?.entity_id === "string" ? body.entity_id : null
    if (!entityId) {
      return NextResponse.json({ error: "entity_id ist erforderlich" }, { status: 400 })
    }

    const guard = await authorizeEntity(request, entityId)
    if (!guard.ok) return guard.response
    const { entity, supabase } = guard

    const patch: Record<string, unknown> = {
      // Ab jetzt gepflegt: der Extraktor lässt die Zeile in Ruhe.
      origin: "manual",
      updated_at: new Date().toISOString(),
    }

    if (typeof body.name === "string" && body.name.trim()) {
      const name = body.name.trim()
      const nameNormalized = normalizeName(name)
      if (!nameNormalized) {
        return NextResponse.json({ error: "Name enthält keine verwertbaren Zeichen" }, { status: 400 })
      }
      // Kollisionsprüfung: der neue Name darf nicht schon vergeben sein,
      // sonst schlägt der UNIQUE-Index zu. Zum Verschmelzen gibt es
      // /api/knowledge/graph/merge.
      const { data: clash } = await supabase
        .from("knowledge_entities")
        .select("id")
        .eq("knowledge_base_id", entity.knowledge_base_id)
        .eq("name_normalized", nameNormalized)
        .neq("id", entityId)
        .maybeSingle()

      if (clash) {
        return NextResponse.json(
          {
            error: "Unter diesem Namen gibt es bereits eine Entität. Zum Verbinden bitte zusammenführen.",
            conflicting_entity_id: clash.id,
          },
          { status: 409 }
        )
      }
      patch.name = name
      patch.name_normalized = nameNormalized
      // Der Name bestimmt das Embedding — neu erzeugen lassen, sonst
      // findet die Suche den Knoten weiter unter dem alten Begriff.
      patch.embedding = null
    }

    if (typeof body.entity_type === "string") {
      if (!VALID_ENTITY_TYPES.has(body.entity_type)) {
        return NextResponse.json({ error: "Unbekannter entity_type" }, { status: 400 })
      }
      patch.entity_type = body.entity_type
    }

    if (typeof body.description === "string") {
      patch.description = body.description.trim()
      patch.embedding = null
    }

    const { data: updated, error } = await supabase
      .from("knowledge_entities")
      .update(patch)
      .eq("id", entityId)
      .select("id, name, entity_type, description, origin")
      .single()

    if (error) {
      logger.error("[graph/entity] Änderung fehlgeschlagen", error.message)
      return NextResponse.json({ error: "Entität konnte nicht geändert werden" }, { status: 500 })
    }

    await enqueueGraphJob(
      { companyId: entity.company_id, knowledgeBaseId: entity.knowledge_base_id },
      "manual"
    )
    return NextResponse.json({ entity: updated })
  } catch (error: any) {
    logger.error("[graph/entity] PATCH unerwarteter Fehler", error)
    return NextResponse.json({ error: "Entität konnte nicht geändert werden" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const entityId = typeof body?.entity_id === "string" ? body.entity_id : null
    if (!entityId) {
      return NextResponse.json({ error: "entity_id ist erforderlich" }, { status: 400 })
    }

    const guard = await authorizeEntity(request, entityId)
    if (!guard.ok) return guard.response
    const { entity, supabase } = guard

    // Kanten und Anker hängen an ON DELETE CASCADE.
    const { error } = await supabase.from("knowledge_entities").delete().eq("id", entityId)
    if (error) {
      logger.error("[graph/entity] Löschen fehlgeschlagen", error.message)
      return NextResponse.json({ error: "Entität konnte nicht gelöscht werden" }, { status: 500 })
    }

    await enqueueGraphJob(
      { companyId: entity.company_id, knowledgeBaseId: entity.knowledge_base_id },
      "manual"
    )
    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error("[graph/entity] DELETE unerwarteter Fehler", error)
    return NextResponse.json({ error: "Entität konnte nicht gelöscht werden" }, { status: 500 })
  }
}
