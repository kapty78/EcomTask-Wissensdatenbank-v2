"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  SimulationNodeDatum,
  SimulationLinkDatum,
} from "d3-force"
import { Loader2, ZoomIn, ZoomOut, Maximize2, X } from "lucide-react"

// --- Types ---

interface GraphNode extends SimulationNodeDatum {
  id: string
  label: string
  type: string
  description: string
  weight: number
}

interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  id: string
  type: string
  label: string
  weight: number
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: { entities: number; relations: number }
}

// --- Color mapping (Wissensdatenbank design tokens) ---

const TYPE_COLORS: Record<string, string> = {
  person: "#ff55c9",
  organization: "#b38bff",
  product: "#5eadff",
  process: "#4dd6a5",
  location: "#f0a56e",
  role: "#e8c95a",
  feature: "#5ec6d4",
  rule: "#e87474",
  step: "#8dd45e",
  spec: "#8b8fff",
  contact: "#d87ef5",
  definition: "#7a8494",
}

const TYPE_LABELS: Record<string, string> = {
  person: "Person",
  organization: "Organisation",
  product: "Produkt",
  process: "Prozess",
  location: "Ort",
  role: "Rolle",
  feature: "Feature",
  rule: "Regel",
  step: "Schritt",
  spec: "Spezifikation",
  contact: "Kontakt",
  definition: "Definition",
}

function getColor(type: string): string {
  return TYPE_COLORS[type] || "#7a8494"
}

function getNodeRadius(weight: number): number {
  return Math.max(5, Math.min(18, 3 + (weight || 1) * 2.5))
}

// --- Component ---

interface KnowledgeGraphViewProps {
  knowledgeBaseId: string
  onClose: () => void
}

export default function KnowledgeGraphView({ knowledgeBaseId, onClose }: KnowledgeGraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number>(0)

  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Use refs for interactive state to avoid re-creating the simulation
  const hoveredNodeRef = useRef<GraphNode | null>(null)
  const selectedNodeRef = useRef<GraphNode | null>(null)
  const tooltipRef = useRef<{ x: number; y: number; node: GraphNode | null }>({ x: 0, y: 0, node: null })

  // State only for React UI (detail panel + tooltip)
  const [selectedNodeUI, setSelectedNodeUI] = useState<GraphNode | null>(null)
  const [tooltipUI, setTooltipUI] = useState<{ x: number; y: number; node: GraphNode | null }>({ x: 0, y: 0, node: null })

  // Transform + drag state
  const transformRef = useRef({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef<{ active: boolean; node: GraphNode | null; moved: boolean }>({
    active: false, node: null, moved: false,
  })
  const panRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false, lastX: 0, lastY: 0,
  })

  // Keep refs to simulation data
  const nodesRef = useRef<GraphNode[]>([])
  const edgesRef = useRef<GraphEdge[]>([])
  const simRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null)
  const widthRef = useRef(0)
  const heightRef = useRef(0)

  // Load data
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/knowledge/entity-graph?knowledge_base_id=${knowledgeBaseId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: GraphData = await res.json()
        if (!cancelled) setGraphData(data)
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [knowledgeBaseId])

  // Hit-test
  const findNodeAt = useCallback((mx: number, my: number): GraphNode | null => {
    const t = transformRef.current
    const nodes = nodesRef.current
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (n.x == null || n.y == null) continue
      const sx = n.x * t.scale + t.x
      const sy = n.y * t.scale + t.y
      const r = (getNodeRadius(n.weight) + 4) * t.scale
      const dx = mx - sx, dy = my - sy
      if (dx * dx + dy * dy <= r * r) return n
    }
    return null
  }, [])

  // Setup simulation + render loop (only depends on graphData)
  useEffect(() => {
    if (!graphData || !canvasRef.current || !containerRef.current) return
    if (graphData.nodes.length === 0) return

    const canvas = canvasRef.current
    const container = containerRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Size
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = rect.width
    const h = rect.height
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    widthRef.current = w
    heightRef.current = h

    // Clone data for d3 mutation
    const nodes: GraphNode[] = graphData.nodes.map((n) => ({ ...n }))
    const edges: GraphEdge[] = graphData.edges.map((e) => ({ ...e }))
    nodesRef.current = nodes
    edgesRef.current = edges

    // Center transform
    transformRef.current = { x: w / 2, y: h / 2, scale: 1 }

    // Build edge lookup for fast "isConnected" checks
    const edgeIndex = new Map<string, Set<string>>()
    for (const e of graphData.edges) {
      const s = typeof e.source === "string" ? e.source : (e.source as any).id
      const t = typeof e.target === "string" ? e.target : (e.target as any).id
      if (!edgeIndex.has(s)) edgeIndex.set(s, new Set())
      if (!edgeIndex.has(t)) edgeIndex.set(t, new Set())
      edgeIndex.get(s)!.add(t)
      edgeIndex.get(t)!.add(s)
    }

    // Force simulation — stronger repulsion, spread out nicely
    const sim = forceSimulation(nodes)
      .force("link", forceLink<GraphNode, GraphEdge>(edges).id((d) => d.id).distance(140).strength(0.3))
      .force("charge", forceManyBody().strength(-500).distanceMax(600))
      .force("center", forceCenter(0, 0).strength(0.05))
      .force("collide", forceCollide<GraphNode>().radius((d) => getNodeRadius(d.weight) + 12).strength(0.7))
      .force("x", forceX(0).strength(0.03))
      .force("y", forceY(0).strength(0.03))
      .alphaDecay(0.025)
      .velocityDecay(0.4)

    simRef.current = sim

    // --- Render ---
    function draw() {
      const t = transformRef.current
      const selected = selectedNodeRef.current
      const hovered = hoveredNodeRef.current

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, w, h)

      // Background
      ctx!.fillStyle = "#1a1a1a"
      ctx!.fillRect(0, 0, w, h)

      // Grid
      ctx!.strokeStyle = "rgba(255,255,255,0.025)"
      ctx!.lineWidth = 1
      const gs = 50 * t.scale
      if (gs > 8) {
        const ox = t.x % gs, oy = t.y % gs
        ctx!.beginPath()
        for (let x = ox; x < w; x += gs) { ctx!.moveTo(x, 0); ctx!.lineTo(x, h) }
        for (let y = oy; y < h; y += gs) { ctx!.moveTo(0, y); ctx!.lineTo(w, y) }
        ctx!.stroke()
      }

      // --- Edges ---
      for (const edge of edges) {
        const src = edge.source as GraphNode
        const tgt = edge.target as GraphNode
        if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue

        const sx = src.x * t.scale + t.x
        const sy = src.y * t.scale + t.y
        const tx = tgt.x * t.scale + t.x
        const ty = tgt.y * t.scale + t.y

        const highlighted = selected && (src.id === selected.id || tgt.id === selected.id)

        ctx!.beginPath()
        ctx!.moveTo(sx, sy)
        ctx!.lineTo(tx, ty)
        ctx!.strokeStyle = highlighted ? "rgba(255,85,201,0.35)" : "rgba(255,255,255,0.05)"
        ctx!.lineWidth = highlighted ? 1.5 * t.scale : 0.5 * t.scale
        ctx!.stroke()

        // Edge label
        if (highlighted && t.scale > 0.6) {
          const mx = (sx + tx) / 2, my = (sy + ty) / 2
          ctx!.font = `${Math.max(8, 9 * t.scale)}px Inter, system-ui, sans-serif`
          ctx!.textAlign = "center"
          ctx!.fillStyle = "rgba(255,85,201,0.35)"
          ctx!.fillText(edge.type, mx, my - 3 * t.scale)
        }
      }

      // --- Nodes ---
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue

        const nx = node.x * t.scale + t.x
        const ny = node.y * t.scale + t.y

        // Cull off-screen
        if (nx < -50 || nx > w + 50 || ny < -50 || ny > h + 50) continue

        const baseR = getNodeRadius(node.weight)
        const r = baseR * t.scale
        const color = getColor(node.type)

        const isSel = selected?.id === node.id
        const isHov = hovered?.id === node.id
        const isConn = selected ? edgeIndex.get(selected.id)?.has(node.id) || false : false
        const dimmed = selected && !isSel && !isConn

        // Glow for selected/hovered
        if ((isSel || isHov) && r > 2) {
          const glow = ctx!.createRadialGradient(nx, ny, r * 0.3, nx, ny, r * 2.5)
          glow.addColorStop(0, color + "30")
          glow.addColorStop(1, color + "00")
          ctx!.fillStyle = glow
          ctx!.beginPath()
          ctx!.arc(nx, ny, r * 2.5, 0, Math.PI * 2)
          ctx!.fill()
        }

        // Circle
        ctx!.beginPath()
        ctx!.arc(nx, ny, r, 0, Math.PI * 2)
        ctx!.fillStyle = dimmed ? color + "20" : color + (isSel ? "ee" : "aa")
        ctx!.fill()
        if (isSel) {
          ctx!.strokeStyle = "#ffffff"
          ctx!.lineWidth = 2 * t.scale
          ctx!.stroke()
        } else if (!dimmed) {
          ctx!.strokeStyle = color + "50"
          ctx!.lineWidth = 1 * t.scale
          ctx!.stroke()
        }

        // Label — only show when zoomed enough or node is active
        const showLabel = t.scale > 0.55 || isSel || isHov
        if (showLabel && r > 2) {
          const fs = Math.max(8, Math.min(12, 10 * t.scale))
          ctx!.font = `${isSel || isHov ? 600 : 400} ${fs}px Inter, system-ui, sans-serif`
          ctx!.textAlign = "center"
          ctx!.textBaseline = "top"

          const labelY = ny + r + 4 * t.scale

          // Shadow
          ctx!.fillStyle = "#1a1a1a"
          const metrics = ctx!.measureText(node.label)
          const pad = 3
          ctx!.fillRect(nx - metrics.width / 2 - pad, labelY - 1, metrics.width + pad * 2, fs + 3)

          ctx!.fillStyle = dimmed ? "rgba(255,255,255,0.15)" : isSel ? "#ffffff" : "rgba(255,255,255,0.7)"
          ctx!.fillText(node.label, nx, labelY)
        }
      }

      animFrameRef.current = requestAnimationFrame(draw)
    }

    sim.on("tick", () => {})
    animFrameRef.current = requestAnimationFrame(draw)

    // --- Mouse handlers ---
    function handleMouseDown(e: MouseEvent) {
      const r = canvas.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      const node = findNodeAt(mx, my)

      if (node) {
        dragRef.current = { active: true, node, moved: false }
        node.fx = node.x
        node.fy = node.y
        sim.alphaTarget(0.1).restart()
      } else {
        panRef.current = { active: true, lastX: mx, lastY: my }
      }
    }

    function handleMouseMove(e: MouseEvent) {
      const r = canvas.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      const t = transformRef.current

      // Dragging node
      if (dragRef.current.active && dragRef.current.node) {
        dragRef.current.moved = true
        dragRef.current.node.fx = (mx - t.x) / t.scale
        dragRef.current.node.fy = (my - t.y) / t.scale
        return
      }

      // Panning
      if (panRef.current.active) {
        t.x += mx - panRef.current.lastX
        t.y += my - panRef.current.lastY
        panRef.current.lastX = mx
        panRef.current.lastY = my
        canvas.style.cursor = "grabbing"
        return
      }

      // Hover
      const node = findNodeAt(mx, my)
      hoveredNodeRef.current = node
      canvas.style.cursor = node ? "pointer" : "grab"

      // Throttled tooltip update
      if (node) {
        tooltipRef.current = { x: e.clientX, y: e.clientY, node }
        setTooltipUI({ x: e.clientX, y: e.clientY, node })
      } else if (tooltipRef.current.node) {
        tooltipRef.current = { x: 0, y: 0, node: null }
        setTooltipUI({ x: 0, y: 0, node: null })
      }
    }

    function handleMouseUp() {
      if (dragRef.current.active && dragRef.current.node) {
        if (!dragRef.current.moved) {
          // Click — toggle selection
          const clickedNode = dragRef.current.node
          if (selectedNodeRef.current?.id === clickedNode.id) {
            selectedNodeRef.current = null
            setSelectedNodeUI(null)
          } else {
            selectedNodeRef.current = clickedNode
            setSelectedNodeUI(clickedNode)
          }
        }
        dragRef.current.node.fx = null
        dragRef.current.node.fy = null
        sim.alphaTarget(0)
      }
      dragRef.current = { active: false, node: null, moved: false }
      panRef.current.active = false
      canvas.style.cursor = "grab"
    }

    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      const t = transformRef.current

      const factor = e.deltaY < 0 ? 1.08 : 0.92
      const ns = Math.max(0.15, Math.min(4, t.scale * factor))

      t.x = mx - (mx - t.x) * (ns / t.scale)
      t.y = my - (my - t.y) * (ns / t.scale)
      t.scale = ns
    }

    function handleMouseLeave() {
      hoveredNodeRef.current = null
      setTooltipUI({ x: 0, y: 0, node: null })
      panRef.current.active = false
    }

    canvas.addEventListener("mousedown", handleMouseDown)
    canvas.addEventListener("mousemove", handleMouseMove)
    canvas.addEventListener("mouseup", handleMouseUp)
    canvas.addEventListener("mouseleave", handleMouseLeave)
    canvas.addEventListener("wheel", handleWheel, { passive: false })

    // Resize
    const ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect()
      const nw = r.width, nh = r.height
      canvas.width = nw * dpr
      canvas.height = nh * dpr
      canvas.style.width = `${nw}px`
      canvas.style.height = `${nh}px`
      widthRef.current = nw
      heightRef.current = nh
    })
    ro.observe(container)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      sim.stop()
      canvas.removeEventListener("mousedown", handleMouseDown)
      canvas.removeEventListener("mousemove", handleMouseMove)
      canvas.removeEventListener("mouseup", handleMouseUp)
      canvas.removeEventListener("mouseleave", handleMouseLeave)
      canvas.removeEventListener("wheel", handleWheel)
      ro.disconnect()
    }
  }, [graphData, findNodeAt])

  // Zoom controls
  const zoom = useCallback((factor: number) => {
    const t = transformRef.current
    const cx = widthRef.current / 2, cy = heightRef.current / 2
    const ns = Math.max(0.15, Math.min(4, t.scale * factor))
    t.x = cx - (cx - t.x) * (ns / t.scale)
    t.y = cy - (cy - t.y) * (ns / t.scale)
    t.scale = ns
  }, [])

  const resetView = useCallback(() => {
    transformRef.current = { x: widthRef.current / 2, y: heightRef.current / 2, scale: 1 }
    selectedNodeRef.current = null
    setSelectedNodeUI(null)
  }, [])

  // Deselect
  const deselect = useCallback(() => {
    selectedNodeRef.current = null
    setSelectedNodeUI(null)
  }, [])

  // Connected edges for detail panel
  const connectedEdges = selectedNodeUI && graphData
    ? graphData.edges.filter((e) => {
        const s = typeof e.source === "string" ? e.source : (e.source as any).id
        const t = typeof e.target === "string" ? e.target : (e.target as any).id
        return s === selectedNodeUI.id || t === selectedNodeUI.id
      })
    : []

  const presentTypes = graphData ? [...new Set(graphData.nodes.map((n) => n.type))].sort() : []

  return (
    <div className="relative flex flex-col w-full h-full overflow-hidden rounded-lg">
      <div ref={containerRef} className="relative flex-1 min-h-0 bg-[#1a1a1a]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Knowledge Graph wird geladen...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="text-sm text-red-400 bg-red-950/50 px-4 py-3 rounded-lg border border-red-800/50">
              Fehler: {error}
            </div>
          </div>
        )}

        {!loading && graphData && graphData.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <div className="text-4xl opacity-20">&#x2B21;</div>
              <p className="text-sm">Noch kein Knowledge Graph vorhanden.</p>
              <p className="text-xs opacity-60">Laden Sie Dokumente hoch, um den Graph aufzubauen.</p>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {/* Tooltip */}
        <AnimatePresence>
          {tooltipUI.node && !selectedNodeUI && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="fixed z-50 pointer-events-none"
              style={{ left: tooltipUI.x + 14, top: tooltipUI.y - 8 }}
            >
              <div className="bg-[#252525]/95 backdrop-blur-sm border border-white/[0.08] rounded-lg px-3 py-2 shadow-2xl max-w-[220px]">
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(tooltipUI.node.type) }} />
                  <span className="text-xs font-semibold text-white truncate">{tooltipUI.node.label}</span>
                </div>
                <div className="text-[10px] text-white/35 uppercase tracking-wider">
                  {TYPE_LABELS[tooltipUI.node.type] || tooltipUI.node.type}
                </div>
                {tooltipUI.node.description && (
                  <p className="text-[11px] text-white/50 mt-1 line-clamp-2">{tooltipUI.node.description}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
          <button onClick={() => zoom(1.4)} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.06] transition-colors backdrop-blur-sm" title="Zoom in">
            <ZoomIn className="size-3.5 text-white/40" />
          </button>
          <button onClick={() => zoom(0.7)} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.06] transition-colors backdrop-blur-sm" title="Zoom out">
            <ZoomOut className="size-3.5 text-white/40" />
          </button>
          <button onClick={resetView} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.06] transition-colors backdrop-blur-sm" title="Reset">
            <Maximize2 className="size-3.5 text-white/40" />
          </button>
        </div>

        {/* Stats */}
        {graphData && graphData.nodes.length > 0 && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-3 bg-[#1e1e1e]/80 backdrop-blur-sm border border-white/[0.06] rounded-lg px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] text-white/40">{graphData.stats.entities} Entities</span>
            </div>
            <div className="w-px h-3 bg-white/[0.06]" />
            <span className="text-[11px] text-white/40">{graphData.stats.relations} Relations</span>
          </div>
        )}

        {/* Legend */}
        {presentTypes.length > 0 && (
          <div className="absolute top-3 right-3 z-10 bg-[#1e1e1e]/80 backdrop-blur-sm border border-white/[0.06] rounded-lg px-3 py-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {presentTypes.map((type) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(type) }} />
                  <span className="text-[10px] text-white/35">{TYPE_LABELS[type] || type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      <AnimatePresence>
        {selectedNodeUI && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="border-t border-white/[0.06] bg-[#1e1e1e] overflow-hidden"
          >
            <div className="px-4 py-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(selectedNodeUI.type) }} />
                  <span className="text-sm font-semibold text-white">{selectedNodeUI.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/25 bg-white/[0.04] px-1.5 py-0.5 rounded">
                    {TYPE_LABELS[selectedNodeUI.type] || selectedNodeUI.type}
                  </span>
                </div>
                <button onClick={deselect} className="p-1 rounded hover:bg-white/5 transition-colors">
                  <X className="size-3.5 text-white/30" />
                </button>
              </div>
              {selectedNodeUI.description && (
                <p className="text-xs text-white/40 mb-2">{selectedNodeUI.description}</p>
              )}
              {connectedEdges.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {connectedEdges.slice(0, 10).map((edge) => {
                    const s = typeof edge.source === "string" ? edge.source : (edge.source as any).id
                    const isSource = s === selectedNodeUI.id
                    const otherId = isSource
                      ? (typeof edge.target === "string" ? edge.target : (edge.target as any).id)
                      : s
                    const otherNode = graphData?.nodes.find((n) => n.id === otherId)
                    return (
                      <div key={edge.id} className="flex items-center gap-1 text-[10px] bg-white/[0.03] rounded px-2 py-1 border border-white/[0.04]">
                        <span className="text-primary/60">{edge.type}</span>
                        <span className="text-white/15">→</span>
                        <span className="text-white/50">{otherNode?.label || "?"}</span>
                      </div>
                    )
                  })}
                  {connectedEdges.length > 10 && (
                    <span className="text-[10px] text-white/20 px-2 py-1">+{connectedEdges.length - 10} weitere</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
