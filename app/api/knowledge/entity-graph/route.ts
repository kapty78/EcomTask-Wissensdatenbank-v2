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

    // Load entities (include community_id for topic-based coloring)
    const { data: entities, error: entitiesError } = await supabase
      .from("knowledge_entities")
      .select("id, name, entity_type, description, mention_count, community_id")
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

    // Load entity-chunk mappings (first chunk per entity for "zum Chunk" navigation)
    const entityIds = new Set(entities.map((e) => e.id))
    const { data: entityChunks } = await supabase
      .from("knowledge_entity_chunks")
      .select("entity_id, chunk_id")
      .in("entity_id", [...entityIds])

    // Build entity → first chunk_id lookup
    const entityChunkMap = new Map<string, string>()
    for (const ec of entityChunks || []) {
      if (!entityChunkMap.has(ec.entity_id)) {
        entityChunkMap.set(ec.entity_id, ec.chunk_id)
      }
    }

    // Load community metadata so the frontend can show theme labels + a
    // stable color per topic group.
    const { data: communityRows } = await supabase
      .from("knowledge_communities")
      .select("community_id, size, theme_summary, top_entities")
      .eq("knowledge_base_id", knowledgeBaseId)
      .order("size", { ascending: false })

    // Deterministic hex color per community via golden-ratio hue spread.
    // Returning hex (not hsl) so the canvas renderer can keep its existing
    // hex → rgb pipeline.
    const GOLDEN = 0.61803398875
    function hslToHex(h: number, s: number, l: number): string {
      // h in [0,360), s/l in [0,100]
      const sN = s / 100, lN = l / 100
      const c = (1 - Math.abs(2 * lN - 1)) * sN
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
      const m = lN - c / 2
      let r = 0, g = 0, b = 0
      if (h < 60) { r = c; g = x; b = 0 }
      else if (h < 120) { r = x; g = c; b = 0 }
      else if (h < 180) { r = 0; g = c; b = x }
      else if (h < 240) { r = 0; g = x; b = c }
      else if (h < 300) { r = x; g = 0; b = c }
      else { r = c; g = 0; b = x }
      const toHex = (v: number) =>
        Math.round((v + m) * 255).toString(16).padStart(2, "0")
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`
    }
    function communityColor(cid: number): string {
      const h = ((cid * GOLDEN) % 1) * 360
      return hslToHex(h, 65, 62)
    }

    const communities = (communityRows || []).map((c) => ({
      id: c.community_id,
      size: c.size,
      theme: c.theme_summary || "",
      topEntities: (c.top_entities || []) as string[],
      color: communityColor(c.community_id),
    }))

    // Map to graph format
    const nodes = entities.map((e) => ({
      id: e.id,
      label: e.name,
      type: e.entity_type,
      description: e.description || "",
      weight: e.mention_count || 1,
      chunkId: entityChunkMap.get(e.id) || null,
      communityId: e.community_id ?? null,
      communityColor: e.community_id != null ? communityColor(e.community_id) : null,
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
      communities,
      stats: {
        entities: nodes.length,
        relations: edges.length,
        communities: communities.length,
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
