"use client"

/**
 * Graph-Tester: Frage stellen und sehen, welche Verbindungen greifen.
 * =====================================================================
 * Der Graph-Kanal war bisher eine Blackbox — er liefert am Ende nur
 * Chunks, und ob die über eine belegte oder eine geratene Kante gefunden
 * wurden, sah man nicht. Bei einer falschen Antwort ließ sich deshalb
 * nicht sagen, ob der Graph nichts gefunden hat, das Falsche gefunden hat
 * oder ob seine Treffer erst nachgelagert weggefiltert wurden.
 *
 * Dieses Panel führt denselben Lauf wie der Produktivpfad aus und zeigt
 * jede Zwischenstufe. Die getroffenen Entitäten werden zusätzlich über
 * `onHighlight` in der Kugel hervorgehoben — dafür wird der vorhandene
 * Suchfilter wiederverwendet, keine zweite Highlight-Mechanik.
 */
import { useState } from "react"
import { Loader2, Search, X } from "lucide-react"

import { apiFetch } from "@/lib/api-fetch"

interface MatchedEntity {
  entity_id: string
  name: string
  type: string
  similarity: number
  community_theme?: string | null
  mention_count?: number | null
}

interface TraversalEdge {
  from: string
  to: string
  relation_type: string
  description: string | null
  confidence: string | null
  origin: string | null
  weight: number
}

interface ProbeChunk {
  chunk_id: string
  source_name: string | null
  content: string
  via_entity: string | null
  relation_type: string | null
  hop: number
  score: number
}

interface ProbeResult {
  query: string
  matched_entities: MatchedEntity[]
  traversal: TraversalEdge[]
  chunks: ProbeChunk[]
  diagnostics: Record<string, any>
  notes: string[]
  verdict: string
}

interface Props {
  knowledgeBaseId: string
  onClose: () => void
  /** Hebt die getroffenen Entitäten in der Kugel hervor (null = Filter aus). */
  onHighlight?: (entityNames: string[] | null) => void
}

/**
 * extracted = direkt aus dem Text belegt
 * inferred  = über Chunks hinweg geraten (weight 0.8)
 * ambiguous = über Dokumente hinweg geraten (weight 0.6)
 */
const CONFIDENCE_LABEL: Record<string, string> = {
  extracted: "belegt",
  inferred: "abgeleitet",
  ambiguous: "geraten",
}

export default function GraphProbePanel({ knowledgeBaseId, onClose, onHighlight }: Props) {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    const q = query.trim()
    if (!q || loading) return

    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/knowledge/graph/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledge_base_id: knowledgeBaseId, query: q }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || "Test fehlgeschlagen")
        setResult(null)
        onHighlight?.(null)
        return
      }
      setResult(data)
      onHighlight?.(data.matched_entities.map((e: MatchedEntity) => e.name))
    } catch {
      setError("Test fehlgeschlagen")
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const close = () => {
    onHighlight?.(null)
    onClose()
  }

  const conf = (result?.diagnostics?.confidence_breakdown ?? {}) as Record<string, number>
  const guessed = (conf.inferred ?? 0) + (conf.ambiguous ?? 0)
  const totalEdges = result?.traversal.length ?? 0

  return (
    <div className="flex flex-col gap-2 w-[320px] max-h-[calc(100vh-160px)] bg-[#1e1e1e]/92 backdrop-blur-sm border border-white/[0.08] rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span className="text-[11px] font-medium text-white/70">Graph testen</span>
        <div className="flex-1" />
        <button
          onClick={close}
          className="text-white/25 hover:text-white/60 transition-colors"
          title="Schließen"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="px-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-white/30 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Frage wie von einem Kunden…"
            className="w-full bg-[#161616] border border-white/[0.07] rounded-lg pl-7 pr-8 py-2 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-primary/40 transition-colors"
          />
          {loading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3 text-primary animate-spin" />
          )}
        </div>
      </div>

      {error && <div className="px-3 text-[10px] text-red-400/80">{error}</div>}

      {result && (
        <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-3">
          {/* Kurzfazit */}
          <div className="text-[10px] text-white/45 leading-relaxed border-l-2 border-primary/40 pl-2">
            {result.verdict}
          </div>

          {/* Was schiefging — das ist der eigentliche Wert des Testers */}
          {result.notes.length > 0 && (
            <div className="flex flex-col gap-1">
              {result.notes.map((n, i) => (
                <div key={i} className="text-[10px] text-amber-300/70 leading-relaxed">
                  {n}
                </div>
              ))}
            </div>
          )}

          {/* Getroffene Entitäten */}
          {result.matched_entities.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">
                Getroffene Entitäten
              </div>
              <div className="flex flex-col gap-1">
                {result.matched_entities.map((e) => (
                  <div key={e.entity_id} className="flex items-baseline gap-2">
                    <span className="text-[11px] text-white/75 truncate">{e.name}</span>
                    <span className="text-[9px] text-white/25 flex-shrink-0">{e.type}</span>
                    <div className="flex-1" />
                    <span className="text-[10px] text-primary/80 tabular-nums flex-shrink-0">
                      {e.similarity.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Kantenqualität */}
          {totalEdges > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">
                Kanten ab hier ({totalEdges})
              </div>
              <div className="flex gap-3 text-[10px]">
                {(["extracted", "inferred", "ambiguous"] as const).map((tag) => (
                  <span key={tag} className="text-white/40">
                    {CONFIDENCE_LABEL[tag]}{" "}
                    <span className="text-white/70 tabular-nums">{conf[tag] ?? 0}</span>
                  </span>
                ))}
              </div>
              {guessed / Math.max(1, totalEdges) > 0.3 && (
                <div className="text-[9px] text-white/30 mt-1 leading-relaxed">
                  Über die Hälfte des Wegs führt über nicht belegte Kanten — hier lohnt
                  sich eine eigene Verknüpfung.
                </div>
              )}
            </div>
          )}

          {/* Gefundene Inhalte */}
          {result.chunks.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-white/25 mb-1">
                Gefundene Inhalte ({result.chunks.length})
              </div>
              <div className="flex flex-col gap-1.5">
                {result.chunks.slice(0, 8).map((c) => (
                  <div
                    key={c.chunk_id}
                    className="bg-[#161616] border border-white/[0.05] rounded-md px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[9px] text-white/30 truncate flex-1">
                        {c.source_name || "ohne Quelle"}
                      </span>
                      <span className="text-[9px] text-white/25 flex-shrink-0">
                        {c.hop === 0 ? "direkt" : `${c.hop} Hop`}
                      </span>
                      <span className="text-[9px] text-primary/70 tabular-nums flex-shrink-0">
                        {c.score.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-[10px] text-white/50 line-clamp-2 leading-relaxed">
                      {c.content}
                    </div>
                    {c.via_entity && (
                      <div className="text-[9px] text-white/25 mt-0.5">
                        über {c.via_entity}
                        {c.relation_type ? ` · ${c.relation_type}` : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
