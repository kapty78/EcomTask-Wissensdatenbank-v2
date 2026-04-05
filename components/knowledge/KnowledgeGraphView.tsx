"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Loader2, ZoomIn, ZoomOut, Maximize2, X, RotateCcw } from "lucide-react"

// --- Types ---

interface GraphNode {
  id: string
  label: string
  type: string
  description: string
  weight: number
  // 3D spherical coords (set during layout)
  theta: number // polar angle
  phi: number   // azimuthal angle
  // Projected 2D
  sx: number
  sy: number
  sz: number // depth for sorting
  screenR: number
}

interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  label: string
  weight: number
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: { entities: number; relations: number }
}

// --- Colors (Wissensdatenbank design) ---

const TYPE_COLORS: Record<string, string> = {
  person: "#ff55c9",       // primary pink
  organization: "#ff79d4", // lighter pink
  product: "#d4a0c0",      // muted rose
  process: "#b8b8b8",      // light grey
  location: "#e0a8c8",     // dusty pink
  role: "#c9c9c9",         // silver grey
  feature: "#d6b8cb",      // warm mauve
  rule: "#ff99d6",         // soft pink
  step: "#a0a0a0",         // medium grey
  spec: "#c4b0be",         // grey-rose
  contact: "#e8b0d4",      // light rose
  definition: "#8a8a8a",   // dark grey
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

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

// --- Fibonacci sphere for even node distribution ---

function fibonacciSphere(n: number): Array<{ theta: number; phi: number }> {
  const points: Array<{ theta: number; phi: number }> = []
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2 // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = Math.acos(y)
    const phi = goldenAngle * i
    points.push({ theta, phi })
  }
  return points
}

// --- 3D math ---

function project(
  theta: number, phi: number, radius: number,
  rotX: number, rotY: number,
  cx: number, cy: number, fov: number
): { x: number; y: number; z: number; scale: number } {
  // Spherical to cartesian
  let x = radius * Math.sin(theta) * Math.cos(phi)
  let y = radius * Math.cos(theta)
  let z = radius * Math.sin(theta) * Math.sin(phi)

  // Rotate around Y axis
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY)
  const x1 = x * cosY - z * sinY
  const z1 = x * sinY + z * cosY

  // Rotate around X axis
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX)
  const y1 = y * cosX - z1 * sinX
  const z2 = y * sinX + z1 * cosX

  // Perspective projection
  const perspective = fov / (fov + z2)
  return {
    x: cx + x1 * perspective,
    y: cy + y1 * perspective,
    z: z2,
    scale: perspective,
  }
}

// --- Component ---

interface KnowledgeGraphViewProps {
  knowledgeBaseId: string
  onClose: () => void
  onNodeSelect?: (node: GraphNode | null, graphData: GraphData | null) => void
}

// Re-export for external use
export type { GraphNode, GraphEdge, GraphData }

export default function KnowledgeGraphView({ knowledgeBaseId, onClose, onNodeSelect }: KnowledgeGraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)

  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeUI, setSelectedNodeUIRaw] = useState<GraphNode | null>(null)
  const graphDataRef = useRef<GraphData | null>(null)

  // Wrap setSelectedNodeUI to also call onNodeSelect
  const setSelectedNodeUI = useCallback((node: GraphNode | null) => {
    setSelectedNodeUIRaw(node)
    onNodeSelect?.(node, graphDataRef.current)
  }, [onNodeSelect])
  const [tooltipUI, setTooltipUI] = useState<{ x: number; y: number; node: GraphNode | null }>({ x: 0, y: 0, node: null })

  // Refs for render loop (no re-renders)
  const nodesRef = useRef<GraphNode[]>([])
  const edgesRef = useRef<GraphEdge[]>([])
  const nodeMapRef = useRef<Map<string, GraphNode>>(new Map())
  const edgeIndexRef = useRef<Map<string, Set<string>>>(new Map())
  const selectedRef = useRef<GraphNode | null>(null)
  const hoveredRef = useRef<GraphNode | null>(null)

  // Camera state
  const rotRef = useRef({ x: 0.3, y: 0 }) // rotation
  const autoRotateRef = useRef(true)
  const radiusRef = useRef(200)
  const fovRef = useRef(600)
  const sizeRef = useRef({ w: 0, h: 0 })

  // Drag state
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0, moved: false })

  // Load data
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/knowledge/entity-graph?knowledge_base_id=${knowledgeBaseId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) {
          setGraphData(data)
          graphDataRef.current = data
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [knowledgeBaseId])

  // Find node at screen position
  const findNodeAt = useCallback((mx: number, my: number): GraphNode | null => {
    const nodes = nodesRef.current
    // Check front-to-back: negative Z = near camera = front
    const sorted = [...nodes].sort((a, b) => a.sz - b.sz)
    for (const n of sorted) {
      if (n.sz > 0) continue // behind sphere (positive Z = far)
      const dx = mx - n.sx, dy = my - n.sy
      const hitR = Math.max(8, n.screenR + 4)
      if (dx * dx + dy * dy <= hitR * hitR) return n
    }
    return null
  }, [])

  // Setup rendering (only on graphData change)
  useEffect(() => {
    if (!graphData || !canvasRef.current || !containerRef.current) return
    if (graphData.nodes.length === 0) return

    const canvas = canvasRef.current
    const container = containerRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    const w = rect.width, h = rect.height
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    sizeRef.current = { w, h }

    // Sphere radius based on viewport
    const sphereR = Math.min(w, h) * 0.33
    radiusRef.current = sphereR

    // Distribute nodes on Fibonacci sphere
    const positions = fibonacciSphere(graphData.nodes.length)
    const nodes: GraphNode[] = graphData.nodes.map((n, i) => ({
      ...n,
      theta: positions[i].theta,
      phi: positions[i].phi,
      sx: 0, sy: 0, sz: 0, screenR: 0,
    }))

    // Sort by weight descending — high-weight nodes get "better" (more spread out) positions
    const byWeight = [...nodes].sort((a, b) => b.weight - a.weight)
    const sortedPositions = [...positions]
    byWeight.forEach((node, i) => {
      node.theta = sortedPositions[i].theta
      node.phi = sortedPositions[i].phi
    })

    const edges: GraphEdge[] = graphData.edges.map((e) => ({ ...e } as GraphEdge))
    nodesRef.current = nodes
    edgesRef.current = edges

    // Build lookup maps
    const nodeMap = new Map<string, GraphNode>()
    nodes.forEach((n) => nodeMap.set(n.id, n))
    nodeMapRef.current = nodeMap

    const edgeIndex = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!edgeIndex.has(e.source)) edgeIndex.set(e.source, new Set())
      if (!edgeIndex.has(e.target)) edgeIndex.set(e.target, new Set())
      edgeIndex.get(e.source)!.add(e.target)
      edgeIndex.get(e.target)!.add(e.source)
    }
    edgeIndexRef.current = edgeIndex

    // --- Render ---
    function draw() {
      const { w, h } = sizeRef.current
      const rot = rotRef.current
      const R = radiusRef.current
      const fov = fovRef.current
      const cx = w / 2, cy = h / 2
      const selected = selectedRef.current
      const hovered = hoveredRef.current

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, w, h)

      // Background
      ctx!.fillStyle = "#1a1a1a"
      ctx!.fillRect(0, 0, w, h)

      // Auto-rotate
      if (autoRotateRef.current && !dragRef.current.active) {
        rot.y += 0.002
      }

      // Project all nodes
      for (const node of nodes) {
        const p = project(node.theta, node.phi, R, rot.x, rot.y, cx, cy, fov)
        node.sx = p.x
        node.sy = p.y
        node.sz = p.z
        node.screenR = Math.max(2, getNodeRadius(node.weight) * p.scale)
      }

      // Sort by depth (back first)
      // Sort back-to-front: positive Z = far (draw first), negative Z = near (draw last)
      const sorted = [...nodes].sort((a, b) => b.sz - a.sz)

      // Sphere wireframe — subtle equator and meridians
      drawSphereWireframe(ctx!, cx, cy, R, rot, fov, w, h)

      // Draw edges (back-to-front, only visible ones)
      for (const edge of edges) {
        const src = nodeMap.get(edge.source)
        const tgt = nodeMap.get(edge.target)
        if (!src || !tgt) continue

        // Both behind? skip
        const avgZ = (src.sz + tgt.sz) / 2
        const depthAlpha = Math.max(0, Math.min(1, (R - avgZ) / (2 * R)))
        if (depthAlpha < 0.05) continue

        const highlighted = selected && (src.id === selected.id || tgt.id === selected.id)

        // Draw as curved arc (great circle approximation)
        ctx!.beginPath()
        ctx!.moveTo(src.sx, src.sy)

        // Bezier control point — push outward from center for arc effect
        const midX = (src.sx + tgt.sx) / 2
        const midY = (src.sy + tgt.sy) / 2
        const dx = midX - cx, dy = midY - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const bulge = dist > 10 ? 0.15 : 0
        const cpx = midX + dx * bulge
        const cpy = midY + dy * bulge

        ctx!.quadraticCurveTo(cpx, cpy, tgt.sx, tgt.sy)

        if (highlighted) {
          ctx!.strokeStyle = `rgba(255, 85, 201, ${0.25 * depthAlpha})`
          ctx!.lineWidth = 1.5
        } else {
          ctx!.strokeStyle = `rgba(255, 255, 255, ${0.04 * depthAlpha})`
          ctx!.lineWidth = 0.5
        }
        ctx!.stroke()
      }

      // Draw nodes (back-to-front)
      for (const node of sorted) {
        const depthAlpha = Math.max(0.08, Math.min(1, (R - node.sz) / (2 * R)))
        const r = node.screenR
        const color = getColor(node.type)
        const [cr, cg, cb] = hexToRgb(color)

        const isSel = selected?.id === node.id
        const isHov = hovered?.id === node.id
        const isConn = selected ? edgeIndex.get(selected.id)?.has(node.id) || false : false
        const dimmed = selected && !isSel && !isConn

        // Glow for front-facing selected/hovered nodes
        if ((isSel || isHov) && depthAlpha > 0.4) {
          const glow = ctx!.createRadialGradient(node.sx, node.sy, r * 0.3, node.sx, node.sy, r * 4)
          glow.addColorStop(0, `rgba(${cr},${cg},${cb}, ${0.25 * depthAlpha})`)
          glow.addColorStop(1, `rgba(${cr},${cg},${cb}, 0)`)
          ctx!.fillStyle = glow
          ctx!.beginPath()
          ctx!.arc(node.sx, node.sy, r * 4, 0, Math.PI * 2)
          ctx!.fill()
        }

        // Node circle
        const alpha = dimmed ? 0.12 * depthAlpha : (isSel ? 0.95 : 0.7) * depthAlpha
        ctx!.beginPath()
        ctx!.arc(node.sx, node.sy, r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${cr},${cg},${cb}, ${alpha})`
        ctx!.fill()

        if (isSel && depthAlpha > 0.3) {
          ctx!.strokeStyle = `rgba(255,255,255, ${0.8 * depthAlpha})`
          ctx!.lineWidth = 1.5
          ctx!.stroke()
        }

        // Label (only for front-facing, not too small)
        const showLabel = depthAlpha > 0.5 && r > 3 && (isSel || isHov || (depthAlpha > 0.7 && r > 4))
        if (showLabel) {
          const fs = Math.max(8, Math.min(12, 10 * (r / 8)))
          ctx!.font = `${isSel || isHov ? 600 : 400} ${fs}px Inter, system-ui, sans-serif`
          ctx!.textAlign = "center"
          ctx!.textBaseline = "top"

          const labelY = node.sy + r + 4
          const textAlpha = dimmed ? 0.1 : (isSel ? 0.95 : 0.6) * depthAlpha

          // Background
          const metrics = ctx!.measureText(node.label)
          const pad = 3
          ctx!.fillStyle = `rgba(26, 26, 26, ${0.8 * depthAlpha})`
          ctx!.fillRect(node.sx - metrics.width / 2 - pad, labelY - 1, metrics.width + pad * 2, fs + 3)

          ctx!.fillStyle = `rgba(255,255,255, ${textAlpha})`
          ctx!.fillText(node.label, node.sx, labelY)
        }
      }

      animRef.current = requestAnimationFrame(draw)
    }

    function getNodeRadius(weight: number): number {
      return Math.max(4, Math.min(14, 3 + (weight || 1) * 2))
    }

    function drawSphereWireframe(
      ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number,
      rot: { x: number; y: number }, fov: number, w: number, h: number
    ) {
      ctx.strokeStyle = "rgba(255,255,255,0.025)"
      ctx.lineWidth = 0.5

      // Equator
      ctx.beginPath()
      for (let i = 0; i <= 64; i++) {
        const angle = (i / 64) * Math.PI * 2
        const p = project(Math.PI / 2, angle, R, rot.x, rot.y, cx, cy, fov)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()

      // Two meridians
      for (const offset of [0, Math.PI / 2]) {
        ctx.beginPath()
        for (let i = 0; i <= 64; i++) {
          const angle = (i / 64) * Math.PI * 2
          const p = project(angle, offset, R, rot.x, rot.y, cx, cy, fov)
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      }

      // Outer ring (always circular from front)
      ctx.beginPath()
      ctx.arc(cx, cy, R * (fov / (fov + 0)), 0, Math.PI * 2)
      ctx.strokeStyle = "rgba(255,255,255,0.03)"
      ctx.stroke()
    }

    animRef.current = requestAnimationFrame(draw)

    // --- Mouse handlers ---
    function handleMouseDown(e: MouseEvent) {
      const r = canvas.getBoundingClientRect()
      dragRef.current = { active: true, lastX: e.clientX - r.left, lastY: e.clientY - r.top, moved: false }
      autoRotateRef.current = false
    }

    function handleMouseMove(e: MouseEvent) {
      const r = canvas.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top

      if (dragRef.current.active) {
        const dx = mx - dragRef.current.lastX
        const dy = my - dragRef.current.lastY
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true
        rotRef.current.y += dx * 0.005
        rotRef.current.x += dy * 0.005
        // Clamp X rotation
        rotRef.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotRef.current.x))
        dragRef.current.lastX = mx
        dragRef.current.lastY = my
        canvas.style.cursor = "grabbing"
        return
      }

      // Hover
      const node = findNodeAt(mx, my)
      hoveredRef.current = node
      canvas.style.cursor = node ? "pointer" : "grab"

      if (node) {
        setTooltipUI({ x: e.clientX, y: e.clientY, node })
      } else {
        setTooltipUI((prev) => prev.node ? { x: 0, y: 0, node: null } : prev)
      }
    }

    function handleMouseUp(e: MouseEvent) {
      if (dragRef.current.active && !dragRef.current.moved) {
        // Click
        const r = canvas.getBoundingClientRect()
        const mx = e.clientX - r.left, my = e.clientY - r.top
        const node = findNodeAt(mx, my)
        if (node) {
          if (selectedRef.current?.id === node.id) {
            selectedRef.current = null
            setSelectedNodeUI(null)
          } else {
            selectedRef.current = node
            setSelectedNodeUI(node)
          }
        } else {
          selectedRef.current = null
          setSelectedNodeUI(null)
        }
      }
      dragRef.current = { active: false, lastX: 0, lastY: 0, moved: false }
      canvas.style.cursor = "grab"
    }

    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      // Scroll up = zoom in = make sphere bigger
      const factor = e.deltaY < 0 ? 1.06 : 0.94
      const base = Math.min(sizeRef.current.w, sizeRef.current.h) * 0.33
      radiusRef.current = Math.max(base * 0.3, Math.min(base * 2.5, radiusRef.current * factor))
    }

    function handleMouseLeave() {
      hoveredRef.current = null
      setTooltipUI({ x: 0, y: 0, node: null })
      dragRef.current.active = false
    }

    canvas.addEventListener("mousedown", handleMouseDown)
    canvas.addEventListener("mousemove", handleMouseMove)
    canvas.addEventListener("mouseup", handleMouseUp)
    canvas.addEventListener("mouseleave", handleMouseLeave)
    canvas.addEventListener("wheel", handleWheel, { passive: false })

    // Resize
    const ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect()
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
      sizeRef.current = { w: r.width, h: r.height }
      radiusRef.current = Math.min(r.width, r.height) * 0.33
    })
    ro.observe(container)

    return () => {
      cancelAnimationFrame(animRef.current)
      canvas.removeEventListener("mousedown", handleMouseDown)
      canvas.removeEventListener("mousemove", handleMouseMove)
      canvas.removeEventListener("mouseup", handleMouseUp)
      canvas.removeEventListener("mouseleave", handleMouseLeave)
      canvas.removeEventListener("wheel", handleWheel)
      ro.disconnect()
    }
  }, [graphData, findNodeAt])

  const resetView = useCallback(() => {
    rotRef.current = { x: 0.3, y: 0 }
    radiusRef.current = Math.min(sizeRef.current.w, sizeRef.current.h) * 0.33
    fovRef.current = 600
    autoRotateRef.current = true
    selectedRef.current = null
    setSelectedNodeUI(null)
  }, [])

  const toggleAutoRotate = useCallback(() => {
    autoRotateRef.current = !autoRotateRef.current
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

        {/* Controls */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
          <button onClick={() => { const base = Math.min(sizeRef.current.w, sizeRef.current.h) * 0.33; radiusRef.current = Math.min(base * 2.5, radiusRef.current * 1.2) }} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.06] transition-colors backdrop-blur-sm" title="Zoom in">
            <ZoomIn className="size-3.5 text-white/40" />
          </button>
          <button onClick={() => { const base = Math.min(sizeRef.current.w, sizeRef.current.h) * 0.33; radiusRef.current = Math.max(base * 0.3, radiusRef.current * 0.8) }} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.06] transition-colors backdrop-blur-sm" title="Zoom out">
            <ZoomOut className="size-3.5 text-white/40" />
          </button>
          <button onClick={toggleAutoRotate} className="p-1.5 rounded-md bg-[#1e1e1e]/80 hover:bg-[#282828] border border-white/[0.06] transition-colors backdrop-blur-sm" title="Auto-Rotation">
            <RotateCcw className="size-3.5 text-white/40" />
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
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.06] bg-gradient-to-b from-[#1e1e1e] to-[#1a1a1a]">
              <div className="px-4 py-3">
                {/* Header row */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: getColor(selectedNodeUI.type) }} />
                      <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ backgroundColor: getColor(selectedNodeUI.type) }} />
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-white">{selectedNodeUI.label}</span>
                      <span className="ml-2 text-[10px] uppercase tracking-widest text-white/20">
                        {TYPE_LABELS[selectedNodeUI.type] || selectedNodeUI.type}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => { selectedRef.current = null; setSelectedNodeUI(null) }}
                    className="p-1.5 rounded-md hover:bg-white/5 transition-colors"
                  >
                    <X className="size-3.5 text-white/25" />
                  </button>
                </div>

                {/* Description */}
                {selectedNodeUI.description && (
                  <p className="text-[11px] text-white/35 mb-3 leading-relaxed">{selectedNodeUI.description}</p>
                )}

                {/* Connections */}
                {connectedEdges.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-white/15 mb-2">
                      {connectedEdges.length} Verbindung{connectedEdges.length !== 1 ? 'en' : ''}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {connectedEdges.map((edge) => {
                        const s = typeof edge.source === "string" ? edge.source : (edge.source as any).id
                        const isSource = s === selectedNodeUI.id
                        const otherId = isSource
                          ? (typeof edge.target === "string" ? edge.target : (edge.target as any).id)
                          : s
                        const otherNode = graphData?.nodes.find((n) => n.id === otherId)
                        if (!otherNode) return null
                        const otherColor = getColor(otherNode.type)

                        return (
                          <div
                            key={edge.id}
                            className="group flex items-center gap-1.5 text-[10px] rounded-md px-2 py-1 border transition-all duration-150 hover:border-white/[0.1] hover:bg-white/[0.03]"
                            style={{ borderColor: `${otherColor}15`, backgroundColor: `${otherColor}06` }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: otherColor }} />
                            <span className="text-white/30 group-hover:text-white/40 transition-colors">{edge.type}</span>
                            <span className="text-white/10">&middot;</span>
                            <span className="text-white/55 group-hover:text-white/70 transition-colors">{otherNode.label}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// --- Mini Radial Graph (exported for sidebar use) ---

export function MiniRadialGraph({
  centerNode,
  edges,
  allNodes,
}: {
  centerNode: GraphNode
  edges: GraphEdge[]
  allNodes: GraphNode[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)
  const hoveredRef = useRef<string | null>(null)
  const [hoveredLabel, setHoveredLabel] = useState<{ x: number; y: number; node: GraphNode; edgeType: string } | null>(null)

  const nodeMap = new Map<string, GraphNode>()
  allNodes.forEach((n) => nodeMap.set(n.id, n))

  // Collect neighbor nodes
  const neighbors: Array<{ node: GraphNode; edgeType: string }> = []
  const seen = new Set<string>()
  for (const edge of edges) {
    const s = typeof edge.source === "string" ? edge.source : (edge.source as any).id
    const t = typeof edge.target === "string" ? edge.target : (edge.target as any).id
    const otherId = s === centerNode.id ? t : s
    if (seen.has(otherId)) continue
    seen.add(otherId)
    const otherNode = nodeMap.get(otherId)
    if (otherNode) {
      neighbors.push({ node: otherNode, edgeType: edge.type })
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    const w = rect.width, h = rect.height
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const cx = w / 2, cy = h / 2
    const orbitR = Math.min(w, h) * 0.32
    const centerR = 12
    const nodeR = 7

    // Precompute neighbor positions
    const positions = neighbors.map((_, i) => {
      const angle = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2
      return {
        x: cx + Math.cos(angle) * orbitR,
        y: cy + Math.sin(angle) * orbitR,
      }
    })

    let phase = 0

    function draw() {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, w, h)

      phase += 0.01
      const hovered = hoveredRef.current

      // Edges — animated pulse
      for (let i = 0; i < neighbors.length; i++) {
        const pos = positions[i]
        const isHov = hovered === neighbors[i].node.id
        const color = getColor(neighbors[i].node.type)
        const [r, g, b] = hexToRgb(color)

        // Edge line
        ctx!.beginPath()
        ctx!.moveTo(cx, cy)
        ctx!.lineTo(pos.x, pos.y)
        ctx!.strokeStyle = isHov
          ? `rgba(${r},${g},${b}, 0.5)`
          : `rgba(255,255,255, 0.06)`
        ctx!.lineWidth = isHov ? 1.5 : 0.8
        ctx!.stroke()

        // Animated pulse dot on edge
        const pulseT = ((phase + i * 0.3) % 1)
        const px = cx + (pos.x - cx) * pulseT
        const py = cy + (pos.y - cy) * pulseT
        ctx!.beginPath()
        ctx!.arc(px, py, 1.5, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${r},${g},${b}, ${0.6 * (1 - pulseT)})`
        ctx!.fill()

        // Edge label
        if (isHov) {
          const mx = (cx + pos.x) / 2, my = (cy + pos.y) / 2
          ctx!.font = "500 9px Inter, system-ui, sans-serif"
          ctx!.textAlign = "center"
          ctx!.fillStyle = `rgba(${r},${g},${b}, 0.6)`
          ctx!.fillText(neighbors[i].edgeType, mx, my - 6)
        }
      }

      // Neighbor nodes
      for (let i = 0; i < neighbors.length; i++) {
        const pos = positions[i]
        const nb = neighbors[i]
        const color = getColor(nb.node.type)
        const [r, g, b] = hexToRgb(color)
        const isHov = hovered === nb.node.id

        // Glow
        if (isHov) {
          const glow = ctx!.createRadialGradient(pos.x, pos.y, nodeR * 0.3, pos.x, pos.y, nodeR * 3)
          glow.addColorStop(0, `rgba(${r},${g},${b}, 0.3)`)
          glow.addColorStop(1, `rgba(${r},${g},${b}, 0)`)
          ctx!.fillStyle = glow
          ctx!.beginPath()
          ctx!.arc(pos.x, pos.y, nodeR * 3, 0, Math.PI * 2)
          ctx!.fill()
        }

        ctx!.beginPath()
        ctx!.arc(pos.x, pos.y, nodeR, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${r},${g},${b}, ${isHov ? 0.95 : 0.7})`
        ctx!.fill()

        // Label
        ctx!.font = `${isHov ? 600 : 400} 9px Inter, system-ui, sans-serif`
        ctx!.textAlign = "center"
        ctx!.textBaseline = "top"
        const labelY = pos.y + nodeR + 4

        const metrics = ctx!.measureText(nb.node.label)
        ctx!.fillStyle = "rgba(30,30,30,0.85)"
        ctx!.fillRect(pos.x - metrics.width / 2 - 2, labelY - 1, metrics.width + 4, 12)

        ctx!.fillStyle = isHov ? "#ffffff" : "rgba(255,255,255,0.55)"
        ctx!.fillText(nb.node.label, pos.x, labelY)
      }

      // Center node — glow
      const cc = getColor(centerNode.type)
      const [cr, cg, cb] = hexToRgb(cc)
      const centerGlow = ctx!.createRadialGradient(cx, cy, centerR * 0.3, cx, cy, centerR * 3.5)
      centerGlow.addColorStop(0, `rgba(${cr},${cg},${cb}, 0.25)`)
      centerGlow.addColorStop(1, `rgba(${cr},${cg},${cb}, 0)`)
      ctx!.fillStyle = centerGlow
      ctx!.beginPath()
      ctx!.arc(cx, cy, centerR * 3.5, 0, Math.PI * 2)
      ctx!.fill()

      // Center circle
      ctx!.beginPath()
      ctx!.arc(cx, cy, centerR, 0, Math.PI * 2)
      ctx!.fillStyle = `rgba(${cr},${cg},${cb}, 0.9)`
      ctx!.fill()
      ctx!.strokeStyle = "#ffffff"
      ctx!.lineWidth = 2
      ctx!.stroke()

      // Center label
      ctx!.font = "600 11px Inter, system-ui, sans-serif"
      ctx!.textAlign = "center"
      ctx!.textBaseline = "top"
      const clY = cy + centerR + 5
      const clMetrics = ctx!.measureText(centerNode.label)
      ctx!.fillStyle = "rgba(30,30,30,0.85)"
      ctx!.fillRect(cx - clMetrics.width / 2 - 3, clY - 1, clMetrics.width + 6, 14)
      ctx!.fillStyle = "#ffffff"
      ctx!.fillText(centerNode.label, cx, clY)

      // Type label below name
      ctx!.font = "400 8px Inter, system-ui, sans-serif"
      ctx!.fillStyle = "rgba(255,255,255,0.3)"
      ctx!.fillText(TYPE_LABELS[centerNode.type] || centerNode.type, cx, clY + 14)

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)

    // Hover detection
    function handleMouseMove(e: MouseEvent) {
      const r = canvas.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top

      let found: string | null = null
      for (let i = 0; i < neighbors.length; i++) {
        const pos = positions[i]
        const dx = mx - pos.x, dy = my - pos.y
        if (dx * dx + dy * dy <= (nodeR + 4) * (nodeR + 4)) {
          found = neighbors[i].node.id
          break
        }
      }
      hoveredRef.current = found
      canvas.style.cursor = found ? "pointer" : "default"
    }

    canvas.addEventListener("mousemove", handleMouseMove)

    return () => {
      cancelAnimationFrame(animRef.current)
      canvas.removeEventListener("mousemove", handleMouseMove)
    }
  }, [centerNode, edges, neighbors])

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  )
}
