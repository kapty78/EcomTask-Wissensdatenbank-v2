import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/utils/logger'

interface ChunkDetailsRequest {
  chunk_id: string
  knowledge_base_id: string
}

export async function POST(req: NextRequest) {
  try {
    logger.apiCall('/api/knowledge/chunk-details', 'POST')
    
    const json: ChunkDetailsRequest = await req.json()
    const { chunk_id, knowledge_base_id } = json
    
    logger.verbose(`Fetching chunk details for chunk: ${chunk_id}`)
    
    if (!chunk_id) {
      logger.warn('Chunk ID missing in request')
      return NextResponse.json(
        { error: 'Chunk ID is required' },
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
        { error: 'Authentication required' },
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
        { error: 'Authentication failed' },
        { status: 401 }
      )
    }
    
    // First verify user has access to this knowledge base
    // Note: RLS policies now handle company-wide access automatically
    if (knowledge_base_id) {
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
          { error: 'Knowledge base not found or access denied' },
          { status: 403 }
        )
      }
      
      logger.verbose('Access to knowledge base verified', {
        kb_id: kbAccess.id,
        sharing: kbAccess.sharing
      })
    }
    
    // Get chunk details
    logger.verbose(`Fetching chunk with ID: ${chunk_id} for user: ${user.id}`)
    
    const { data: chunkData, error: chunkError } = await supabase
      .from('document_chunks')
      .select('*, documents:document_id(id, user_id, company_id, file_name)')
      .eq('id', chunk_id)
      .single()
    
    if (chunkError) {
      logger.error('Error fetching chunk', {
        chunk_id,
        error: chunkError.message,
        code: chunkError.code,
        details: chunkError.details,
        hint: chunkError.hint,
        user_id: user.id
      })
      return NextResponse.json(
        { 
          error: 'Chunk not found or access denied', 
          details: chunkError.message,
          hint: 'This may be due to Row Level Security policies. Check if you have access to this chunk.'
        },
        { status: 404 }
      )
    }
    
    logger.verbose('Chunk fetched successfully', {
      chunk_id: chunkData.id,
      has_content: !!chunkData.content,
      content_length: chunkData.content?.length || 0,
      document_id: chunkData.document_id,
      company_id: chunkData.company_id
    })
    
    // Get all facts from this chunk (newest first)
    const { data: factsData, error: factsError } = await supabase
      .from('knowledge_items')
      .select('*')
      .eq('source_chunk', chunk_id)
      .order('created_at', { ascending: false })
    
    if (factsError) {
      logger.error('Error fetching facts', {
        chunk_id,
        error: factsError.message,
        code: factsError.code,
        details: factsError.details
      })
      // Don't fail completely if facts can't be loaded, just return empty array
      logger.warn('Continuing with empty facts array')
    }
    
    logger.verbose(`Fetched ${factsData?.length || 0} facts from chunk ${chunk_id}`)
    
    // Get related chunks from the same document if document_id is available
    let relatedChunks = []
    if (chunkData.document_id) {
      const { data: relatedChunksData, error: relatedChunksError } = await supabase
        .from('document_chunks')
        .select('id, content_position, content')
        .eq('document_id', chunkData.document_id)
        .order('content_position', { ascending: true })
      
      if (!relatedChunksError && relatedChunksData) {
        relatedChunks = relatedChunksData
      }
    }
    
    logger.verbose(`Successfully fetched chunk details - Content length: ${chunkData.content?.length || 0}, Facts count: ${factsData?.length || 0}`)
    
    return NextResponse.json({
      chunk: chunkData,
      facts: factsData || [],
      relatedChunks: relatedChunks,
      currentChunkIndex: relatedChunks.findIndex(chunk => chunk.id === chunk_id)
    })
    
  } catch (error: any) {
    logger.apiError('/api/knowledge/chunk-details', 'POST', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
