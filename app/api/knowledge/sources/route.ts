import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/utils/logger'

interface SourcesRequest {
  knowledge_base_id: string
}

type SourceChunkSummary = {
  id: string
  position: number | null
  factsCount: number
  questionsCount: number
}

type SourceDocumentSummary = {
  id: string
  name: string
  chunkCount: number
  totalFacts: number
  totalQuestions: number
  chunks: SourceChunkSummary[]
  isLegacy?: boolean
}

type SourceRow = {
  document_id: string
  document_name: string | null
  chunk_id: string | null
  chunk_position: number | null
  facts_count: number | null
  questions_count: number | null
  chunk_count: number | null
}

type FallbackDocumentRow = {
  id: string
  title: string | null
  file_name: string | null
}

type FallbackChunkRow = {
  id: string
  document_id: string
  content_position: number | null
}

type FallbackKnowledgeItemRow = {
  source_chunk: string | null
  fact_type: string | null
  question: string | null
}

type LegacyKnowledgeItemRow = {
  source_name: string | null
  source_chunk: string | null
  fact_type: string | null
  question: string | null
  document_id: string | null
}

type ItemBasedSourceAccumulator = {
  name: string
  totalFacts: number
  totalQuestions: number
  chunks: Map<string, { factsCount: number; questionsCount: number }>
  documentIds: Set<string>
  hasExplicitSourceName: boolean
}

function getSafeSourceName(name: string | null | undefined): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed || 'Unbekannt'
}

function isQuestionItem(item: { fact_type?: string | null; question?: string | null }): boolean {
  if (item.fact_type === 'question') return true
  return typeof item.question === 'string' && item.question.trim().length > 0
}

async function loadDocumentSourcesFallback(
  supabase: any,
  knowledgeBaseId: string
): Promise<SourceDocumentSummary[]> {
  // documents hat in diesem Schema kein knowledge_base_id.
  // Deshalb ziehen wir Dokument-IDs aus knowledge_items der KB.
  const { data: kbItemRows, error: kbItemRowsError } = await supabase
    .from('knowledge_items')
    .select('document_id')
    .eq('knowledge_base_id', knowledgeBaseId)
    .not('document_id', 'is', null)

  if (kbItemRowsError) {
    throw kbItemRowsError
  }

  const documentIds = Array.from(
    new Set(
      ((kbItemRows as Array<{ document_id: string | null }> | null) || [])
        .map(row => row.document_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  )

  if (documentIds.length === 0) {
    return []
  }

  const { data: documentsData, error: documentsError } = await supabase
    .from('documents')
    .select('id, title, file_name')
    .in('id', documentIds)
    .order('created_at', { ascending: true })

  if (documentsError) {
    throw documentsError
  }

  const docs: FallbackDocumentRow[] = (documentsData as FallbackDocumentRow[] | null) || []

  const { data: chunksData, error: chunksError } = await supabase
    .from('document_chunks')
    .select('id, document_id, content_position')
    .in('document_id', documentIds)

  if (chunksError) {
    throw chunksError
  }

  const chunks: FallbackChunkRow[] = (chunksData as FallbackChunkRow[] | null) || []
  const chunkIds = chunks.map(c => c.id).filter((id): id is string => Boolean(id))
  const chunkStats = new Map<string, { factsCount: number; questionsCount: number }>()

  if (chunkIds.length > 0) {
    const { data: itemsData, error: itemsError } = await supabase
      .from('knowledge_items')
      .select('source_chunk, fact_type, question')
      .eq('knowledge_base_id', knowledgeBaseId)
      .in('source_chunk', chunkIds)

    if (!itemsError && itemsData) {
      ;(itemsData as FallbackKnowledgeItemRow[]).forEach(item => {
        const chunkId = item.source_chunk as string | null
        if (!chunkId) return
        const current = chunkStats.get(chunkId) || { factsCount: 0, questionsCount: 0 }
        current.factsCount += 1
        if (isQuestionItem(item)) current.questionsCount += 1
        chunkStats.set(chunkId, current)
      })
    }
  }

  const chunksByDocument = new Map<string, typeof chunks>()
  chunks.forEach(chunk => {
    const list = chunksByDocument.get(chunk.document_id) || []
    list.push(chunk)
    chunksByDocument.set(chunk.document_id, list)
  })

  return docs.map(doc => {
    const docChunks = chunksByDocument.get(doc.id) || []
    const mappedChunks = docChunks.map(chunk => {
      const stats = chunkStats.get(chunk.id) || { factsCount: 0, questionsCount: 0 }
      return {
        id: chunk.id,
        position: chunk.content_position ?? null,
        factsCount: stats.factsCount,
        questionsCount: stats.questionsCount
      }
    })
    const totalFacts = mappedChunks.reduce((sum, c) => sum + c.factsCount, 0)
    const totalQuestions = mappedChunks.reduce((sum, c) => sum + c.questionsCount, 0)

    return {
      id: doc.id,
      name: getSafeSourceName(doc.title || doc.file_name),
      chunkCount: docChunks.length,
      totalFacts,
      totalQuestions,
      chunks: mappedChunks
    }
  })
}

async function loadLegacySources(
  supabase: any,
  knowledgeBaseId: string,
  knownDocumentIds: Set<string>
): Promise<SourceDocumentSummary[]> {
  const { data: itemsData, error: itemsError } = await supabase
    .from('knowledge_items')
    .select('source_name, source_chunk, fact_type, question, document_id')
    .eq('knowledge_base_id', knowledgeBaseId)
    .not('source_name', 'is', null)

  if (itemsError) {
    throw itemsError
  }

  const legacySourcesMap = new Map<string, {
    name: string
    totalFacts: number
    totalQuestions: number
    chunks: Map<string, { factsCount: number; questionsCount: number }>
  }>()
  const legacyChunkIds = new Set<string>()
  const items: LegacyKnowledgeItemRow[] = (itemsData as LegacyKnowledgeItemRow[] | null) || []

  items.forEach(item => {
    const sourceName = getSafeSourceName(item.source_name as string | null)
    const documentId = item.document_id as string | null
    if (documentId && knownDocumentIds.has(documentId)) {
      return
    }

    const current = legacySourcesMap.get(sourceName) || {
      name: sourceName,
      totalFacts: 0,
      totalQuestions: 0,
      chunks: new Map<string, { factsCount: number; questionsCount: number }>()
    }

    current.totalFacts += 1
    if (isQuestionItem(item)) {
      current.totalQuestions += 1
    }

    const chunkId = item.source_chunk as string | null
    if (chunkId) {
      legacyChunkIds.add(chunkId)
      const chunkStats = current.chunks.get(chunkId) || { factsCount: 0, questionsCount: 0 }
      chunkStats.factsCount += 1
      if (isQuestionItem(item)) {
        chunkStats.questionsCount += 1
      }
      current.chunks.set(chunkId, chunkStats)
    }

    legacySourcesMap.set(sourceName, current)
  })

  const chunkPositionMap = new Map<string, number | null>()
  const chunkIdList = Array.from(legacyChunkIds)

  if (chunkIdList.length > 0) {
    const { data: legacyChunks, error: legacyChunksError } = await supabase
      .from('document_chunks')
      .select('id, content_position')
      .in('id', chunkIdList)

    if (!legacyChunksError && legacyChunks) {
      ;(legacyChunks as Array<{ id: string; content_position: number | null }>).forEach(chunk => {
        chunkPositionMap.set(chunk.id, chunk.content_position ?? null)
      })
    }
  }

  return Array.from(legacySourcesMap.entries()).map(([name, source], index) => {
    const chunks: SourceChunkSummary[] = Array.from(source.chunks.entries())
      .map(([chunkId, stats]) => ({
        id: chunkId,
        position: chunkPositionMap.get(chunkId) ?? null,
        factsCount: stats.factsCount,
        questionsCount: stats.questionsCount
      }))
      .sort((a, b) => {
        const aPos = a.position ?? Number.MAX_SAFE_INTEGER
        const bPos = b.position ?? Number.MAX_SAFE_INTEGER
        return aPos - bPos
      })

    return {
      id: `legacy-${index + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      chunkCount: chunks.length,
      totalFacts: source.totalFacts,
      totalQuestions: source.totalQuestions,
      chunks,
      isLegacy: true
    }
  })
}

function mapRpcRowsToDocuments(rows: SourceRow[] | null | undefined): SourceDocumentSummary[] {
  const documentsMap = new Map<string, SourceDocumentSummary>()
  const sourceRows = rows || []

  sourceRows.forEach(row => {
    if (!row.document_id) return
    const name = getSafeSourceName(row.document_name)
    const existing = documentsMap.get(row.document_id)
    const docEntry: SourceDocumentSummary = existing || {
      id: row.document_id,
      name,
      chunkCount: row.chunk_count || 0,
      totalFacts: 0,
      totalQuestions: 0,
      chunks: [],
      isLegacy: false
    }

    if (row.chunk_id) {
      const factsCount = row.facts_count || 0
      const questionsCount = row.questions_count || 0
      docEntry.chunks.push({
        id: row.chunk_id,
        position: row.chunk_position ?? null,
        factsCount,
        questionsCount
      })
      docEntry.totalFacts += factsCount
      docEntry.totalQuestions += questionsCount
    }

    docEntry.chunkCount = Math.max(docEntry.chunkCount, row.chunk_count || 0)
    documentsMap.set(row.document_id, docEntry)
  })

  return Array.from(documentsMap.values())
}

async function loadItemBasedSourcesFallback(
  supabase: any,
  knowledgeBaseId: string
): Promise<SourceDocumentSummary[]> {
  const { data: itemsData, error: itemsError } = await supabase
    .from('knowledge_items')
    .select('source_name, source_chunk, fact_type, question, document_id')
    .eq('knowledge_base_id', knowledgeBaseId)

  if (itemsError) {
    throw itemsError
  }

  const items: LegacyKnowledgeItemRow[] = (itemsData as LegacyKnowledgeItemRow[] | null) || []
  if (items.length === 0) {
    return []
  }

  const documentIds = Array.from(
    new Set(
      items
        .map(item => item.document_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  )

  const documentNameById = new Map<string, string>()
  if (documentIds.length > 0) {
    try {
      const { data: docsData } = await supabase
        .from('documents')
        .select('id, title, file_name')
        .in('id', documentIds)

      ;((docsData as FallbackDocumentRow[] | null) || []).forEach(doc => {
        documentNameById.set(doc.id, getSafeSourceName(doc.title || doc.file_name))
      })
    } catch (error) {
      logger.error('Fallback source document-name lookup failed', error)
    }
  }

  const chunkIds = Array.from(
    new Set(
      items
        .map(item => item.source_chunk)
        .filter((chunkId): chunkId is string => typeof chunkId === 'string' && chunkId.length > 0)
    )
  )

  const chunkPositionMap = new Map<string, number | null>()
  if (chunkIds.length > 0) {
    try {
      const { data: chunksData } = await supabase
        .from('document_chunks')
        .select('id, content_position')
        .in('id', chunkIds)

      ;((chunksData as Array<{ id: string; content_position: number | null }> | null) || []).forEach(chunk => {
        chunkPositionMap.set(chunk.id, chunk.content_position ?? null)
      })
    } catch (error) {
      logger.error('Fallback source chunk-position lookup failed', error)
    }
  }

  const sourceMap = new Map<string, ItemBasedSourceAccumulator>()

  items.forEach(item => {
    const explicitSource = typeof item.source_name === 'string' && item.source_name.trim().length > 0
    const documentId = typeof item.document_id === 'string' ? item.document_id : null

    const resolvedName = explicitSource
      ? getSafeSourceName(item.source_name)
      : documentId
        ? (documentNameById.get(documentId) || `Dokument ${documentId.slice(0, 8)}`)
        : 'Unbekannt'

    const key = explicitSource
      ? `name:${resolvedName.toLowerCase()}`
      : documentId
        ? `document:${documentId}`
        : `name:${resolvedName.toLowerCase()}`

    const current = sourceMap.get(key) || {
      name: resolvedName,
      totalFacts: 0,
      totalQuestions: 0,
      chunks: new Map<string, { factsCount: number; questionsCount: number }>(),
      documentIds: new Set<string>(),
      hasExplicitSourceName: explicitSource
    }

    current.totalFacts += 1
    if (isQuestionItem(item)) {
      current.totalQuestions += 1
    }

    if (documentId) {
      current.documentIds.add(documentId)
    }

    const chunkId = item.source_chunk
    if (chunkId) {
      const chunkStats = current.chunks.get(chunkId) || { factsCount: 0, questionsCount: 0 }
      chunkStats.factsCount += 1
      if (isQuestionItem(item)) {
        chunkStats.questionsCount += 1
      }
      current.chunks.set(chunkId, chunkStats)
    }

    sourceMap.set(key, current)
  })

  return Array.from(sourceMap.entries()).map(([key, source], index) => {
    const chunks: SourceChunkSummary[] = Array.from(source.chunks.entries())
      .map(([chunkId, stats]) => ({
        id: chunkId,
        position: chunkPositionMap.get(chunkId) ?? null,
        factsCount: stats.factsCount,
        questionsCount: stats.questionsCount
      }))
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))

    const isSingleDocumentSource =
      !source.hasExplicitSourceName &&
      source.documentIds.size === 1

    const singleDocumentId = isSingleDocumentSource
      ? Array.from(source.documentIds)[0]
      : null

    return {
      id: singleDocumentId || `legacy-item-source-${index + 1}-${key.replace(/[^a-z0-9]+/gi, '-')}`,
      name: source.name,
      chunkCount: chunks.length,
      totalFacts: source.totalFacts,
      totalQuestions: source.totalQuestions,
      chunks,
      isLegacy: !singleDocumentId
    }
  })
}

export async function POST(req: NextRequest) {
  try {
    logger.apiCall('/api/knowledge/sources', 'POST')
    
    const json: SourcesRequest = await req.json()
    const { knowledge_base_id } = json
    
    logger.verbose(`Fetching sources for KB: ${knowledge_base_id}`)
    
    if (!knowledge_base_id) {
      logger.warn('Knowledge base ID missing in sources request')
      return NextResponse.json(
        { error: 'Knowledge base ID is required', documents: [], sources: [] },
        { status: 400 }
      )
    }
    
    // Extract auth token from request
    const authHeader = req.headers.get('authorization')
    const authToken = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null
    
    if (!authToken) {
      logger.warn('No authentication token provided')
      return NextResponse.json(
        { error: 'Authentication required', documents: [], sources: [] },
        { status: 401 }
      )
    }
    
    // Initialize Supabase client with auth token
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        },
        global: {
          headers: {
            Authorization: `Bearer ${authToken}`
          }
        }
      }
    )
    
    // Verify user authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      logger.warn('Authentication failed', userError?.message)
      return NextResponse.json(
        { error: 'Authentication failed', documents: [], sources: [] },
        { status: 401 }
      )
    }
    
    // Check if user has access to this knowledge base
    // Note: RLS policies now handle company-wide access automatically
    const { data: kbAccess, error: accessError } = await supabase
      .from('knowledge_bases')
      .select('id, user_id, company_id, sharing')
      .eq('id', knowledge_base_id)
      .single()
    
    if (accessError || !kbAccess) {
      logger.warn('Knowledge base not found or access denied', { 
        error: accessError?.message,
        knowledge_base_id 
      })
      return NextResponse.json(
        { error: 'Knowledge base not found or access denied', documents: [], sources: [] },
        { status: 403 }
      )
    }
    
    logger.verbose('Access to knowledge base verified for sources', {
      kb_id: kbAccess.id,
      sharing: kbAccess.sharing
    })
    
    // Get documents + chunk/fact stats via RPC
    const { data: rows, error: sourcesError } = await supabase
      .rpc('get_kb_document_chunk_stats', {
        p_knowledge_base_id: knowledge_base_id
      })

    let documents: SourceDocumentSummary[] = []

    if (sourcesError) {
      logger.warn('RPC get_kb_document_chunk_stats nicht verfügbar/fehlerhaft, nutze Fallback-Query', {
        code: sourcesError.code,
        message: sourcesError.message
      })
      try {
        documents = await loadDocumentSourcesFallback(supabase, knowledge_base_id)
      } catch (fallbackError: any) {
        logger.error('Document fallback sources query failed', {
          message: fallbackError?.message || fallbackError
        })
        documents = []
      }
    } else {
      documents = mapRpcRowsToDocuments(rows as SourceRow[] | null)
      if (documents.length === 0) {
        logger.warn('RPC lieferte keine Dokumente, nutze Fallback-Query')
        try {
          documents = await loadDocumentSourcesFallback(supabase, knowledge_base_id)
        } catch (fallbackError: any) {
          logger.error('Document fallback sources query failed after empty RPC result', {
            message: fallbackError?.message || fallbackError
          })
          documents = []
        }
      }
    }

    const knownDocumentIds = new Set(documents.map(doc => doc.id))
    let legacySources: SourceDocumentSummary[] = []

    try {
      legacySources = await loadLegacySources(supabase, knowledge_base_id, knownDocumentIds)
    } catch (legacyError: any) {
      logger.error('Legacy sources aggregation failed', legacyError?.message || legacyError)
    }

    const documentNameSet = new Set(documents.map(doc => doc.name.toLowerCase()))
    const mergedSources = [
      ...documents,
      ...legacySources.filter(source => !documentNameSet.has(source.name.toLowerCase()))
    ].sort((a, b) => a.name.localeCompare(b.name))

    let finalSources = mergedSources

    if (finalSources.length === 0) {
      logger.warn('No sources after RPC/document/legacy aggregation, using item-based fallback')
      try {
        finalSources = await loadItemBasedSourcesFallback(supabase, knowledge_base_id)
      } catch (itemFallbackError: any) {
        logger.error('Item-based source fallback failed', {
          message: itemFallbackError?.message || itemFallbackError
        })
      }
    }

    logger.verbose(`Found ${finalSources.length} total sources`, {
      documentSources: documents.length,
      legacySources: legacySources.length
    })

    return NextResponse.json({
      documents: finalSources,
      sources: finalSources.map(doc => doc.name)
    })
    
  } catch (error: any) {
    logger.apiError('/api/knowledge/sources', 'POST', error)
    return NextResponse.json(
      { error: 'Internal server error', documents: [], sources: [] },
      { status: 500 }
    )
  }
}
