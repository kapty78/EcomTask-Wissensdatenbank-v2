'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
// Icons entfernt für clean Design
import Sigma from 'sigma'
import Graph from 'graphology'
import { Attributes } from 'graphology-types'

// Types basierend auf unserer API
interface GraphNode {
  id: string
  type: 'document' | 'knowledge-item' | 'fact'
  label: string
  size: number
  color: string
  x?: number
  y?: number
  metadata?: {
    content?: string
    facts?: any[]
    documentName?: string
    chunkCount?: number
    factCount?: number
  }
}

interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  color: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: {
    documentCount: number
    chunkCount: number
    factCount: number
  }
}

interface SigmaGraphVisualizationProps {
  knowledgeBaseId: string
  onNodeSelect?: (nodeId: string, nodeType: string, nodeData: any) => void
  onOpenChunkModal?: (nodeId: string, nodeType: string) => void
}

// Farben für verschiedene Node-Typen (Dunkles Theme #1d1d1d) - App-konsistente Farben
const NODE_COLORS = {
  document: '#ec4899',    // Pink für Dokumente (passt zu UI-Akzenten)
  'knowledge-item': '#9ca3af', // Grau für Chunks (anstatt weiß)
  fact: '#f472b6'         // Pink für Fakten (harmoniert mit dem Design)
}

// Node-Größen
const NODE_SIZES = {
  document: 20,
  'knowledge-item': 15,
  fact: 6 // Kleinere Facts damit sie nicht überlappen
}



export default function SigmaGraphVisualization({ knowledgeBaseId, onNodeSelect, onOpenChunkModal }: SigmaGraphVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const graphRef = useRef<Graph | null>(null)
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const updateNodeSizesRef = useRef<(() => void) | null>(null)
  
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [showPanel, setShowPanel] = useState(false)
  const [showFilterPanel, setShowFilterPanel] = useState(false) // Einklappbares Filter-Panel
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Graph-Daten von API laden
  const loadGraphData = useCallback(async () => {
    if (!knowledgeBaseId || loading) return

    setLoading(true)
    setError(null)
    
    try {
      // console.log('🔄 Lade Sigma.js Graph-Daten...')
      
      const url = `/api/knowledge/graph-data?knowledge_base_id=${knowledgeBaseId}&include_layout=true&min_similarity=0.3`
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`API-Fehler: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json()
      // console.log('📊 Graph-Daten erhalten:', data)
      
      setGraphData(data)
      
    } catch (error: any) {
      // console.error('❌ Fehler beim Laden der Graph-Daten:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }, [knowledgeBaseId])

  // Sigma.js Graph erstellen
  const createSigmaGraph = useCallback((data: GraphData) => {
    if (!containerRef.current || !data) return

    // console.log('🎨 Erstelle Sigma.js Graph...')

    // Cleanup bestehender Graph
    if (sigmaRef.current) {
      sigmaRef.current.kill()
      sigmaRef.current = null
    }

    // Neuen Graph erstellen
    const graph = new Graph()
    graphRef.current = graph

    // Nodes hinzufügen mit API-Positionen
    // console.log('🎯 Verwende API-Positionen für Layout')
    // Dynamische Normalisierung der API-Positionen, abhängig von der größten Ausdehnung
    let scaleDivisor = 2500
    try {
      let maxAbs = 0
      data.nodes.forEach((n: any) => {
        const p = (n as any).position
        if (p) {
          maxAbs = Math.max(maxAbs, Math.abs(p.x || 0), Math.abs(p.y || 0))
        }
      })
      if (maxAbs > 0) {
        scaleDivisor = Math.max(2500, maxAbs)
      }
      // console.log('🧭 Positions-Normalisierung:', { maxAbs, scaleDivisor })
    } catch (e) {
      // console.warn('Positions-Normalisierung fehlgeschlagen – nutze Standardwert 2500', e)
    }
    data.nodes.forEach((node, index) => {
      // API-Position verwenden falls vorhanden, sonst Fallback
      let x, y
      if (node.position) {
        // Für dynamische Radien: Angepasste Skalierung für optimale Darstellung
        x = node.position.x / scaleDivisor
        y = node.position.y / scaleDivisor
        // console.log(`📍 ${node.type} ${node.label}: API-Position (${node.position.x}, ${node.position.y}) -> Sigma (${x.toFixed(2)}, ${y.toFixed(2)})`)
      } else {
        // Fallback: Kreis-Layout
        const angle = (index / data.nodes.length) * 2 * Math.PI
        const radius = node.type === 'document' ? 0.5 : (node.type === 'knowledge-item' ? 1.0 : 1.5)
        x = Math.cos(angle) * radius
        y = Math.sin(angle) * radius
        // console.log(`⚠️ ${node.type} ${node.label}: Fallback-Position (${x.toFixed(2)}, ${y.toFixed(2)})`)
      }
      
      // Initial-Größe setzen - updateNodeSizes passt später an Zoom-Level an
      const nodeAttributes: any = {
        label: node.label,
        size: 10, // Temporäre Größe - wird von updateNodeSizes überschrieben
        color: NODE_COLORS[node.type] || '#cccccc',
        type: 'circle', // Expliziter type für Sigma.js
        x: x,
        y: y,
        nodeType: node.type, // Unser eigener Typ für die Logik
        metadata: node.metadata || {}
      }

      graph.addNode(node.id, nodeAttributes)
    })

    // Edges hinzufügen
    data.edges.forEach((edge) => {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        graph.addEdge(edge.source, edge.target, {
          size: 2,
          color: edge.color || '#9ca3af',
          type: 'line' // Expliziter type für Sigma.js
        })
      }
    })

    // console.log(`📈 Graph erstellt: ${graph.order} Nodes, ${graph.size} Edges`)

    // Sigma.js Instanz erstellen - MINIMAL CONFIG
    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      allowInvalidContainer: true,
      labelSize: 0,
      labelColor: { color: '#000000' },
      labelRenderedSizeThreshold: 100,
      // Verhindert extreme Zoomstufen, die Knoten optisch vergrößern lassen
      minCameraRatio: 0.05,
      maxCameraRatio: 10
    })

    sigmaRef.current = sigma

    // Proportionale Zoom-Skalierung - Nodes werden normal mit dem Zoom skaliert
    const updateNodeSizes = () => {
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current)
      
      updateTimeoutRef.current = setTimeout(() => {
        try {
          if (!sigma || sigma.isKilled) {
            // console.warn('Sigma not available for updateNodeSizes')
            return
          }
          
          const camera = sigma.getCamera()
          const ratio = camera.getState().ratio
          const normalized = ratio >= 1 ? ratio : 1 / Math.max(ratio, 0.0001)
          
          // Kleinere Basis-Größen für bessere Skalierung
          const baseNodeSizes = {
            document: 5,
            'knowledge-item': 3.5,
            fact: 1.8
          }
          
          // Level-of-Detail (LOD): bei starkem Herauszoomen Details ausblenden
          const hideFacts = normalized >= 6
          const hideChunks = normalized >= 12

          // Aggressive, symmetrische Verkleinerung (exponentiell)
          graph.forEachNode((nodeId, nodeData) => {
            const nodeType = nodeData.nodeType
            const baseSize = baseNodeSizes[nodeType] || 3
            const hidden = (nodeType === 'fact' && hideFacts) || (nodeType === 'knowledge-item' && hideChunks)
            const sizeCandidate = baseSize * Math.pow(normalized, -1.35)
            const scaledSize = Math.max(0.2, Math.min(baseSize, sizeCandidate))

            graph.mergeNodeAttributes(nodeId, {
              size: hidden ? 0 : scaledSize,
              hidden
            })
          })

          // Kantenbreite mitskalieren und ausblenden, wenn Quell-/Zielnode versteckt ist
          graph.forEachEdge((edgeId, edgeData, source, target) => {
            const sourceHidden = graph.getNodeAttribute(source, 'hidden')
            const targetHidden = graph.getNodeAttribute(target, 'hidden')
            const edgeHidden = !!(sourceHidden || targetHidden)

            const baseWidth = 0.8
            const width = Math.max(0.1, baseWidth * Math.pow(normalized, -1.1))

            graph.mergeEdgeAttributes(edgeId, { size: edgeHidden ? 0 : width, hidden: edgeHidden })
          })
          
          if (sigma && !sigma.isKilled) {
            sigma.refresh()
          }
        } catch (error) {
          // console.error('❌ Fehler beim Aktualisieren der Node-Größen:', error)
        }
      }, 50) // 50ms Debouncing für bessere Performance
    }

    // updateNodeSizes Funktion in Ref speichern für späteren Zugriff
    updateNodeSizesRef.current = updateNodeSizes

    // Events registrieren
    sigma.on('clickNode', (event) => {
      const nodeId = event.node
      const nodeData = graph.getNodeAttributes(nodeId)
      
      // 🔍 Prüfen ob Node ausgegraut ist (nicht dem Suchfilter entspricht)
      if (nodeData.opacity && nodeData.opacity < 1) {
        // console.log('🚫 Klick auf ausgegraute Node ignoriert:', nodeId, 'opacity:', nodeData.opacity)
        return // Click ignorieren für ausgegraute Nodes
      }
      
      // console.log('🖱️ Node geklickt:', nodeId, nodeData)
      
      setSelectedNode(nodeId)
      setShowPanel(true)
      
      // Parent-Callback aufrufen
      if (onNodeSelect) {
        onNodeSelect(nodeId, nodeData.nodeType, nodeData.metadata)
      }
    })

    // Camera Events für sanfte Zoom-Skalierung
    sigma.on('updated', () => {
      updateNodeSizes()
    })

    // Initial Node-Größen setzen
    updateNodeSizes()

    // Hover-Events für Tooltips - nur für normale (nicht ausgegraute) Nodes
    sigma.on('enterNode', (event) => {
      const nodeId = event.node
      const nodeData = graph.getNodeAttributes(nodeId)
      
      // console.log('🔍 ENTER NODE EVENT:', {
      //   nodeId: nodeId,
      //   nodeType: nodeData.nodeType,
      //   opacity: nodeData.opacity,
      //   color: nodeData.color,
      //   hasOpacity: nodeData.hasOwnProperty('opacity'),
      //   opacityType: typeof nodeData.opacity,
      //   allAttributes: Object.keys(nodeData)
      // })
      
      // 🚫 Hover nur für normale Nodes (nicht ausgegraut)
      if (nodeData.opacity && nodeData.opacity < 1) {
        // console.log('🚫 BLOCKED: Hover auf ausgegraute Node:', nodeId, 'opacity:', nodeData.opacity)
        return // Kein Hover für ausgegraute Nodes
      }
      
      // console.log('✅ ALLOWED: Hover für normale Node:', nodeId, 'opacity:', nodeData.opacity)
      setHoveredNode(nodeId)
    })

    sigma.on('leaveNode', (event) => {
      const nodeId = event.node
      // console.log('🚪 LEAVE NODE EVENT:', nodeId)
      setHoveredNode(null)
    })

    // Mouse-Position verfolgen für Tooltip-Positionierung
    sigma.getMouseCaptor().on('mousemove', (event: any) => {
      setMousePosition({ x: event.x, y: event.y })
    })

    sigma.on('clickStage', () => {
      setSelectedNode(null)
      setShowPanel(false)
    })

    // Auto-Resize mit Safety-Check
    const resizeObserver = new ResizeObserver(() => {
      try {
        if (sigma && !sigma.isKilled) {
          sigma.refresh()
        }
      } catch (error) {
        // console.warn('Sigma refresh error in ResizeObserver:', error)
      }
    })
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
      sigma.kill()
    }

  }, [onNodeSelect])

  // Filter-Funktion für den Graph
  const applyFilter = useCallback(() => {
    if (!sigmaRef.current || !graphRef.current) return
    
    // console.log('🔍 Wende Filter an:', filterType)
    
    const graph = graphRef.current
    
    // Alle Nodes durchgehen und Sichtbarkeit setzen
    graph.forEachNode((nodeId, nodeData) => {
      let isVisible = true
      
      if (filterType !== 'all') {
        isVisible = nodeData.nodeType === filterType
      }
      
      // Node ein-/ausblenden (über Größe)
      graph.mergeNodeAttributes(nodeId, {
        hidden: !isVisible,
        size: isVisible ? (NODE_SIZES[nodeData.nodeType] || 10) : 0
      })
    })
    
    // Edges basierend auf sichtbaren Nodes ein-/ausblenden
    graph.forEachEdge((edgeId, edgeAttributes, source, target) => {
      const sourceVisible = !graph.getNodeAttribute(source, 'hidden')
      const targetVisible = !graph.getNodeAttribute(target, 'hidden')
      const edgeVisible = sourceVisible && targetVisible
      
      graph.mergeEdgeAttributes(edgeId, {
        hidden: !edgeVisible,
        size: edgeVisible ? 2 : 0
      })
    })
    
    // Graph neu rendern mit Safety-Check
    if (sigmaRef.current && !sigmaRef.current.isKilled) {
      sigmaRef.current.refresh()
    }
    
    // 🔧 WICHTIG: Nach Filter auch zoom-abhängige Skalierung wieder anwenden
    setTimeout(() => {
      if (updateNodeSizesRef.current) {
        updateNodeSizesRef.current()
      }
    }, 10) // Kurze Verzögerung damit refresh() zuerst fertig ist
    
    // console.log(`✅ Filter angewendet: ${filterType}`)
  }, [filterType])

  // Graph laden beim Mount
  useEffect(() => {
    loadGraphData()
  }, [loadGraphData])

  // Graph erstellen wenn Daten da sind
  useEffect(() => {
    if (graphData) {
      createSigmaGraph(graphData)
    }
  }, [graphData, createSigmaGraph])

  // Filter anwenden wenn sich filterType ändert
  useEffect(() => {
    applyFilter()
  }, [filterType, applyFilter])

  // 🔍 SUCHFILTER FUNKTION - außerhalb von createSigmaGraph für aktuelle Werte
  const applySearchFilter = useCallback(() => {
    const graph = graphRef.current
    const sigma = sigmaRef.current
    
    if (!graph || !sigma) {
      // console.log('⚠️ Graph oder Sigma nicht verfügbar für Suchfilter')
      return
    }

    try {
      const searchLower = searchTerm.toLowerCase().trim()
      // console.log(`🔍 Anwenden von Suchfilter für: "${searchTerm}" (lower: "${searchLower}")`)
      
      let matchCount = 0
      let totalCount = 0
      
      graph.forEachNode((nodeId, nodeData) => {
        totalCount++
        const nodeType = nodeData.nodeType
        let isMatch = true

        if (searchLower) {
          // Suche in verschiedenen Node-Eigenschaften
          const searchTargets = [
            nodeData.label?.toLowerCase() || '',
            nodeData.metadata?.content?.toLowerCase() || '',
            nodeData.metadata?.document_name?.toLowerCase() || ''
          ]

          // Nur für Fakten: auch in Fact-Content suchen
          if (nodeType === 'fact' && nodeData.metadata?.facts) {
            nodeData.metadata.facts.forEach((fact: any) => {
              searchTargets.push(fact.content?.toLowerCase() || '')
            })
          }

          // Prüfen ob Suchbegriff in irgendeinem Target enthalten ist
          isMatch = searchTargets.some(target => target.includes(searchLower))
          
          // Debug einzelne Node
          if (totalCount <= 3) {
            // console.log(`🔍 Node ${nodeId} (${nodeType}):`, {
            //   searchTargets: searchTargets.slice(0, 2),
            //   isMatch,
            //   searchLower
            // })
          }
        }

        if (isMatch) matchCount++

        // Original-Farbe abrufen oder fallback
        const originalColor = NODE_COLORS[nodeType] || '#ffffff'
        
        // Node-Styling basierend auf Match
        if (isMatch) {
          // Normal: Original-Farbe + klickbar
          graph.mergeNodeAttributes(nodeId, {
            color: originalColor,
            opacity: 1,
            highlighted: false
          })
        } else {
          // Ausgegraut: Grau + reduzierte Opacity
          graph.mergeNodeAttributes(nodeId, {
            color: '#444444',
            opacity: 0.25,
            highlighted: false
          })
        }
      })

      if (sigma && !sigma.isKilled) {
        sigma.refresh()
      }
      // console.log(`✅ Suchfilter angewendet: ${matchCount}/${totalCount} Nodes passen zu "${searchTerm}"`)
    } catch (error) {
      // console.error('❌ Fehler beim Anwenden des Suchfilters:', error)
    }
  }, [searchTerm])

  // 🔍 Suchfilter anwenden wenn sich searchTerm ändert
  useEffect(() => {
    // console.log(`🔍 useEffect: searchTerm geändert zu: "${searchTerm}"`)
    applySearchFilter()
  }, [searchTerm, applySearchFilter])

  // Cleanup
  useEffect(() => {
    return () => {
      // Cleanup timeout
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
      
      if (sigmaRef.current) {
        sigmaRef.current.kill()
      }
    }
  }, [])

  // Click outside um Panel zu schließen
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!showFilterPanel || !filterPanelRef.current) return
      
      const target = event.target as Element
      
      // Prüfen ob Klick innerhalb des Panels ist
      if (filterPanelRef.current.contains(target)) return
      
      // Prüfen ob Klick auf Select-Dropdown oder verwandte Elemente ist
      const isSelectRelated = target.closest('[role="listbox"]') || 
                              target.closest('[role="option"]') || 
                              target.closest('[data-radix-select-content]') ||
                              target.closest('[data-radix-select-item]') ||
                              target.closest('[data-radix-select-trigger]') ||
                              target.closest('.select-dropdown') ||
                              target.hasAttribute('data-select-item')
      
      if (isSelectRelated) return
      
      // Nur schließen wenn es wirklich außerhalb ist
      setShowFilterPanel(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilterPanel])

  // Zoom-Funktionen
  const zoomIn = () => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera()
      camera.animatedZoom({ duration: 300 })
      // console.log('🔍 Zoom In - neuer Zoom-Level:', camera.ratio)
    }
  }

  const zoomOut = () => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera()
      camera.animatedUnzoom({ duration: 300 })
      // console.log('🔍 Zoom Out - neuer Zoom-Level:', camera.ratio)
    }
  }

  const resetView = () => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera()
      camera.animatedReset({ duration: 500 })
    }
  }

  const fitView = () => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera()
      camera.animatedReset({ duration: 500 })
      setTimeout(() => {
        if (updateNodeSizesRef.current) updateNodeSizesRef.current()
        // console.log('🎯 Fit View ausgeführt - Zoom-Level:', camera.getState().ratio)
      }, 550)
    }
  }

  // Ausgewählten Node-Daten abrufen
  const getSelectedNodeData = () => {
    if (!selectedNode || !graphRef.current) return null
    
    try {
      const nodeData = graphRef.current.getNodeAttributes(selectedNode)
      return nodeData
    } catch (error) {
      // console.warn('Fehler beim Abrufen der Node-Daten:', error)
      return null
    }
  }

  // Hover Node-Daten abrufen
  const getHoveredNodeData = () => {
    if (!hoveredNode || !graphRef.current) {
      // console.log('🔍 getHoveredNodeData: Kein hoveredNode oder graphRef')
      return null
    }
    
    try {
      const nodeData = graphRef.current.getNodeAttributes(hoveredNode)
      
      // console.log('🔍 getHoveredNodeData EXECUTED:', {
      //   hoveredNode,
      //   nodeType: nodeData.nodeType,
      //   opacity: nodeData.opacity,
      //   color: nodeData.color,
      //   willReturnData: true
      // })
      
      // 🚫 ZUSÄTZLICHE OPACITY-PRÜFUNG HIER!
      if (nodeData.opacity && nodeData.opacity < 1) {
        // console.log('🚫 getHoveredNodeData BLOCKED: Ausgegraute Node, return null:', hoveredNode, 'opacity:', nodeData.opacity)
        return null
      }
      
      // Für Dokument-Nodes: Verwende den echten Namen falls verfügbar
      if (nodeData.nodeType === 'document') {
        const displayName = nodeData.metadata?.document_name || nodeData.label || 'Unbekanntes Dokument'
        return {
          ...nodeData,
          label: displayName
        }
      }
      
      return nodeData
    } catch (error) {
      // console.warn('Fehler beim Abrufen der Hover-Node-Daten:', error)
      return null
    }
  }

  const selectedNodeData = getSelectedNodeData()
  const hoveredNodeData = getHoveredNodeData()

  return (
    <div className="w-full h-full relative" style={{ backgroundColor: '#1d1d1d' }}>
      {/* Einklappbares Header Panel - Sidebar Design */}
      <div className="absolute top-4 left-4 z-10">
        {/* Toggle Button */}
        <button
          onClick={() => setShowFilterPanel(!showFilterPanel)}
          className="group flex items-center justify-center size-10 rounded-xl border border-[#333333] bg-[#2a2a2a]/80 backdrop-blur-sm hover:bg-[#333333]/60 transition-colors duration-150 ease-in-out mb-2"
          title={showFilterPanel ? "Filter einklappen" : "Filter ausklappen"}
        >
          <svg className="size-5 text-gray-400 group-hover:text-white transition-colors duration-150" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        </button>
        
        {/* Einklappbares Panel */}
        {showFilterPanel && (
          <div ref={filterPanelRef} className="rounded-xl shadow-xl border border-[#333333] bg-[#1e1e1e]/95 backdrop-blur-sm min-w-80">
            <div className="p-3 border-b border-[#333333]">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-medium text-white">Wissens-Graph</h3>
              </div>
              
              {/* Statistiken */}
              {graphData && graphData.stats && (
                <div className="flex gap-2 mt-2">
                  <span className="inline-flex items-center rounded-xl bg-pink-500/20 ring-1 ring-pink-500/50 px-2 py-1 text-xs font-medium text-white">
                    {graphData.stats.documentCount} Dokumente
                  </span>
                  <span className="inline-flex items-center rounded-xl bg-pink-500/20 ring-1 ring-pink-500/50 px-2 py-1 text-xs font-medium text-white">
                    {graphData.stats.chunkCount} Chunks
                  </span>
                  <span className="inline-flex items-center rounded-xl bg-pink-500/20 ring-1 ring-pink-500/50 px-2 py-1 text-xs font-medium text-white">
                    {graphData.stats.factCount} Fakten
                  </span>
                </div>
              )}
            </div>

            {/* Suche und Filter */}
            <div className="p-3 space-y-2.5">
              <div className="rounded-xl border border-[#333333] bg-[#2a2a2a]/50 p-3">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Suche</label>
                <input
                  type="text"
                  placeholder="Nach Inhalten suchen..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-[#333333] rounded-xl text-sm text-gray-100 placeholder-gray-400 bg-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50 transition-all duration-150"
                />
              </div>
              
              <div className="rounded-xl border border-[#333333] bg-[#2a2a2a]/50 p-3">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Filter</label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-full mt-1 text-gray-100 border-[#333333] bg-[#1a1a1a] hover:bg-[#333333] hover:border-[#444444] focus:ring-2 focus:ring-pink-500/50 transition-all duration-150 rounded-xl cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent 
                    className="border-[#333333] rounded-xl shadow-xl z-50"
                    style={{ 
                      backgroundColor: '#1e1e1e', 
                      opacity: 1,
                      backdropFilter: 'none'
                    }}
                  >
                    <SelectItem value="all" className="text-gray-100 hover:bg-[#333333] hover:text-white focus:bg-pink-500/20 focus:text-white rounded-lg m-1 transition-all duration-150 cursor-pointer">Alle anzeigen</SelectItem>
                    <SelectItem value="document" className="text-gray-100 hover:bg-[#333333] hover:text-white focus:bg-pink-500/20 focus:text-white rounded-lg m-1 transition-all duration-150 cursor-pointer">Nur Dokumente</SelectItem>
                    <SelectItem value="knowledge-item" className="text-gray-100 hover:bg-[#333333] hover:text-white focus:bg-pink-500/20 focus:text-white rounded-lg m-1 transition-all duration-150 cursor-pointer">Nur Chunks</SelectItem>
                    <SelectItem value="fact" className="text-gray-100 hover:bg-[#333333] hover:text-white focus:bg-pink-500/20 focus:text-white rounded-lg m-1 transition-all duration-150 cursor-pointer">Nur Fakten</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Controls - Sidebar Design */}
      <div className="absolute bottom-4 left-4 z-10">
        <div className="flex gap-2">
          <button 
            onClick={zoomIn} 
            className="group flex items-center justify-center size-10 rounded-xl border border-[#333333] bg-[#2a2a2a]/80 backdrop-blur-sm hover:bg-[#333333]/60 transition-colors duration-150 ease-in-out"
            title="Vergrößern"
          >
            <svg className="size-5 text-gray-400 group-hover:text-white transition-colors duration-150" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </button>
          <button 
            onClick={zoomOut} 
            className="group flex items-center justify-center size-10 rounded-xl border border-[#333333] bg-[#2a2a2a]/80 backdrop-blur-sm hover:bg-[#333333]/60 transition-colors duration-150 ease-in-out"
            title="Verkleinern"
          >
            <svg className="size-5 text-gray-400 group-hover:text-white transition-colors duration-150" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          </button>
          <button 
            onClick={resetView} 
            className="group flex items-center justify-center size-10 rounded-xl border border-[#333333] bg-[#2a2a2a]/80 backdrop-blur-sm hover:bg-[#333333]/60 transition-colors duration-150 ease-in-out" 
            title="Ansicht zurücksetzen"
          >
            <svg className="size-5 text-gray-400 group-hover:text-white transition-colors duration-150" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sigma.js Container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: '#1d1d1d' }}
      />

      {/* Loading - Sidebar Design */}
      {loading && (
        <div className="absolute inset-0 backdrop-blur-sm flex items-center justify-center z-20" style={{ backgroundColor: 'rgba(29, 29, 29, 0.8)' }}>
          <div className="rounded-xl border border-[#333333] bg-[#1e1e1e]/95 backdrop-blur-sm p-8 text-center">
            <LoadingSpinner className="w-8 h-8 mx-auto mb-4" />
            <p className="text-sm font-medium text-white">Graph wird geladen...</p>
            <p className="text-xs text-gray-400 mt-1">Visualisierung wird vorbereitet</p>
          </div>
        </div>
      )}

      {/* Error - Sidebar Design */}
      {error && (
        <div className="absolute inset-0 backdrop-blur-sm flex items-center justify-center z-20" style={{ backgroundColor: 'rgba(29, 29, 29, 0.8)' }}>
          <div className="rounded-xl border border-[#333333] bg-[#1e1e1e]/95 backdrop-blur-sm p-6 w-96 text-center">
            <div className="size-12 mx-auto mb-4 text-muted-foreground">⚠️</div>
            <h3 className="text-sm font-medium text-white mb-2">Fehler beim Laden</h3>
            <p className="text-xs text-muted-foreground mb-4">{error}</p>
            <button
              onClick={loadGraphData}
              className="rounded-xl bg-pink-500/20 hover:bg-pink-500/30 ring-1 ring-pink-500/50 hover:ring-pink-500 transition-all duration-150 ease-in-out py-2 px-4 text-sm font-medium text-white"
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      )}

      {/* Properties Panel - Angepasst an Sidebar Design */}
      {showPanel && selectedNodeData && (
        <div className="absolute top-4 right-4 z-10 w-80 rounded-xl shadow-xl border border-[#333333] bg-[#1e1e1e]/95 backdrop-blur-sm">
          <div className="p-3 border-b border-[#333333] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-white">
                {selectedNodeData.nodeType === 'document' && 'Dokument'}
                {selectedNodeData.nodeType === 'knowledge-item' && 'Chunk'}
                {selectedNodeData.nodeType === 'fact' && 'Fakt'}
              </h4>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Button zum Öffnen des Chunk-Modals */}
              {(selectedNodeData.nodeType === 'knowledge-item' || selectedNodeData.nodeType === 'fact') && onOpenChunkModal && (
                <button
                  onClick={() => {
                    // console.log('🔗 Button geklickt:', selectedNode, selectedNodeData.nodeType)
                    onOpenChunkModal(selectedNode!, selectedNodeData.nodeType)
                  }}
                  className="rounded-xl bg-pink-500/20 hover:bg-pink-500/30 ring-1 ring-pink-500/50 hover:ring-pink-500 transition-all duration-150 ease-in-out py-1 px-2 text-xs font-medium text-white"
                >
                  {selectedNodeData.nodeType === 'knowledge-item' ? 'Zum Chunk' : 'Zum Fakt'}
                </button>
              )}
              
              <button
                onClick={() => setShowPanel(false)}
                className="rounded-xl p-1 text-gray-500 hover:bg-white/10 hover:text-foreground transition-all duration-150 ease-in-out"
                title="Schließen"
              >
                <svg className="size-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="p-3 max-h-96 overflow-y-auto">
            <div className="space-y-2.5">
              <div className="rounded-xl border border-[#333333] bg-[#2a2a2a]/50 p-3">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Label</label>
                <p className="text-sm text-white mt-1 font-medium">
                  {selectedNodeData.nodeType === 'document' && selectedNodeData.metadata?.document_name 
                    ? selectedNodeData.metadata.document_name 
                    : selectedNodeData.label}
                </p>
              </div>
              
              <div className="rounded-xl border border-[#333333] bg-[#2a2a2a]/50 p-3">
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Typ</label>
                <div className="mt-1">
                  <span className="inline-flex items-center rounded-xl bg-pink-500/20 ring-1 ring-pink-500/50 px-2 py-1 text-xs font-medium text-white">
                    {selectedNodeData.nodeType}
                  </span>
                </div>
              </div>

              {selectedNodeData.metadata?.content && (
                <div className="rounded-xl border border-[#333333] bg-[#2a2a2a]/50 p-3">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Inhalt</label>
                  <div className="text-xs text-gray-300 mt-2 p-3 rounded-xl bg-[#1a1a1a] border border-[#333333]/50 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    {selectedNodeData.metadata.content}
                  </div>
                </div>
              )}

              {selectedNodeData.metadata?.facts && selectedNodeData.metadata.facts.length > 0 && (
                <div className="rounded-xl border border-[#333333] bg-[#2a2a2a]/50 p-3">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Fakten ({selectedNodeData.metadata.facts.length})
                  </label>
                  <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                    {selectedNodeData.metadata.facts.map((fact: any, index: number) => (
                      <div key={index} className="text-xs p-3 rounded-xl border border-pink-500/30 bg-pink-500/10 text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {fact.content}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hover Tooltip - Sidebar Design */}
      {(() => {
        // console.log('🔍 TOOLTIP RENDER CHECK:', {
        //   hoveredNode,
        //   hoveredNodeData: !!hoveredNodeData,
        //   hoveredNodeDataType: hoveredNodeData?.nodeType,
        //   hoveredNodeDataOpacity: hoveredNodeData?.opacity,
        //   willRenderTooltip: !!hoveredNodeData
        // })
        return hoveredNodeData
      })() && (
        <div 
          className="absolute z-50 rounded-xl border border-[#333333] bg-[#1e1e1e]/95 backdrop-blur-sm shadow-xl pointer-events-none max-w-xs"
          style={{
            left: `${mousePosition.x + 15}px`,
            top: `${mousePosition.y - 10}px`,
            transform: mousePosition.x > window.innerWidth - 200 ? 'translateX(-100%)' : 'none'
          }}
        >
          <div className="p-3">
            <div className="mb-1">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                {hoveredNodeData.nodeType === 'document' && 'Dokument'}
                {hoveredNodeData.nodeType === 'knowledge-item' && 'Chunk'}
                {hoveredNodeData.nodeType === 'fact' && 'Fakt'}
              </span>
            </div>
            <div className="text-sm text-white font-medium break-words">
              {hoveredNodeData.label}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}