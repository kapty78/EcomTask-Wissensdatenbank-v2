import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Vereinfachte Teaser-Funktion
function getTeaser(content: string, maxWords: number): string {
  if (!content) return 'Kein Inhalt'
  const words = content.trim().split(/\s+/)
  const teaser = words.slice(0, maxWords).join(' ')
  return words.length > maxWords ? `${teaser}...` : teaser
}

export async function GET(request: NextRequest) {
  console.log('🔥 Graph-Data API aufgerufen')
  
  try {
    const { searchParams } = new URL(request.url)
    const knowledgeBaseId = searchParams.get('knowledge_base_id')
    
    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: 'Knowledge Base ID ist erforderlich' },
        { status: 400 }
      )
    }

    // Supabase Client mit Service Key
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Knowledge Items laden
    const { data: knowledgeItems, error: itemsError } = await supabase
      .from('knowledge_items')
      .select('id, content, created_at, document_id, source_chunk')
      .eq('knowledge_base_id', knowledgeBaseId)
    
    if (itemsError) {
      return NextResponse.json(
        { error: 'Fehler beim Laden der Knowledge Items', details: itemsError.message },
        { status: 500 }
      )
    }

    // Document Chunks laden 
    const documentIds = [...new Set(knowledgeItems.map(item => item.document_id).filter(Boolean))]
    const { data: documentChunks, error: chunksError } = await supabase
      .from('document_chunks')
      .select('id, content, created_at, document_id')
      .in('document_id', documentIds)
      .order('created_at', { ascending: true })
    
    // Documents laden für echte Dokumentnamen
    const { data: documents, error: documentsError } = await supabase
      .from('documents')
      .select('id, file_name, title')
      .in('id', documentIds)
    
    if (chunksError) {
      return NextResponse.json(
        { error: 'Fehler beim Laden der Document Chunks', details: chunksError.message },
        { status: 500 }
      )
    }

    if (documentsError) {
      console.warn('⚠️ Warnung beim Laden der Documents:', documentsError.message)
      // Weiter ohne echte Dateinamen - verwende Fallback
    }

    console.log('🗂️ Documents geladen:', documents?.length || 0, 'documents für', documentIds.length, 'Dokumente')

    // Gruppiere Chunks nach Dokumenten
    const documentGroups = documentChunks.reduce((groups, chunk) => {
      const docId = chunk.document_id
      if (!groups[docId]) groups[docId] = []
      groups[docId].push(chunk)
      return groups
    }, {} as Record<string, typeof documentChunks>)

    const nodes: any[] = []
    const edges: any[] = []

    // Grid-Layout für Dokumente (2 pro Reihe)
    const documentsPerRow = 2
    const documentEntries = Object.entries(documentGroups)

    // Dynamische Abstände: Skaliere dokumentübergreifend nach größter Chunk-Anzahl
    // Reduziere die globalen Radien leicht, damit Layouts insgesamt kompakter bleiben
    const baseChunkRadius = 1400
    const radiusPerChunk = 160
    const maxChunksAcrossDocs = documentEntries.reduce((max, entry) => {
      const chunksForDoc = (entry[1] as any[]).length
      return Math.max(max, chunksForDoc)
    }, 0)
    const estimatedMaxChunkRadius = baseChunkRadius + (maxChunksAcrossDocs * radiusPerChunk)
    const factRingBuffer = 900 // Puffer für externe Faktenringe
    const docSpacingX = (estimatedMaxChunkRadius * 2) + factRingBuffer
    const docSpacingY = (estimatedMaxChunkRadius * 2) + factRingBuffer

    for (let docIndex = 0; docIndex < documentEntries.length; docIndex++) {
      const [docId, chunks] = documentEntries[docIndex]
      
      // Dokument-Position im Grid
      const row = Math.floor(docIndex / documentsPerRow)
      const col = docIndex % documentsPerRow
      const docX = col * docSpacingX
      const docY = row * docSpacingY

      // Echten Dokumentnamen finden
      const docRecord = documents?.find(d => d.id === docId)
      
      // Fallback: Versuche den Namen aus den ersten Chunks zu extrahieren
      let docName = docRecord?.title || docRecord?.file_name
      if (!docName && chunks.length > 0) {
        // Nehme die ersten Wörter vom ersten Chunk als Dokumentnamen
        const firstChunk = chunks[0]
        if (firstChunk.content) {
          const words = firstChunk.content.trim().split(/\s+/).slice(0, 4)
          docName = words.join(' ') + '...'
        }
      }
      
      // Letzter Fallback
      if (!docName) {
        docName = `Dokument ${docIndex + 1}`
      }
      
      // DYNAMISCHE Chunk-Verteilung: KEINE harte Limitierung – alle Chunks anzeigen
      const numChunks = chunks.length
      
      // Dynamischer Radius: Mehr Chunks = größerer Radius (gedeckelt durch globalen Dokumentabstand)
      const chunkRadius = Math.min(estimatedMaxChunkRadius, baseChunkRadius + (numChunks * radiusPerChunk))
      
      console.log(`📄 Dokument ${docIndex + 1}: "${docName}" (${numChunks} Chunks, Radius: ${chunkRadius}px)`)
      
      // Dokument-Node
      const docNode = {
        id: docId,
        label: docName,
        type: 'document',
        position: { x: docX, y: docY },
        metadata: { 
          document_index: docIndex,
          document_name: docName
        }
      }
      nodes.push(docNode)
      
      for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
        const chunk = chunks[chunkIndex]
        const angle = (chunkIndex / numChunks) * 2 * Math.PI
        const chunkX = docX + Math.cos(angle) * chunkRadius
        const chunkY = docY + Math.sin(angle) * chunkRadius

        // Chunk-Node
        const chunkNode = {
          id: chunk.id,
          label: getTeaser(chunk.content || '', 5),
          type: 'knowledge-item',
          position: { x: chunkX, y: chunkY },
          metadata: { 
            chunk_index: chunkIndex, 
            document_id: docId,
            content: chunk.content || '' // Vollständiger Inhalt für Panel
          }
        }
        nodes.push(chunkNode)

        // Verbindung: Dokument → Chunk
        edges.push({
          id: `doc-${docId}-to-chunk-${chunk.id}`,
          source: docId,
          target: chunk.id,
          type: 'smoothstep'
        })

        // Facts für diesen Chunk laden
        const chunkFacts = knowledgeItems.filter(item => item.source_chunk === chunk.id)
        
        for (let factIndex = 0; factIndex < chunkFacts.length; factIndex++) {
          const fact = chunkFacts[factIndex]
          
          // Multi-Ring-Verteilung für bessere Übersicht
          const factsPerRing = 8 // Maximal 8 Fakten pro Ring
          const ringIndex = Math.floor(factIndex / factsPerRing)
          const positionInRing = factIndex % factsPerRing
          const factsInCurrentRing = Math.min(factsPerRing, chunkFacts.length - ringIndex * factsPerRing)
          
          // Radius abhängig vom Ring (innerer Ring kleiner, äußere Ringe größer)
          const baseRadius = 280
          const ringSpacing = 180
          const factRadius = baseRadius + (ringIndex * ringSpacing)
          
          // Winkel für Position im Ring + Versetzung für äußere Ringe
          const ringOffset = ringIndex * (Math.PI / factsPerRing) // Versetzung zwischen den Ringen
          const factAngle = (positionInRing / factsInCurrentRing) * 2 * Math.PI + ringOffset
          
          const factX = chunkX + Math.cos(factAngle) * factRadius
          const factY = chunkY + Math.sin(factAngle) * factRadius

          // Fact-Node
          const factNode = {
            id: fact.id,
            label: getTeaser(fact.content || '', 4),
            type: 'fact',
            position: { x: factX, y: factY },
            metadata: { 
              fact_index: factIndex, 
              chunk_id: chunk.id,
              content: fact.content || '', // Vollständiger Inhalt für Panel
              fact_type: (fact as any).fact_type || null
            }
          }
          nodes.push(factNode)

          // Verbindung: Chunk → Fact
          edges.push({
            id: `chunk-${chunk.id}-to-fact-${fact.id}`,
            source: chunk.id,
            target: fact.id,
            type: 'smoothstep'
          })
        }
      }
    }

    console.log(`✅ Graph erstellt: ${nodes.length} Nodes, ${edges.length} Edges`)

    const graphData = {
      nodes,
      edges,
      stats: {
        documentCount: documentEntries.length,
        chunkCount: documentChunks.length,
        factCount: knowledgeItems.filter(item => item.source_chunk).length
      }
    }

    return NextResponse.json(graphData)

  } catch (error) {
    console.error('💥 FEHLER in Graph-Data API:', error)
    return NextResponse.json(
      { 
        error: 'Interner Server-Fehler',
        details: error instanceof Error ? error.message : 'Unbekannter Fehler'
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return NextResponse.json({ error: 'POST nicht implementiert' }, { status: 501 })
}