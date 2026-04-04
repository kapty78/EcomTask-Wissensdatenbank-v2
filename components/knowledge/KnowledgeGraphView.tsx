"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
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

// --- Color mapping ---

const TYPE_COLORS: Record<string, string> = {
  person: "#ff55c9",       // primary pink (matches app primary)
  organization: "#b38bff", // soft purple
  product: "#5eadff",      // muted blue
  process: "#4dd6a5",      // soft emerald
  location: "#f0a56e",     // warm sand
  role: "#e8c95a",         // muted gold
  feature: "#5ec6d4",      // teal
  rule: "#e87474",         // soft coral
  step: "#8dd45e",         // soft lime
  spec: "#8b8fff",         // lavender
  contact: "#d87ef5",      // light fuchsia
  definition: "#7a8494",   // muted slate
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
  return TYPE_COLORS[type] || "#94a3b8"
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
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null)

  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)

  // Transform state
  const transformRef = useRef({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; node: GraphNode | null }>({
    dragging: false, startX: 0, startY: 0, node: null,
  })

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

  // Find node at canvas position
  const findNodeAt = useCallback((canvasX: number, canvasY: number, nodes: GraphNode[], transform: { x: number; y: number; scale: number }): GraphNode | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]
      if (node.x == null || node.y == null) continue
      const screenX = node.x * transform.scale + transform.x
      const screenY = node.y * transform.scale + transform.y
      const radius = Math.max(6, Math.min(20, 4 + (node.weight || 1) * 3)) * transform.scale
      const dx = canvasX - screenX
      const dy = canvasY - screenY
      if (dx * dx + dy * dy < radius * radius) return node
    }
    return null
  }, [])

  // Setup simulation + rendering
  useEffect(() => {
    if (!graphData || !canvasRef.current || !containerRef.current) return
    if (graphData.nodes.length === 0) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    canvas.width = rect.width * window.devicePixelRatio
    canvas.height = rect.height * window.devicePixelRatio
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const width = rect.width
    const height = rect.height

    // Deep clone nodes/edges for d3 mutation
    const nodes: GraphNode[] = graphData.nodes.map((n) => ({ ...n }))
    const edges: GraphEdge[] = graphData.edges.map((e) => ({ ...e }))

    // Center transform
    transformRef.current = { x: width / 2, y: height / 2, scale: 1 }

    // Force simulation
    const sim = forceSimulation(nodes)
      .force("link", forceLink<GraphNode, GraphEdge>(edges).id((d) => d.id).distance(120).strength(0.4))
      .force("charge", forceManyBody().strength(-300))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<GraphNode>().radius((d) => Math.max(8, 4 + (d.weight || 1) * 3) + 5))
      .alphaDecay(0.02)

    simulationRef.current = sim

    // Render loop
    function draw() {
      if (!ctx) return
      const t = transformRef.current
      const w = width
      const h = height

      ctx.clearRect(0, 0, w, h)

      // Background
      ctx.fillStyle = "#1a1a1a"
      ctx.fillRect(0, 0, w, h)

      // Subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.03)"
      ctx.lineWidth = 1
      const gridSize = 40 * t.scale
      const offsetX = t.x % gridSize
      const offsetY = t.y % gridSize
      for (let x = offsetX; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      }
      for (let y = offsetY; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      }

      // Draw edges
      for (const edge of edges) {
        const source = edge.source as GraphNode
        const target = edge.target as GraphNode
        if (source.x == null || source.y == null || target.x == null || target.y == null) continue

        const sx = source.x * t.scale + t.x
        const sy = source.y * t.scale + t.y
        const tx = target.x * t.scale + t.x
        const ty = target.y * t.scale + t.y

        const isHighlighted = selectedNode && (
          (source as GraphNode).id === selectedNode.id || (target as GraphNode).id === selectedNode.id
        )

        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(tx, ty)
        ctx.strokeStyle = isHighlighted
          ? `rgba(255, 85, 201, 0.4)`
          : `rgba(255, 255, 255, 0.06)`
        ctx.lineWidth = isHighlighted ? 2 * t.scale : 1 * t.scale
        ctx.stroke()

        // Edge label (only when zoomed in enough and highlighted)
        if (isHighlighted && t.scale > 0.7) {
          const mx = (sx + tx) / 2
          const my = (sy + ty) / 2
          ctx.font = `${10 * t.scale}px Inter, system-ui, sans-serif`
          ctx.fillStyle = "rgba(255, 85, 201, 0.45)"
          ctx.textAlign = "center"
          ctx.fillText(edge.type, mx, my - 4 * t.scale)
        }
      }

      // Draw nodes
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue

        const nx = node.x * t.scale + t.x
        const ny = node.y * t.scale + t.y
        const baseRadius = Math.max(6, Math.min(20, 4 + (node.weight || 1) * 3))
        const radius = baseRadius * t.scale
        const color = getColor(node.type)

        const isSelected = selectedNode?.id === node.id
        const isHovered = hoveredNode?.id === node.id
        const isConnected = selectedNode && edges.some((e) => {
          const s = (e.source as GraphNode).id
          const tgt = (e.target as GraphNode).id
          return (s === selectedNode.id && tgt === node.id) || (tgt === selectedNode.id && s === node.id)
        })
        const dimmed = selectedNode && !isSelected && !isConnected

        // Glow
        if (isSelected || isHovered) {
          const glow = ctx.createRadialGradient(nx, ny, radius * 0.5, nx, ny, radius * 3)
          glow.addColorStop(0, color + "40")
          glow.addColorStop(1, color + "00")
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(nx, ny, radius * 3, 0, Math.PI * 2)
          ctx.fill()
        }

        // Node circle
        ctx.beginPath()
        ctx.arc(nx, ny, radius, 0, Math.PI * 2)
        ctx.fillStyle = dimmed ? color + "30" : color + "cc"
        ctx.fill()

        // Border
        ctx.strokeStyle = dimmed ? "rgba(255,255,255,0.05)" : isSelected ? "#fff" : color
        ctx.lineWidth = isSelected ? 2.5 * t.scale : 1.5 * t.scale
        ctx.stroke()

        // Label
        if (t.scale > 0.5 || isSelected || isHovered) {
          const fontSize = Math.max(9, Math.min(13, 11 * t.scale))
          ctx.font = `${isSelected || isHovered ? "600" : "400"} ${fontSize}px Inter, system-ui, sans-serif`
          ctx.textAlign = "center"
          ctx.textBaseline = "top"

          // Text shadow
          ctx.fillStyle = "rgba(0,0,0,0.8)"
          ctx.fillText(node.label, nx + 1, ny + radius + 5 * t.scale + 1)

          ctx.fillStyle = dimmed ? "rgba(255,255,255,0.2)" : isSelected ? "#fff" : "rgba(255,255,255,0.85)"
          ctx.fillText(node.label, nx, ny + radius + 5 * t.scale)
        }
      }

      animFrameRef.current = requestAnimationFrame(draw)
    }

    sim.on("tick", () => {})
    animFrameRef.current = requestAnimationFrame(draw)

    // --- Mouse interactions ---
    let isPanning = false
    let panStartX = 0
    let panStartY = 0

    function handleMouseDown(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const t = transformRef.current

      const node = findNodeAt(mx, my, nodes, t)
      if (node) {
        dragRef.current = { dragging: true, startX: mx, startY: my, node }
        node.fx = node.x
        node.fy = node.y
        sim.alphaTarget(0.3).restart()
      } else {
        isPanning = true
        panStartX = mx
        panStartY = my
      }
    }

    function handleMouseMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const t = transformRef.current

      if (dragRef.current.dragging && dragRef.current.node) {
        const node = dragRef.current.node
        node.fx = (mx - t.x) / t.scale
        node.fy = (my - t.y) / t.scale
        return
      }

      if (isPanning) {
        const dx = mx - panStartX
        const dy = my - panStartY
        transformRef.current.x += dx
        transformRef.current.y += dy
        panStartX = mx
        panStartY = my
        return
      }

      // Hover detection
      const node = findNodeAt(mx, my, nodes, t)
      if (node) {
        canvas.style.cursor = "pointer"
        setHoveredNode(node)
        setTooltipPos({ x: e.clientX, y: e.clientY })
      } else {
        canvas.style.cursor = "grab"
        setHoveredNode(null)
      }
    }

    function handleMouseUp() {
      if (dragRef.current.dragging && dragRef.current.node) {
        const node = dragRef.current.node
        // If barely moved, treat as click
        node.fx = null
        node.fy = null
        sim.alphaTarget(0)
      }
      dragRef.current = { dragging: false, startX: 0, startY: 0, node: null }
      isPanning = false
    }

    function handleClick(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const t = transformRef.current
      const node = findNodeAt(mx, my, nodes, t)
      setSelectedNode((prev) => (prev?.id === node?.id ? null : node))
    }

    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const t = transformRef.current

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9
      const newScale = Math.max(0.1, Math.min(5, t.scale * zoomFactor))

      // Zoom toward mouse position
      t.x = mx - (mx - t.x) * (newScale / t.scale)
      t.y = my - (my - t.y) * (newScale / t.scale)
      t.scale = newScale
    }

    canvas.addEventListener("mousedown", handleMouseDown)
    canvas.addEventListener("mousemove", handleMouseMove)
    canvas.addEventListener("mouseup", handleMouseUp)
    canvas.addEventListener("click", handleClick)
    canvas.addEventListener("wheel", handleWheel, { passive: false })

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = rect.height * window.devicePixelRatio
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const newCtx = canvas.getContext("2d")
      if (newCtx) newCtx.scale(window.devicePixelRatio, window.devicePixelRatio)
    })
    resizeObserver.observe(container)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      sim.stop()
      canvas.removeEventListener("mousedown", handleMouseDown)
      canvas.removeEventListener("mousemove", handleMouseMove)
      canvas.removeEventListener("mouseup", handleMouseUp)
      canvas.removeEventListener("click", handleClick)
      canvas.removeEventListener("wheel", handleWheel)
      resizeObserver.disconnect()
    }
  }, [graphData, findNodeAt, selectedNode, hoveredNode])

  // Zoom controls
  const zoom = useCallback((factor: number) => {
    const t = transformRef.current
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const newScale = Math.max(0.1, Math.min(5, t.scale * factor))
    t.x = cx - (cx - t.x) * (newScale / t.scale)
    t.y = cy - (cy - t.y) * (newScale / t.scale)
    t.scale = newScale
  }, [])

  const resetView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    transformRef.current = { x: rect.width / 2, y: rect.height / 2, scale: 1 }
  }, [])

  // Get connected edges for selected node
  const connectedEdges = selectedNode && graphData
    ? graphData.edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id
      || (typeof e.source === "object" && (e.source as any).id === selectedNode.id)
      || (typeof e.target === "object" && (e.target as any).id === selectedNode.id))
    : []

  // Collect unique entity types present
  const presentTypes = graphData
    ? [...new Set(graphData.nodes.map((n) => n.type))].sort()
    : []

  return (
    <div className="relative flex flex-col w-full h-full overflow-hidden rounded-lg">
      {/* Canvas area */}
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

        {/* Hover tooltip */}
        <AnimatePresence>
          {hoveredNode && !selectedNode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className="fixed z-50 pointer-events-none"
              style={{ left: tooltipPos.x + 16, top: tooltipPos.y - 10 }}
            >
              <div className="bg-[#252525]/95 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 shadow-xl max-w-[240px]">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getColor(hoveredNode.type) }} />
                  <span className="text-xs font-semibold text-white truncate">{hoveredNode.label}</span>
                </div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
                  {TYPE_LABELS[hoveredNode.type] || hoveredNode.type}
                </div>
                {hoveredNode.description && (
                  <p className="text-[11px] text-white/60 line-clamp-2">{hoveredNode.description}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
          <button onClick={() => zoom(1.3)} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.08] transition-colors backdrop-blur-sm" title="Zoom in">
            <ZoomIn className="size-3.5 text-white/50" />
          </button>
          <button onClick={() => zoom(0.7)} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.08] transition-colors backdrop-blur-sm" title="Zoom out">
            <ZoomOut className="size-3.5 text-white/50" />
          </button>
          <button onClick={resetView} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.08] transition-colors backdrop-blur-sm" title="Reset">
            <Maximize2 className="size-3.5 text-white/50" />
          </button>
        </div>

        {/* Stats badge */}
        {graphData && graphData.nodes.length > 0 && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-3 bg-[#1e1e1e]/80 backdrop-blur-sm border border-white/[0.06] rounded-lg px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] text-white/50">{graphData.stats.entities} Entities</span>
            </div>
            <div className="w-px h-3 bg-white/10" />
            <span className="text-[11px] text-white/50">{graphData.stats.relations} Relations</span>
          </div>
        )}

        {/* Legend */}
        {presentTypes.length > 0 && (
          <div className="absolute top-3 right-3 z-10 bg-[#1e1e1e]/80 backdrop-blur-sm border border-white/[0.06] rounded-lg px-3 py-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {presentTypes.map((type) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(type) }} />
                  <span className="text-[10px] text-white/40">{TYPE_LABELS[type] || type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Selected node detail panel */}
      <AnimatePresence>
        {selectedNode && (
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
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(selectedNode.type) }} />
                  <span className="text-sm font-semibold text-white">{selectedNode.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/30 bg-white/5 px-1.5 py-0.5 rounded">
                    {TYPE_LABELS[selectedNode.type] || selectedNode.type}
                  </span>
                </div>
                <button onClick={() => setSelectedNode(null)} className="p-1 rounded hover:bg-white/5">
                  <X className="size-3.5 text-white/40" />
                </button>
              </div>
              {selectedNode.description && (
                <p className="text-xs text-white/50 mb-2">{selectedNode.description}</p>
              )}
              {connectedEdges.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {connectedEdges.slice(0, 8).map((edge) => {
                    const isSource = (typeof edge.source === "object" ? (edge.source as any).id : edge.source) === selectedNode.id
                    const otherNode = graphData?.nodes.find(
                      (n) => n.id === (isSource
                        ? (typeof edge.target === "object" ? (edge.target as any).id : edge.target)
                        : (typeof edge.source === "object" ? (edge.source as any).id : edge.source))
                    )
                    return (
                      <div key={edge.id} className="flex items-center gap-1 text-[10px] bg-white/5 rounded px-2 py-1 border border-white/5">
                        <span className="text-primary/70">{edge.type}</span>
                        <span className="text-white/20">→</span>
                        <span className="text-white/60">{otherNode?.label || "?"}</span>
                      </div>
                    )
                  })}
                  {connectedEdges.length > 8 && (
                    <span className="text-[10px] text-white/30 px-2 py-1">+{connectedEdges.length - 8} weitere</span>
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
