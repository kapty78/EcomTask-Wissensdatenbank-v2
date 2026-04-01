"use client"

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  ConnectionMode,
  MarkerType,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { getSupabaseClient } from '@/lib/supabase-browser'
import { 
  Network, 
  BookOpen, 
  FileText, 
  Tag, 
  Brain,
  Search,
  Filter,
  Settings,
  Info
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Graph-Node Typen
type NodeType = 'knowledge-item' | 'concept' | 'topic' | 'document' | 'fact'

interface GraphNode extends Node {
  data: {
    label: string
    type: NodeType
    id: string
    content?: string
    similarity?: number
    metadata?: any
    color?: string
  }
}

interface GraphEdge extends Edge {
  data: {
    type: 'similarity' | 'reference' | 'topic-relation' | 'hierarchy' | 'detail'
    strength: number
    label?: string
  }
}

interface KnowledgeGraphProps {
  knowledgeBaseId: string
  selectedItemId?: string | null
  onNodeSelect?: (nodeId: string) => void
  height?: string
}

// Node-Farben basierend auf Typ
const NODE_COLORS = {
  'knowledge-item': '#4ade80', // Grün - Chunks
  'concept': '#f59e0b',        // Orange  
  'topic': '#8b5cf6',          // Violett
  'document': '#06b6d4',       // Cyan - Dokumente (größer)
  'fact': '#ec4899'            // Pink - Fakten (kleiner)
}

// Custom Node Komponente - Runde Kreise wie LightRAG
const CustomNode: React.FC<{ data: any; selected: boolean }> = ({ data, selected }) => {
  const IconComponent = data.type === 'knowledge-item' ? FileText : 
                       data.type === 'concept' ? Brain :
                       data.type === 'topic' ? Tag :
                       data.type === 'document' ? BookOpen :
                       data.type === 'fact' ? Info :
                       FileText

  // Größe abhängig vom Node-Typ
  const getNodeSize = (type: string) => {
    switch (type) {
      case 'document': return { size: 80, iconSize: 24, fontSize: 'text-sm', fontWeight: 'font-bold' }
      case 'knowledge-item': return { size: 60, iconSize: 18, fontSize: 'text-xs', fontWeight: 'font-medium' }
      case 'fact': return { size: 40, iconSize: 14, fontSize: 'text-xs', fontWeight: 'font-normal' }
      default: return { size: 50, iconSize: 16, fontSize: 'text-xs', fontWeight: 'font-medium' }
    }
  }

  const nodeSize = getNodeSize(data.type)
  const isDocument = data.type === 'document'
  const color = NODE_COLORS[data.type as NodeType]

  return (
    <div className="flex flex-col items-center cursor-pointer">
      {/* Runder Kreis */}
      <div 
        className={cn(
          "rounded-full bg-white border-4 shadow-lg transition-all duration-200 flex items-center justify-center",
          selected ? "border-blue-500 shadow-xl scale-110" : "border-gray-300 hover:border-gray-400 hover:scale-105"
        )}
        style={{ 
          width: nodeSize.size, 
          height: nodeSize.size,
          borderColor: selected ? '#3b82f6' : color,
          backgroundColor: selected ? '#eff6ff' : '#ffffff'
        }}
      >
        <IconComponent 
          size={nodeSize.iconSize} 
          style={{ color: selected ? '#3b82f6' : color }} 
        />
      </div>
      
      {/* Label unter dem Kreis */}
      <div className={cn(
        "mt-2 text-center max-w-[120px] text-gray-900 truncate",
        nodeSize.fontSize,
        nodeSize.fontWeight
      )}>
        {data.label}
      </div>
      
      {/* Zusätzliche Info für Chunks */}
      {data.type === 'knowledge-item' && data.metadata?.facts && (
        <div className="text-xs text-gray-500 mt-1">
          {data.metadata.facts.length} Fakten
        </div>
      )}
    </div>
  )
}

// Node Types für ReactFlow (außerhalb der Komponente definiert)
const nodeTypes = {
  custom: CustomNode,
}

// Innere Komponente mit ReactFlow-Logik
function KnowledgeGraphContent({
  knowledgeBaseId,
  selectedItemId,
  onNodeSelect,
  height = "600px"
}: KnowledgeGraphProps) {
  const supabase = getSupabaseClient()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<NodeType | 'all'>('all')
  const [showMinimap, setShowMinimap] = useState(true)
  const [selectedChunk, setSelectedChunk] = useState<any>(null)
  const [showFactsPanel, setShowFactsPanel] = useState(false)
  const [graphStats, setGraphStats] = useState({
    nodes: 0,
    edges: 0,
    clusters: 0
  })

  const { fitView } = useReactFlow()

  // Loading Ref für Guard gegen Endlos-Schleife
  const isLoadingRef = useRef(false)

  // Graph-Daten laden
  const loadGraphData = useCallback(async () => {
    if (!knowledgeBaseId || isLoadingRef.current) {
      // console.log('⏸️ Loading abgebrochen:', { knowledgeBaseId, isLoading: isLoadingRef.current })
      return
    }

    isLoadingRef.current = true
    setLoading(true)
    // console.log('🔄 Lade Graph-Daten für Knowledge Base:', knowledgeBaseId)
    
    try {
      // API-Route verwenden statt direkten Supabase-Aufruf
      const response = await fetch(`/api/knowledge/graph-data?knowledge_base_id=${knowledgeBaseId}&include_layout=true&min_similarity=0.3`)
      
      if (!response.ok) {
        throw new Error(`API-Fehler: ${response.status} ${response.statusText}`)
      }
      
      const graphData = await response.json()
      // console.log('✅ Graph-Daten erhalten:', graphData)

      // Konvertiere API-Daten zu ReactFlow-Format
      const graphNodes: GraphNode[] = graphData.nodes.map((node: any) => ({
        id: node.id,
        type: 'custom',
        position: node.position || {
          x: Math.random() * 800,
          y: Math.random() * 600,
        },
        data: {
          label: node.label,
          type: node.type as NodeType,
          id: node.id,
          content: node.content,
          metadata: node.metadata,
          color: NODE_COLORS[node.type as NodeType] || NODE_COLORS['knowledge-item']
        },
        draggable: true,
      }))

      // Konvertiere API-Kanten zu ReactFlow-Format (behalte API-Styles)
      const graphEdges: GraphEdge[] = graphData.edges.map((edge: any) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type || 'smoothstep',
        animated: edge.animated || false,
        style: edge.style || {
          strokeWidth: 1,
          stroke: '#6b7280',
          opacity: 0.6,
        },
        markerEnd: edge.markerEnd ? {
          type: MarkerType.ArrowClosed,
          width: edge.markerEnd.width || 20,
          height: edge.markerEnd.height || 20,
          color: edge.markerEnd.color || '#6b7280',
        } : undefined,
        data: edge.data || {
          type: edge.type,
          strength: edge.strength || 0.5,
          label: edge.label
        }
      }))

      // console.log(`📊 Graph erstellt: ${graphNodes.length} Knoten, ${graphEdges.length} Kanten`)

      setNodes(graphNodes)
      setEdges(graphEdges)
      setGraphStats(graphData.statistics || {
        nodes: graphNodes.length,
        edges: graphEdges.length,
        clusters: Math.ceil(graphNodes.length / 5)
      })

      // console.log('🎯 Setze Loading auf false - Graph fertig!')

      // Auto-Layout nach kurzer Verzögerung
      setTimeout(() => {
        if (graphNodes.length > 0) {
          // fitView verwenden - aber nicht in dependencies!
          fitView({ padding: 50, duration: 800 })
        }
      }, 100)

    } catch (error) {
      // console.error('❌ Fehler beim Laden der Graph-Daten:', error)
      
      // Fallback: Zeige eine leere Graph-Nachricht
      setNodes([])
      setEdges([])
      setGraphStats({ nodes: 0, edges: 0, clusters: 0 })
    } finally {
      // console.log('🏁 Loading beendet')
      isLoadingRef.current = false
      setLoading(false)
    }
  }, [knowledgeBaseId]) // fitView entfernt - das war die Endlos-Schleife!

  // Einfache Textähnlichkeitsberechnung
  const calculateTextSimilarity = (text1: string, text2: string): number => {
    if (!text1 || !text2) return 0
    
    const words1 = text1.toLowerCase().split(/\s+/)
    const words2 = text2.toLowerCase().split(/\s+/)
    
    const intersection = words1.filter(word => words2.includes(word))
    const union = new Set([...words1, ...words2])
    
    return intersection.length / union.size
  }

  // Gefilterte Knoten und Kanten
  const filteredNodes = useMemo(() => {
    return nodes.filter(node => {
      const matchesSearch = !searchTerm || 
        node.data.label.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesType = filterType === 'all' || node.data.type === filterType
      
      return matchesSearch && matchesType
    })
  }, [nodes, searchTerm, filterType])

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(node => node.id))
    return edges.filter(edge => 
      nodeIds.has(edge.source) && nodeIds.has(edge.target)
    )
  }, [edges, filteredNodes])

  // Node-Klick Handler
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    // console.log('🖱️ Node geklickt:', node)
    
    // Standardverhalten für alle Nodes
    if (onNodeSelect) {
      onNodeSelect(node.id)
    }
    
    // Spezielle Behandlung für Chunks
    if (node.data.type === 'knowledge-item') {
      // console.log('📄 Chunk geklickt - Debug Info:', {
      //   nodeId: node.id,
      //   label: node.data.label,
      //   hasContent: !!node.data.content,
      //   contentLength: node.data.content?.length || 0,
      //   contentPreview: node.data.content?.substring(0, 100) || 'LEER',
      //   hasMetadata: !!node.data.metadata,
      //   hasFacts: !!node.data.metadata?.facts,
      //   factsCount: node.data.metadata?.facts?.length || 0,
      //   metadata: node.data.metadata,
      //   originalContent: node.data.metadata?.original_content?.substring(0, 100) || 'LEER'
      // })
      
      // Chunk-Daten zusammenstellen
      const chunkData = {
        ...node.data,
        id: node.id,
        content: node.data.content || node.data.metadata?.original_content || 'Kein Inhalt verfügbar'
      }
      
      // console.log('✅ Setze selectedChunk:', {
      //   id: chunkData.id,
      //   hasContent: !!chunkData.content,
      //   contentLength: chunkData.content?.length
      // })
      
      setSelectedChunk(chunkData)
      setShowFactsPanel(true)
    } else {
      // Fakten-Panel schließen wenn anderer Node geklickt wird
      setShowFactsPanel(false)
      setSelectedChunk(null)
    }
  }, [onNodeSelect])

  // Komponente laden beim Mount
  useEffect(() => {
    // console.log('🚀 useEffect triggered - loading graph data')
    if (knowledgeBaseId) {
      loadGraphData()
    } else {
      // console.log('⚠️ Keine Knowledge Base ID - zeige Test-Daten')
      // Test-Daten falls keine ID vorhanden
      setNodes([
        {
          id: 'test-1',
          type: 'custom',
          position: { x: 100, y: 100 },
          data: { label: 'Test Knoten 1', type: 'knowledge-item' as NodeType, id: 'test-1' },
          draggable: true,
        },
        {
          id: 'test-2',
          type: 'custom',
          position: { x: 300, y: 200 },
          data: { label: 'Test Knoten 2', type: 'knowledge-item' as NodeType, id: 'test-2' },
          draggable: true,
        }
      ])
      setEdges([
        {
          id: 'test-edge',
          source: 'test-1',
          target: 'test-2',
          type: 'smoothstep',
          animated: false,
          data: { type: 'similarity', strength: 0.5, label: 'Test' }
        }
      ])
      setLoading(false)
    }
  }, [loadGraphData, knowledgeBaseId])

  // Ausgewählten Knoten hervorheben
  useEffect(() => {
    if (selectedItemId) {
      setNodes(nodes => 
        nodes.map(node => ({
          ...node,
          selected: node.id === selectedItemId
        }))
      )
    }
  }, [selectedItemId, setNodes])

  if (loading) {
    return (
      <Card className="w-full" style={{ height }}>
        <CardContent className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <Network className="animate-spin" size={32} />
            <div className="text-center">
              <div className="font-medium">Graph wird geladen...</div>
              <div className="text-sm text-gray-400 mt-1">Analysiere Wissensbeziehungen</div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Zeige Meldung wenn keine Daten vorhanden
  if (nodes.length === 0 && !loading) {
    return (
      <Card className="w-full" style={{ height }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Network size={20} />
            Wissens-Graph
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <Network size={32} />
            <div className="text-center">
              <div className="font-medium">Keine Wissenseinträge gefunden</div>
              <div className="text-sm text-gray-400 mt-1">
                Laden Sie zuerst Dokumente in diese Wissensdatenbank hoch
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <TooltipProvider>
      <Card className="w-full" style={{ height }}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Network size={20} />
              Wissens-Graph
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{graphStats.nodes} Knoten</Badge>
              <Badge variant="secondary">{graphStats.edges} Verbindungen</Badge>
            </div>
          </div>
          
          {/* Filter-Leiste */}
          <div className="flex items-center gap-2 pt-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Knoten suchen..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={filterType} onValueChange={(value: NodeType | 'all') => setFilterType(value)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Typen</SelectItem>
                <SelectItem value="document">📁 Dokumente</SelectItem>
                <SelectItem value="knowledge-item">📄 Chunks</SelectItem>
                <SelectItem value="concept">🧠 Konzepte</SelectItem>
                <SelectItem value="topic">🏷️ Themen</SelectItem>
              </SelectContent>
            </Select>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMinimap(!showMinimap)}
                >
                  <Settings size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Minimap {showMinimap ? 'ausblenden' : 'anzeigen'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fitView({ padding: 50, duration: 800 })}
                >
                  <Info size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Ansicht anpassen
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="flex" style={{ height: `calc(${height} - 120px)` }}>
            {/* Hauptbereich für ReactFlow */}
            <div className={cn("transition-all duration-300", showFactsPanel ? "w-2/3" : "w-full")}>
              <ReactFlow
                nodes={filteredNodes}
                edges={filteredEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                connectionMode={ConnectionMode.Loose}
                fitView
                fitViewOptions={{
                  padding: 50,
                }}
                className="bg-gray-50"
              >
                <Controls position="bottom-left" />
                {showMinimap && (
                  <MiniMap 
                    position="bottom-right"
                    nodeColor={(node) => NODE_COLORS[node.data.type as NodeType]}
                    className="bg-white border border-gray-200 rounded"
                  />
                )}
                <Background variant="dots" gap={20} size={1} />
              </ReactFlow>
            </div>

            {/* Fakten-Panel (rechte Seite) */}
            {showFactsPanel && selectedChunk && (
              <div className="w-1/3 border-l border-gray-200 bg-white p-4 overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <FileText size={20} className="text-primary" />
                    Chunk Details
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFactsPanel(false)}
                  >
                    ✕
                  </Button>
                </div>

                {/* Chunk Info */}
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <div className="font-medium text-sm text-gray-700 mb-1">Chunk:</div>
                  <div className="text-sm text-gray-900">{selectedChunk.label}</div>
                  <div className="text-xs text-gray-500 mt-1 space-y-1">
                    <div>📏 {selectedChunk.content?.length || 0} Zeichen</div>
                    <div>🆔 {selectedChunk.id.substring(0, 8)}...</div>
                    <div>📊 Fakten: {selectedChunk.metadata?.facts?.length || 0}</div>
                    <div>💾 Hat Inhalt: {selectedChunk.content ? '✅' : '❌'}</div>
                    {selectedChunk.content && (
                      <div className="mt-2 p-2 bg-white rounded text-xs">
                        <div className="font-medium mb-1">Inhalt (Vorschau):</div>
                        <div className="text-gray-600 max-h-20 overflow-y-auto">
                          {selectedChunk.content.substring(0, 200)}...
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Fakten Liste */}
                {selectedChunk.metadata?.facts && selectedChunk.metadata.facts.length > 0 ? (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <Info size={16} className="text-pink-500" />
                      Fakten ({selectedChunk.metadata.facts.length})
                    </h4>
                    <div className="space-y-3">
                      {selectedChunk.metadata.facts.map((fact: any, index: number) => (
                        <div key={fact.id} className="p-3 bg-gray-50 rounded-lg border-l-4 border-pink-500">
                          <div className="font-medium text-sm text-gray-700 mb-1">
                            Fakt {index + 1}{fact.fact_type ? ` · ${String(fact.fact_type)}` : ''}
                          </div>
                          <div className="text-sm text-gray-900 leading-relaxed">
                            {fact.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-500">
                    <Info size={24} className="mx-auto mb-2 text-gray-400" />
                    <div className="text-sm mb-2">Keine Fakten für diesen Chunk gefunden</div>
                    <div className="text-xs text-gray-400 space-y-1 text-left">
                      <div className="font-medium">Debug-Info:</div>
                      <div>• Content verfügbar: {selectedChunk.content ? '✅' : '❌'}</div>
                      <div>• Content-Länge: {selectedChunk.content?.length || 0} Zeichen</div>
                      <div>• Metadaten vorhanden: {selectedChunk.metadata ? '✅' : '❌'}</div>
                      <div>• Fakten-Array: {selectedChunk.metadata?.facts ? `✅ (${selectedChunk.metadata.facts.length})` : '❌'}</div>
                      {selectedChunk.content && selectedChunk.content !== 'Kein Inhalt verfügbar' && (
                        <div className="mt-2 p-2 bg-gray-100 rounded">
                          <div className="font-medium">Content (erste 150 Zeichen):</div>
                          <div className="text-gray-600 text-xs break-words">
                            "{selectedChunk.content.substring(0, 150)}..."
                          </div>
                        </div>
                      )}
                      {(!selectedChunk.content || selectedChunk.content === 'Kein Inhalt verfügbar') && (
                        <div className="mt-2 p-2 bg-muted/20 rounded text-muted-foreground">
                          Chunk-Inhalt ist leer oder nicht verfügbar
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}

// Äußere Komponente mit ReactFlowProvider
export default function KnowledgeGraphVisualization(props: KnowledgeGraphProps) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphContent {...props} />
    </ReactFlowProvider>
  )
}