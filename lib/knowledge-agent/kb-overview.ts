/**
 * KB Overview & Freshness Helper (Feature 005)
 * =====================================================================
 * Turns the knowledge-graph community layer (knowledge_communities +
 * knowledge_entities) into a fast, ranked, noise-filtered, freshness-stamped
 * map of what a knowledge base contains — and, by negative space, what it
 * does NOT (used by the Fragenprompt generator).
 *
 * Reads communities directly from Supabase (same project). The only thing
 * that lives in the backend is the recompute: when the map is stale or
 * missing-but-entitied, we POST /api/v1/knowledge/graph-cluster (force) and
 * reload. Empty-graph KBs fall back to a document list.
 *
 * Tenant isolation is enforced by the caller (assertKbBelongsToCompany in
 * route.ts) before this runs.
 */

export interface OverviewTheme {
  community_id: number
  theme: string
  size: number
  top_entities: string[]
  /** location/meta-dominated cluster (NER artifact) — de-prioritized. */
  incidental: boolean
}

export interface FallbackDocument {
  title: string
  chunk_count: number
}

export interface KbOverview {
  knowledge_base_id: string
  knowledge_base_name: string | null
  /** as-of date of the topic map; null when empty_graph. */
  as_of: string | null
  /** true when the map was stale/missing and a refresh was triggered this call. */
  stale_before_refresh: boolean
  /** true when no entities exist → fallback_documents used instead of themes. */
  empty_graph: boolean
  /** true when more themes exist than were returned (top-N bound). */
  truncated: boolean
  total_communities: number
  entity_type_distribution: Record<string, number>
  themes: OverviewTheme[]
  fallback_documents: FallbackDocument[] | null
  /** non-fatal note (e.g. recluster skipped because backend key missing). */
  warning: string | null
}

export interface BackendConfig {
  url: string
  apiKey: string
}

const STALE_DAYS = 7
const MIN_THEME_SIZE = 2
const LOCATION_INCIDENTAL_FRACTION = 0.6
const ENTITY_SAMPLE_CAP = 2000 // composition sample; exact total counted separately
const COMMUNITY_FETCH_CAP = 500
const FALLBACK_ITEM_CAP = 1000

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(min, Math.min(max, n))
}

function parseTs(ts: string | null | undefined): number {
  if (!ts) return 0
  const ms = Date.parse(ts)
  return Number.isFinite(ms) ? ms : 0
}

function newestTimestamp(rows: Array<{ updated_at?: string | null; generated_at?: string | null }>): string | null {
  let bestMs = 0
  let best: string | null = null
  for (const r of rows) {
    for (const ts of [r.updated_at, r.generated_at]) {
      const ms = parseTs(ts)
      if (ms > bestMs) {
        bestMs = ms
        best = ts ?? null
      }
    }
  }
  return best
}

function isStale(asOf: string | null, days: number): boolean {
  if (!asOf) return false
  const ageMs = Date.now() - parseTs(asOf)
  return ageMs > days * 24 * 60 * 60 * 1000
}

async function countEntities(serviceClient: any, kbId: string): Promise<number> {
  const { count } = await serviceClient
    .from("knowledge_entities")
    .select("id", { count: "exact", head: true })
    .eq("knowledge_base_id", kbId)
  return count ?? 0
}

async function loadEntityComposition(
  serviceClient: any,
  kbId: string
): Promise<{
  distribution: Record<string, number>
  locationFractionByCommunity: Record<number, number>
}> {
  const { data } = await serviceClient
    .from("knowledge_entities")
    .select("entity_type, community_id, mention_count")
    .eq("knowledge_base_id", kbId)
    .order("mention_count", { ascending: false })
    .limit(ENTITY_SAMPLE_CAP)

  const distribution: Record<string, number> = {}
  const perCommunity: Record<number, { total: number; location: number }> = {}

  for (const row of (data as any[]) || []) {
    const type = (row?.entity_type as string) || "unknown"
    distribution[type] = (distribution[type] || 0) + 1

    const cid = row?.community_id
    if (cid != null) {
      const bucket = (perCommunity[cid] ||= { total: 0, location: 0 })
      bucket.total += 1
      if (type === "location") bucket.location += 1
    }
  }

  const locationFractionByCommunity: Record<number, number> = {}
  for (const [cid, b] of Object.entries(perCommunity)) {
    locationFractionByCommunity[Number(cid)] = b.total > 0 ? b.location / b.total : 0
  }

  return { distribution, locationFractionByCommunity }
}

interface CommunityRow {
  community_id: number
  size: number | null
  top_entities: string[] | null
  theme_summary: string | null
  updated_at: string | null
  generated_at: string | null
}

async function loadCommunities(serviceClient: any, kbId: string): Promise<CommunityRow[]> {
  const { data } = await serviceClient
    .from("knowledge_communities")
    .select("community_id, size, top_entities, theme_summary, updated_at, generated_at")
    .eq("knowledge_base_id", kbId)
    .order("size", { ascending: false })
    .limit(COMMUNITY_FETCH_CAP)
  return ((data as CommunityRow[]) || [])
}

async function loadFallbackDocuments(
  serviceClient: any,
  kbId: string,
  maxItems: number
): Promise<{ items: FallbackDocument[]; truncated: boolean }> {
  const { data } = await serviceClient
    .from("knowledge_items")
    .select("source_name")
    .eq("knowledge_base_id", kbId)
    .limit(FALLBACK_ITEM_CAP)

  const counts = new Map<string, number>()
  for (const row of (data as any[]) || []) {
    const title = (row?.source_name as string)?.trim() || "Ohne Quelle"
    counts.set(title, (counts.get(title) || 0) + 1)
  }

  const all = [...counts.entries()]
    .map(([title, chunk_count]) => ({ title, chunk_count }))
    .sort((a, b) => b.chunk_count - a.chunk_count)

  return { items: all.slice(0, maxItems), truncated: all.length > maxItems }
}

async function forceRecluster(
  backend: BackendConfig,
  kbId: string,
  companyId: string | null
): Promise<{ ok: boolean; generated_at: string | null; warning: string | null }> {
  if (!backend.url || !backend.apiKey) {
    return { ok: false, generated_at: null, warning: "Recluster übersprungen: Backend nicht konfiguriert." }
  }
  try {
    const res = await fetch(`${backend.url}/api/v1/knowledge/graph-cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": backend.apiKey },
      body: JSON.stringify({ knowledge_base_id: kbId, company_id: companyId, force: true }),
    })
    const text = await res.text()
    let body: any = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { message: text }
    }
    if (!res.ok || body?.status === "error") {
      return {
        ok: false,
        generated_at: null,
        warning: `Recluster fehlgeschlagen (${res.status}): ${body?.message || "unbekannt"}. Verwende vorhandene Themen-Landkarte.`,
      }
    }
    return { ok: true, generated_at: body?.generated_at ?? null, warning: null }
  } catch (err: any) {
    return {
      ok: false,
      generated_at: null,
      warning: `Recluster nicht erreichbar: ${err?.message || "Netzwerkfehler"}. Verwende vorhandene Themen-Landkarte.`,
    }
  }
}

/**
 * Build the freshness-stamped, noise-filtered KB overview.
 * Caller MUST have verified KB ownership before invoking.
 */
export async function buildKbOverview(opts: {
  serviceClient: any
  knowledgeBaseId: string
  companyId: string | null
  maxThemes?: number
  refresh?: boolean
  backend: BackendConfig
}): Promise<KbOverview> {
  const { serviceClient, knowledgeBaseId, companyId, backend } = opts
  const maxThemes = clampInt(opts.maxThemes, 25, 1, 100)
  const refresh = opts.refresh === true

  const { data: kbRow } = await serviceClient
    .from("knowledge_bases")
    .select("name")
    .eq("id", knowledgeBaseId)
    .maybeSingle()
  const kbName: string | null = kbRow?.name ?? null

  const totalEntities = await countEntities(serviceClient, knowledgeBaseId)

  // ── Empty-graph fallback (FR-003) ──────────────────────────────────────
  if (totalEntities === 0) {
    const docs = await loadFallbackDocuments(serviceClient, knowledgeBaseId, maxThemes)
    return {
      knowledge_base_id: knowledgeBaseId,
      knowledge_base_name: kbName,
      as_of: null,
      stale_before_refresh: false,
      empty_graph: true,
      truncated: docs.truncated,
      total_communities: 0,
      entity_type_distribution: {},
      themes: [],
      fallback_documents: docs.items,
      warning:
        docs.items.length === 0
          ? "Diese Wissensdatenbank ist leer."
          : "Kein Themen-Graph vorhanden — Überblick basiert auf der Dokumentliste. Mit refresh=true einen Graph-Aufbau anstoßen.",
    }
  }

  // ── Load + apply freshness policy (FR-004/FR-013) ──────────────────────
  let communities = await loadCommunities(serviceClient, knowledgeBaseId)
  let asOf = newestTimestamp(communities)
  let staleBeforeRefresh = false
  let warning: string | null = null

  const missingMap = communities.length === 0
  const staleMap = asOf != null && isStale(asOf, STALE_DAYS)
  if (refresh || missingMap || staleMap) {
    staleBeforeRefresh = missingMap || staleMap
    const reclustered = await forceRecluster(backend, knowledgeBaseId, companyId)
    if (reclustered.ok) {
      communities = await loadCommunities(serviceClient, knowledgeBaseId)
      asOf = reclustered.generated_at ?? newestTimestamp(communities)
    } else {
      warning = reclustered.warning
    }
  }

  const composition = await loadEntityComposition(serviceClient, knowledgeBaseId)

  // ── Noise filter + ranking + bounding (FR-002/FR-015) ──────────────────
  const significant = communities.filter((c) => (c.size ?? 0) >= MIN_THEME_SIZE)
  const themesAll: OverviewTheme[] = significant.map((c) => ({
    community_id: c.community_id,
    theme: c.theme_summary || "(ohne Thema)",
    size: c.size ?? 0,
    top_entities: c.top_entities ?? [],
    incidental: (composition.locationFractionByCommunity[c.community_id] ?? 0) >= LOCATION_INCIDENTAL_FRACTION,
  }))

  // substantive themes first, then by size desc
  themesAll.sort((a, b) => Number(a.incidental) - Number(b.incidental) || b.size - a.size)

  const truncated = themesAll.length > maxThemes
  const themes = themesAll.slice(0, maxThemes)

  return {
    knowledge_base_id: knowledgeBaseId,
    knowledge_base_name: kbName,
    as_of: asOf,
    stale_before_refresh: staleBeforeRefresh,
    empty_graph: false,
    truncated,
    total_communities: significant.length,
    entity_type_distribution: composition.distribution,
    themes,
    fallback_documents: null,
    warning,
  }
}
