import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { generateEmbeddings } from '@/lib/knowledge-base/embedding'
import { DocumentSearchParams, DocumentSearchResult } from '@/types/cursor-documents'

/**
 * Handles document search requests
 * Supports semantic (vector) search, full-text search, and hybrid search
 */
export async function POST(req: NextRequest) {
  try {
    console.log('Cursor document search API called')
    
    // Parse request JSON
    const json: DocumentSearchParams = await req.json()
    const { query, search_type, workspace_id, limit = 10, threshold = 0.3 } = json
    
    console.log(`Query: "${query}", Type: ${search_type}, Workspace: ${workspace_id || 'all'}`)
    
    if (!query) {
      console.log('No query provided')
      return NextResponse.json(
        { error: 'No query provided', results: [] },
        { status: 400 }
      )
    }
    
    // Extract auth token from request
    const authHeader = req.headers.get('authorization')
    const authToken = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null
    
    if (!authToken) {
      console.log('No authentication token provided')
      return NextResponse.json(
        { error: 'Authentication required', results: [] },
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
      console.log('Unauthorized - User error:', userError)
      return NextResponse.json(
        { error: 'Unauthorized', results: [] },
        { status: 401 }
      )
    }
    
    console.log(`User authenticated: ${user.id}`)
    
    let results: DocumentSearchResult[] = []
    
    // Perform the appropriate search based on the search type
    try {
      if (search_type === 'semantic' || search_type === 'hybrid') {
        // Generate embeddings for the query
        console.log('Generating embeddings for semantic search...')
        const embedding = await generateEmbeddings(query, 'openai')
        
        if (!embedding) {
          console.log('Failed to generate embeddings')
          return NextResponse.json(
            { error: 'Failed to generate embeddings', results: [] },
            { status: 500 }
          )
        }
        
        // Format embedding for database query
        const embeddingString = `[${embedding.join(',')}]`
        
        // Call vector search function
        console.log('Executing vector search...')
        const { data: vectorResults, error: vectorError } = await supabase.rpc(
          'cursor_vector_search',
          {
            p_user_id: user.id,
            p_query_embedding: embeddingString,
            p_match_threshold: threshold,
            p_match_count: limit,
            p_workspace_id: workspace_id || null
          }
        )
        
        if (vectorError) {
          console.error('Vector search error:', vectorError)
          
          // Fallback to local vector search if OpenAI embedding search fails
          console.log('Falling back to local embedding search...')
          const localEmbedding = await generateEmbeddings(query, 'local')
          
          if (localEmbedding) {
            const localEmbeddingString = `[${localEmbedding.join(',')}]`
            
            const { data: localResults, error: localError } = await supabase.rpc(
              'cursor_local_vector_search',
              {
                p_user_id: user.id,
                p_query_embedding: localEmbeddingString,
                p_match_threshold: threshold,
                p_match_count: limit,
                p_workspace_id: workspace_id || null
              }
            )
            
            if (!localError && localResults) {
              console.log(`Local vector search returned ${localResults.length} results`)
              results = [...results, ...localResults]
            } else {
              console.error('Local vector search error:', localError)
            }
          }
        } else if (vectorResults) {
          console.log(`Vector search returned ${vectorResults.length} results`)
          results = [...results, ...vectorResults]
        }
      }
      
      if (search_type === 'fulltext' || search_type === 'hybrid') {
        // Prepare query for text search
        const textQuery = query
          .replace(/[^\w\s]/g, ' ') // Replace special chars with spaces
          .trim()
          .split(/\s+/)
          .filter(term => term.length > 2) // Filter out short terms
          .join(' & ')
        
        if (textQuery) {
          console.log(`Executing full-text search with query: ${textQuery}`)
          
          const { data: textResults, error: textError } = await supabase.rpc(
            'cursor_text_search',
            {
              p_user_id: user.id,
              p_query: textQuery,
              p_match_count: limit,
              p_workspace_id: workspace_id || null
            }
          )
          
          if (!textError && textResults) {
            console.log(`Full-text search returned ${textResults.length} results`)
            // If doing hybrid search, merge results without duplicates
            if (search_type === 'hybrid') {
              // Add text results that aren't already in the results array
              const existingIds = new Set(results.map(r => r.id))
              textResults.forEach((result: DocumentSearchResult) => {
                if (!existingIds.has(result.id)) {
                  results.push(result)
                }
              })
            } else {
              results = textResults
            }
          } else {
            console.error('Full-text search error:', textError)
          }
        }
      }
      
      // Sort results by similarity or rank (depending on search type)
      results.sort((a, b) => {
        if (a.similarity !== undefined && b.similarity !== undefined) {
          return b.similarity - a.similarity
        }
        if (a.rank !== undefined && b.rank !== undefined) {
          return b.rank - a.rank
        }
        return 0
      })
      
      // Limit final results
      results = results.slice(0, limit)
      
      return NextResponse.json({ results })
      
    } catch (error: any) {
      console.error('Search execution error:', error)
      return NextResponse.json(
        { error: `Search execution failed: ${error.message}`, results: [] },
        { status: 500 }
      )
    }
    
  } catch (error: any) {
    console.error('General search API error:', error)
    return NextResponse.json(
      { error: `Search failed: ${error.message}`, results: [] },
      { status: 500 }
    )
  }
} 