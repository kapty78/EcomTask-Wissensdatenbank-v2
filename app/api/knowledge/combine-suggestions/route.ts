import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

interface KnowledgeItemRow {
  id: string
  content: string
  source_chunk: string | null
  source_name: string
  created_at: string | null
  document_id: string | null
}

interface DocumentChunkRow {
  id: string
  content: string | null
  document_id: string
  content_position: number | null
}

interface DocumentRow {
  id: string
  title: string | null
  file_name: string
}

type EntryType = 'document_chunk' | 'manual_entry'

interface EntryForModel {
  id: string
  type: EntryType
  displayName: string
  documentTitle: string | null
  content: string
  knowledgeItemIds: string[]
  createdAt: string | null
  wordCount: number
}

interface CombineSuggestionNode {
  nodeId: string
  chunkId: string | null
  type: 'document' | 'text'
  sourceName: string
  documentId: string | null
  documentTitle?: string | null
  knowledgeItemCount: number
  knowledgeItemIds: string[]
  contentPreview: string
  contentFull?: string
  contentLength: number
  createdAt: string | null
  isPrimary: boolean
}

interface CombineSuggestion {
  id: string
  topic: string
  summary: string
  similarityScore: number
  newChunkPreview: string
  nodes: CombineSuggestionNode[]
}

const MAX_ENTRIES_FOR_MODEL = 30 // Kleinere Batches für schnellere Verarbeitung
const MAX_CONTENT_LENGTH = 3000 // Kürzer für schnellere Verarbeitung
const MAX_PREVIEW_LENGTH = 280
const MAX_SUGGESTIONS = 25
const MAX_PROCESSING_TIME = 45000 // 45 Sekunden, 15s Buffer für Vercel

function sanitizeContent(content: string | null | undefined, limit = MAX_CONTENT_LENGTH): string {
  if (!content) return ''
  const trimmed = content.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= limit) {
    return trimmed
  }
  return trimmed.slice(0, limit) + ' …'
}

function createPreview(content: string): string {
  return sanitizeContent(content, MAX_PREVIEW_LENGTH)
}

function clampConfidence(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 0.85
  return Math.min(Math.max(num, 0), 1)
}

function extractJsonObject(text: string): any {
  // Versuche direktes Parsing
  try {
    return JSON.parse(text)
  } catch (firstError) {
    // Extrahiere JSON zwischen ```json und ``` falls vorhanden
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim())
      } catch {}
    }
    
    // Suche nach { ... } Block
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {}
    }
    
    // Versuche trailing commas zu entfernen (häufiger Fehler)
    const cleaned = text
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .trim()
    
    try {
      return JSON.parse(cleaned)
    } catch {}
    
    console.error('[extractJsonObject] Failed to parse, original error:', firstError)
    console.error('[extractJsonObject] Text preview:', text.substring(0, 500))
    throw new Error('Antwort konnte nicht als JSON geparst werden.')
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const knowledgeBaseId = body?.knowledgeBaseId as string | undefined

    if (!knowledgeBaseId) {
      return NextResponse.json({ error: 'knowledgeBaseId ist erforderlich' }, { status: 400 })
    }
    
    console.log('[combine-suggestions] Started analysis at:', new Date().toISOString())

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: knowledgeItems, error: knowledgeError } = await supabase
      .from('knowledge_items')
      .select('id, content, source_chunk, source_name, created_at, document_id')
      .eq('knowledge_base_id', knowledgeBaseId)
      .order('created_at', { ascending: true })

    if (knowledgeError) {
      console.error('[combine-suggestions] Fehler beim Laden der Knowledge Items:', knowledgeError)
      return NextResponse.json(
        { error: 'Knowledge Items konnten nicht geladen werden' },
        { status: 500 }
      )
    }

    if (!knowledgeItems || knowledgeItems.length === 0) {
      return NextResponse.json({
        suggestions: [],
        meta: {
          knowledgeBaseId,
          totalEntriesConsidered: 0,
          generatedAt: new Date().toISOString()
        }
      })
    }

    const chunkFactMap = new Map<string, string[]>()
    const manualKnowledgeItems: KnowledgeItemRow[] = []
    const chunkIds: Set<string> = new Set()

    for (const item of knowledgeItems as KnowledgeItemRow[]) {
      if (item.source_chunk) {
        chunkIds.add(item.source_chunk)
        const list = chunkFactMap.get(item.source_chunk) || []
        list.push(item.id)
        chunkFactMap.set(item.source_chunk, list)
      } else {
        manualKnowledgeItems.push(item)
      }
    }

    const chunkIdArray = Array.from(chunkIds)

    let chunkRows: DocumentChunkRow[] = []
    let documentRows: DocumentRow[] = []

    if (chunkIdArray.length > 0) {
      const { data: chunksData, error: chunkError } = await supabase
        .from('document_chunks')
        .select('id, content, document_id, content_position')
        .in('id', chunkIdArray)

      if (chunkError) {
        console.error('[combine-suggestions] Fehler beim Laden der Document Chunks:', chunkError)
      } else if (chunksData) {
        chunkRows = chunksData as DocumentChunkRow[]

        const documentIds = Array.from(new Set(chunkRows.map(chunk => chunk.document_id)))
        if (documentIds.length > 0) {
          const { data: docsData, error: docsError } = await supabase
            .from('documents')
            .select('id, title, file_name')
            .in('id', documentIds)

          if (docsError) {
            console.error('[combine-suggestions] Fehler beim Laden der Dokumente:', docsError)
          } else if (docsData) {
            documentRows = docsData as DocumentRow[]
          }
        }
      }
    }

    const chunkMap = new Map<string, DocumentChunkRow>(chunkRows.map(chunk => [chunk.id, chunk]))
    const documentMap = new Map<string, DocumentRow>(documentRows.map(doc => [doc.id, doc]))

    const entries: EntryForModel[] = []
    const documentNodeMap = new Map<string, CombineSuggestionNode>()
    const manualNodeMap = new Map<string, CombineSuggestionNode>()

    const allChunkIdsSorted = chunkRows
      .slice()
      .sort((a, b) => (a.content_position ?? 0) - (b.content_position ?? 0))

    for (const chunk of allChunkIdsSorted) {
      const doc = documentMap.get(chunk.document_id)
      const displayName = doc?.title || doc?.file_name || `Chunk ${chunk.id.slice(0, 8)}`
      const content = sanitizeContent(chunk.content)
      const knowledgeItemIds = chunkFactMap.get(chunk.id) || []

      const entry: EntryForModel = {
        id: chunk.id,
        type: 'document_chunk',
        displayName,
        documentTitle: doc?.title || doc?.file_name || null,
        content,
        knowledgeItemIds,
        createdAt: null,
        wordCount: content.split(/\s+/).length
      }

      entries.push(entry)

      documentNodeMap.set(chunk.id, {
        nodeId: `document:${chunk.id}`,
        chunkId: chunk.id,
        type: 'document',
        sourceName: displayName,
        documentId: chunk.document_id,
        documentTitle: doc?.title || doc?.file_name || null,
        knowledgeItemCount: knowledgeItemIds.length,
        knowledgeItemIds,
        contentPreview: createPreview(content),
        contentFull: content,
        contentLength: content.length,
        createdAt: null,
        isPrimary: false
      })
    }

    for (const manualItem of manualKnowledgeItems) {
      const displayName = manualItem.source_name || 'Text-Upload'
      const content = sanitizeContent(manualItem.content, MAX_CONTENT_LENGTH / 2)

      const entry: EntryForModel = {
        id: manualItem.id,
        type: 'manual_entry',
        displayName,
        documentTitle: null,
        content,
        knowledgeItemIds: [manualItem.id],
        createdAt: manualItem.created_at,
        wordCount: content.split(/\s+/).length
      }

      entries.push(entry)

      manualNodeMap.set(manualItem.id, {
        nodeId: `text:${manualItem.id}`,
        chunkId: null,
        type: 'text',
        sourceName: displayName,
        documentId: null,
        documentTitle: null,
        knowledgeItemCount: 1,
        knowledgeItemIds: [manualItem.id],
        contentPreview: createPreview(content),
        contentFull: content,
        contentLength: content.length,
        createdAt: manualItem.created_at,
        isPrimary: false
      })
    }

    if (entries.length === 0) {
      return NextResponse.json({
        suggestions: [],
        meta: {
          knowledgeBaseId,
          totalEntriesConsidered: 0,
          generatedAt: new Date().toISOString()
        }
      })
    }

    console.log(`[combine-suggestions] Total entries: ${entries.length}, processing in batches of ${MAX_ENTRIES_FOR_MODEL}`)
    
    // Verarbeite ALLE Einträge in Batches statt nur ersten MAX_ENTRIES_FOR_MODEL
    const allRawSuggestions: any[] = []
    const batchCount = Math.ceil(entries.length / MAX_ENTRIES_FOR_MODEL)
    
    for (let batchIdx = 0; batchIdx < batchCount; batchIdx++) {
      // Timeout-Check
      if (Date.now() - startTime > MAX_PROCESSING_TIME) {
        console.log(`[combine-suggestions] Timeout erreicht bei Batch ${batchIdx + 1}/${batchCount}, breche ab`)
        break
      }
      
      const batchStart = batchIdx * MAX_ENTRIES_FOR_MODEL
      const batchEnd = Math.min(batchStart + MAX_ENTRIES_FOR_MODEL, entries.length)
      const batchEntries = entries.slice(batchStart, batchEnd)
      
      console.log(`[combine-suggestions] Batch ${batchIdx + 1}/${batchCount}: Einträge ${batchStart + 1}-${batchEnd}`)
      
      const payloadForModel = JSON.stringify({ entries: batchEntries }, null, 2)

    const systemPrompt = `
Du bist ein Senior-Wissenskurator für ein vektorbasiertes KI-Retrieval-System.

SYSTEMARCHITEKTUR (entscheidend für deine Empfehlungen):
Diese Wissensdatenbank versorgt KI-Agenten mit Kontext. Der genaue Ablauf:
1. Ein Agent erhält eine Kundenanfrage und generiert 5 präzise Suchfragen
2. Jede Frage wird zu einem 1536-dimensionalen Embedding-Vektor (OpenAI text-embedding-3-small)
3. Diese 5 Vektoren werden via Kosinus-Ähnlichkeit mit allen gespeicherten knowledge_item-Embeddings verglichen
4. Die 5–6 ähnlichsten Einträge ("knowledge_items") werden in den Agenten-Kontext geladen
5. Der Agent beantwortet die Anfrage AUSSCHLIESSLICH basierend auf diesen abgerufenen Fakten

WIE CHUNKS ZU KNOWLEDGE_ITEMS WERDEN:
Jeder Chunk wird nach dem Speichern automatisch in atomare "knowledge_items" (Fakten + Fragen) zerlegt.
Jedes knowledge_item erhält EIN Embedding, das bestimmt, wann dieser Fakt abgerufen wird.

DAS KERNPROBLEM MIT REDUNDANTEN CHUNKS:
- Redundante Fakten aus verschiedenen Chunks belegen mehrere "Slots" im Top-5/6-Ergebnis
- Dadurch verdrängen sie andere, möglicherweise wichtigere Fakten aus dem Kontext
- Bei wachsender Datenbank erhöht Redundanz den "Rauschen im Embedding-Raum" → schlechtere Retrieval-Präzision
- Außerdem können leicht abweichende Formulierungen desselben Fakts zu Konflikten im Agentenantwort führen

DEINE AUFGABE – Finde Chunks, die WIRKLICH zusammengeführt werden sollten:

ZUSAMMENFÜHREN IST SINNVOLL wenn:
• Zwei Chunks das GLEICHE enge Unter-Thema behandeln (z.B. beide über "Rückgabefristen Standardversand")
• Die Chunks inhaltlich redundant sind (gleiche Fakten, unterschiedliche Formulierungen)
• Das Zusammenführen ein kompakteres, einheitlicheres Wissen erzeugt (optimal: 3–8 klare Fakten pro Chunk)
• Chunks aus demselben Dokument stammen und thematisch direkt aufeinanderfolgen

ZUSAMMENFÜHREN IST NICHT SINNVOLL wenn:
• Chunks zwar dasselbe Oberthema haben, aber verschiedene Aspekte/Attribute abdecken
  (z.B. "Preise" und "Lieferbedingungen" gehören NICHT zusammen — ein Agent, der nach Preisen fragt, braucht keine Lieferinfos)
• Das Zusammenführen einen Mega-Chunk mit 10+ verschiedenen Fakten erzeugen würde
  → Zu breite Chunks = unspezifische Embeddings = schlechtere Retrieval-Präzision
• Chunks verschiedene Dokumente betreffen, die inhaltlich eigenständig bleiben sollen

WÄHLE DEN PRIMARY CHUNK nach diesen Kriterien (in dieser Priorität):
1. Vollständigster Inhalt (enthält die meisten konkreten Fakten)
2. Höchste Anzahl an knowledge_items (facts_count)
3. Längster Content bei gleicher Qualität

WICHTIG - JSON FORMAT:
- Antworte AUSSCHLIESSLICH mit validem JSON (keine Markdown-Blöcke, kein Text davor/danach)
- Keine trailing commas
- Nutze diese exakte Struktur:

{
  "suggestions": [
    {
      "topic": "Enger Themenname (z.B. 'Rückgabefristen Standardversand')",
      "summary": "Begründung: Warum sind diese Chunks redundant?",
      "primary_chunk_id": "chunk-id-hier",
      "merge_chunk_ids": ["andere-chunk-id"],
      "manual_knowledge_item_ids": [],
      "new_chunk_preview": "Kompakter Vorschau-Text des Ergebnisses (max 100 Zeichen)...",
      "confidence": 0.85
    }
  ]
}

REGELN:
- Wenn du KEINE wirklich redundanten Gruppen findest, gib zurück: {"suggestions": []}
- Maximal ${MAX_SUGGESTIONS} Vorschläge
- primary_chunk_id muss vom type "document_chunk" sein
- Confidence zwischen 0.5 und 1.0
- QUALITÄT über QUANTITÄT: Lieber 2 echte Redundanzen als 8 lose thematische Verbindungen
- ENGE THEMEN bevorzugen: "Rückgabe mit Quittung" und "Rückgabe ohne Quittung" = NICHT zusammenführen (verschiedene Kontexte!)
`.trim()

    console.log('[combine-suggestions] Sending to OpenAI, elapsed:', Date.now() - startTime, 'ms')
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analysiere die folgenden Einträge und liefere passende Kombinationsvorschläge. 
          
WICHTIG: Halte new_chunk_preview SEHR KURZ (max 100 Zeichen), damit das JSON nicht zu groß wird.

${payloadForModel}` }
        ],
        max_tokens: 3000 // Erhöht, damit JSON nicht mittendrin abbricht
      })
    })
    
      console.log(`[combine-suggestions] OpenAI responded for batch ${batchIdx + 1}, elapsed:`, Date.now() - startTime, 'ms')

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[combine-suggestions] OpenAI Fehler in Batch ${batchIdx + 1}:`, response.status, errorText)
        continue // Skip diesen Batch, mache mit nächstem weiter
      }

      const aiResult = await response.json()
      const aiText = aiResult?.choices?.[0]?.message?.content

      if (!aiText) {
        console.warn(`[combine-suggestions] Batch ${batchIdx + 1}: Leere Antwort, überspringe`)
        continue
      }

      let parsedSuggestions: any

      try {
        parsedSuggestions = extractJsonObject(aiText.trim())
      } catch (error) {
        console.error(`[combine-suggestions] Batch ${batchIdx + 1}: JSON Parsing Fehler:`, error)
        console.error(`[combine-suggestions] Batch ${batchIdx + 1}: AI Response (first 1000 chars):`, aiText.substring(0, 1000))
        continue // Skip diesen Batch
      }

      const batchSuggestions = Array.isArray(parsedSuggestions?.suggestions)
        ? parsedSuggestions.suggestions
        : []
      
      console.log(`[combine-suggestions] Batch ${batchIdx + 1}: ${batchSuggestions.length} Vorschläge gefunden`)
      allRawSuggestions.push(...batchSuggestions)
    }
    
    console.log(`[combine-suggestions] Alle Batches verarbeitet, insgesamt ${allRawSuggestions.length} Vorschläge, elapsed:`, Date.now() - startTime, 'ms')
    
    // Jetzt alle gesammelten Vorschläge verarbeiten
    const suggestions: CombineSuggestion[] = []

    for (const suggestion of allRawSuggestions) {
      const primaryChunkId = suggestion?.primary_chunk_id
      const mergeChunkIds: string[] = Array.isArray(suggestion?.merge_chunk_ids)
        ? suggestion.merge_chunk_ids.filter((id: unknown) => typeof id === 'string')
        : []
      const manualIds: string[] = Array.isArray(suggestion?.manual_knowledge_item_ids)
        ? suggestion.manual_knowledge_item_ids.filter((id: unknown) => typeof id === 'string')
        : []

      if (!primaryChunkId || !documentNodeMap.has(primaryChunkId)) {
        continue
      }

      const primaryNode = documentNodeMap.get(primaryChunkId)
      if (!primaryNode) continue

      const nodes: CombineSuggestionNode[] = []
      nodes.push({ ...primaryNode, isPrimary: true })

      const addedNodeIds = new Set<string>([primaryNode.nodeId])

      for (const chunkId of mergeChunkIds) {
        const node = documentNodeMap.get(chunkId)
        if (node && !addedNodeIds.has(node.nodeId)) {
          nodes.push({ ...node, isPrimary: false })
          addedNodeIds.add(node.nodeId)
        }
      }

      for (const manualId of manualIds) {
        const node = manualNodeMap.get(manualId)
        if (node && !addedNodeIds.has(node.nodeId)) {
          nodes.push({ ...node, isPrimary: false })
          addedNodeIds.add(node.nodeId)
        }
      }

      if (nodes.length <= 1) {
        continue
      }

      const topic: string = typeof suggestion?.topic === 'string' && suggestion.topic.trim()
        ? suggestion.topic.trim()
        : `Kombination für ${primaryNode.sourceName}`

      const summary: string = typeof suggestion?.summary === 'string' && suggestion.summary.trim()
        ? suggestion.summary.trim()
        : 'Ähnliche Informationen werden in einem Haupt-Chunk zusammengeführt.'

      const newChunkPreview: string = typeof suggestion?.new_chunk_preview === 'string'
        ? suggestion.new_chunk_preview.trim()
        : ''

      const confidence = clampConfidence(suggestion?.confidence)

      suggestions.push({
        id: `combine_${primaryChunkId}_${nodes.length}_${Math.random().toString(36).slice(2, 8)}`,
        topic,
        summary,
        similarityScore: confidence,
        newChunkPreview,
        nodes
      })
    }

    const totalTime = Date.now() - startTime
    console.log('[combine-suggestions] Completed successfully in', totalTime, 'ms')
    
    return NextResponse.json({
      suggestions,
      meta: {
        knowledgeBaseId,
        totalEntriesConsidered: entries.length,
        processingTimeMs: totalTime,
        generatedAt: new Date().toISOString()
      }
    })
  } catch (error) {
    const totalTime = Date.now() - startTime
    console.error('[combine-suggestions] Fehler nach', totalTime, 'ms:', error)
    return NextResponse.json(
      { error: 'Kombinations-Vorschläge konnten nicht erstellt werden' },
      { status: 500 }
    )
  }
}

