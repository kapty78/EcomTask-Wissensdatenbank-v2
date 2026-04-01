import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

interface SearchRequest {
  knowledge_base_id: string
  search_term?: string
  source_filter?: string
  date_filter?: string
  limit?: number
  offset?: number
}

interface SearchResult {
  id: string
  content: string | null
  question: string | null
  fact_type: string | null
  created_at: string
  updated_at: string | null
  source_chunk: string
  chunk_content: string
  source_name: string
  document_title: string
  total_count: number
}

export async function POST(req: NextRequest) {
  try {
    console.log('Enhanced knowledge search API called')
    
    const json: SearchRequest = await req.json()
    const { 
      knowledge_base_id, 
      search_term = '', 
      source_filter = null, 
      date_filter = null, 
      limit = 100, 
      offset = 0 
    } = json
    
    console.log(`Enhanced search - KB: ${knowledge_base_id}, Term: "${search_term}", Source: ${source_filter}, Date: ${date_filter}`)
    
    if (!knowledge_base_id) {
      console.log('Knowledge base ID missing')
      return NextResponse.json(
        { error: 'Knowledge base ID is required', results: [] },
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
      console.log('Authentication failed:', userError?.message)
      return NextResponse.json(
        { error: 'Authentication failed', results: [] },
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
      console.log('Knowledge base not found or access denied:', accessError?.message)
      return NextResponse.json(
        { error: 'Knowledge base not found or access denied', results: [] },
        { status: 403 }
      )
    }
    
    console.log('Access to knowledge base verified for search', {
      kb_id: kbAccess.id,
      sharing: kbAccess.sharing
    })
    
    console.log(`Calling enhanced search function with params:`, {
      p_knowledge_base_id: knowledge_base_id,
      p_search_term: search_term || null,
      p_source_filter: source_filter,
      p_date_filter: date_filter,
      p_limit: limit,
      p_offset: offset
    })
    
    // Call the enhanced search function
    const { data: searchResults, error: searchError } = await supabase.rpc(
      'search_knowledge_items_in_base',
      {
        p_knowledge_base_id: knowledge_base_id,
        p_search_term: search_term || null,
        p_source_filter: source_filter,
        p_date_filter: date_filter,
        p_limit: limit,
        p_offset: offset
      }
    )
    
    if (searchError) {
      console.error('Enhanced search error:', searchError)
      return NextResponse.json(
        { error: 'Search failed', results: [] },
        { status: 500 }
      )
    }
    
    console.log(`Enhanced search returned ${searchResults?.length || 0} results`)
    
    // Transform results to match expected format
    const results: SearchResult[] = (searchResults || []).map((item: any) => ({
      id: item.id,
      content: item.content,
      question: item.question,
      fact_type: item.fact_type,
      created_at: item.created_at,
      updated_at: item.updated_at,
      source_chunk: item.source_chunk,
      chunk_content: item.chunk_content,
      source_name: item.source_name,
      document_title: item.document_title,
      total_count: item.total_count
    }))
    
    // Get the total count from the first result (all results have the same total_count)
    const totalCount = results.length > 0 ? results[0].total_count : 0
    
    return NextResponse.json({
      results,
      pagination: {
        offset,
        limit,
        total: totalCount,
        hasMore: offset + limit < totalCount
      }
    })
    
  } catch (error: any) {
    console.error('Enhanced search API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', results: [] },
      { status: 500 }
    )
  }
}

