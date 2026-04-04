import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const knowledgeBaseId = searchParams.get("knowledge_base_id")

    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: "knowledge_base_id ist erforderlich" },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Load entities
    const { data: entities, error: entitiesError } = await supabase
      .from("knowledge_entities")
      .select("id, name, entity_type, description, mention_count")
      .eq("knowledge_base_id", knowledgeBaseId)
      .order("mention_count", { ascending: false })

    if (entitiesError) {
      return NextResponse.json(
        { error: "Fehler beim Laden der Entities", details: entitiesError.message },
        { status: 500 }
      )
    }

    if (!entities || entities.length === 0) {
      return NextResponse.json({ nodes: [], edges: [], stats: { entities: 0, relations: 0 } })
    }

    // Load relations
    const { data: relations, error: relationsError } = await supabase
      .from("knowledge_relations")
      .select("id, source_entity_id, target_entity_id, relation_type, description, weight")
      .eq("knowledge_base_id", knowledgeBaseId)

    if (relationsError) {
      return NextResponse.json(
        { error: "Fehler beim Laden der Relations", details: relationsError.message },
        { status: 500 }
      )
    }

    // Build entity ID set for filtering orphan edges
    const entityIds = new Set(entities.map((e) => e.id))

    // Map to graph format
    const nodes = entities.map((e) => ({
      id: e.id,
      label: e.name,
      type: e.entity_type,
      description: e.description || "",
      weight: e.mention_count || 1,
    }))

    const edges = (relations || [])
      .filter((r) => entityIds.has(r.source_entity_id) && entityIds.has(r.target_entity_id))
      .map((r) => ({
        id: r.id,
        source: r.source_entity_id,
        target: r.target_entity_id,
        type: r.relation_type,
        label: r.description || r.relation_type,
        weight: r.weight || 1,
      }))

    return NextResponse.json({
      nodes,
      edges,
      stats: {
        entities: nodes.length,
        relations: edges.length,
      },
    })
  } catch (error: any) {
    console.error("[entity-graph] Error:", error)
    return NextResponse.json(
      { error: `Entity-Graph Fehler: ${error.message}` },
      { status: 500 }
    )
  }
}
