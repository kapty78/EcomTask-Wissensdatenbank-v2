import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

async function cleanupOrphanStructuresForDocuments(
  supabase: any,
  documentIds: string[],
  userId: string
) {
  if (documentIds.length === 0) return

  const { data: chunkRows, error: chunkRowsError } = await supabase
    .from('document_chunks')
    .select('id, document_id')
    .in('document_id', documentIds)

  if (chunkRowsError) {
    throw chunkRowsError
  }

  const chunks = (chunkRows as Array<{ id: string; document_id: string }> | null) || []
  const chunkIds = chunks.map(c => c.id)

  const chunkIdsWithFacts = new Set<string>()
  if (chunkIds.length > 0) {
    const { data: chunkFactsRows, error: chunkFactsError } = await supabase
      .from('knowledge_items')
      .select('source_chunk')
      .in('source_chunk', chunkIds)

    if (chunkFactsError) {
      throw chunkFactsError
    }

    ;((chunkFactsRows as Array<{ source_chunk: string | null }> | null) || []).forEach(row => {
      if (row.source_chunk) {
        chunkIdsWithFacts.add(row.source_chunk)
      }
    })
  }

  const orphanChunkIds = chunkIds.filter(chunkId => !chunkIdsWithFacts.has(chunkId))
  if (orphanChunkIds.length > 0) {
    const { error: deleteOrphanChunksError } = await supabase
      .from('document_chunks')
      .delete()
      .in('id', orphanChunkIds)

    if (deleteOrphanChunksError) {
      throw deleteOrphanChunksError
    }
  }

  const remainingChunkDocIds = new Set<string>()
  if (documentIds.length > 0) {
    const { data: remainingChunksRows, error: remainingChunksError } = await supabase
      .from('document_chunks')
      .select('document_id')
      .in('document_id', documentIds)

    if (remainingChunksError) {
      throw remainingChunksError
    }

    ;((remainingChunksRows as Array<{ document_id: string }> | null) || []).forEach(row => {
      remainingChunkDocIds.add(row.document_id)
    })
  }

  const docsWithDirectFacts = new Set<string>()
  if (documentIds.length > 0) {
    const { data: directFactsRows, error: directFactsError } = await supabase
      .from('knowledge_items')
      .select('document_id')
      .in('document_id', documentIds)

    if (directFactsError) {
      throw directFactsError
    }

    ;((directFactsRows as Array<{ document_id: string | null }> | null) || []).forEach(row => {
      if (row.document_id) {
        docsWithDirectFacts.add(row.document_id)
      }
    })
  }

  const orphanDocumentIds = documentIds.filter(docId => {
    const hasChunks = remainingChunkDocIds.has(docId)
    const hasDirectFacts = docsWithDirectFacts.has(docId)
    return !hasChunks && !hasDirectFacts
  })

  if (orphanDocumentIds.length > 0) {
    const { error: deleteProcessingStatusError } = await supabase
      .from('document_processing_status')
      .delete()
      .in('document_id', orphanDocumentIds)

    if (deleteProcessingStatusError) {
      throw deleteProcessingStatusError
    }

    const { error: deleteDocumentsError } = await supabase
      .from('documents')
      .delete()
      .eq('user_id', userId)
      .in('id', orphanDocumentIds)

    if (deleteDocumentsError) {
      throw deleteDocumentsError
    }
  }
}

/**
 * API route to check if a document title is unique for a user
 * Used during form validation to prevent duplicate titles
 */
export async function POST(req: NextRequest) {
  try {
    // Extract auth token from request
    const authHeader = req.headers.get('authorization')
    const authToken = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null
    
    if (!authToken) {
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Parse request body
    const { title, excludeDocumentId } = await req.json()
    
    if (!title || typeof title !== 'string') {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }
    
    // Trim title for consistency
    const trimmedTitle = title.trim()
    
    if (!trimmedTitle) {
      return NextResponse.json(
        { error: 'Title cannot be empty' },
        { status: 400 }
      )
    }
    
    // Check if title already exists for this user
    let query = supabase
      .from('documents')
      .select('id, title')
      .eq('user_id', user.id)
      .eq('title', trimmedTitle)
    
    // Exclude current document if updating an existing one
    if (excludeDocumentId) {
      query = query.neq('id', excludeDocumentId)
    }
    
    const { data: existingDocs, error: queryError } = await query
    
    if (queryError) {
      console.error('Error checking title uniqueness:', queryError)
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      )
    }
    
    const matchingDocs = (existingDocs as Array<{ id: string; title: string }> | null) || []

    if (matchingDocs.length > 0) {
      try {
        await cleanupOrphanStructuresForDocuments(
          supabase,
          matchingDocs.map(doc => doc.id),
          user.id
        )
      } catch (cleanupError) {
        console.error('Error during orphan cleanup in title uniqueness check:', cleanupError)
      }
    }

    // Re-check after cleanup
    let recheckQuery = supabase
      .from('documents')
      .select('id')
      .eq('user_id', user.id)
      .eq('title', trimmedTitle)

    if (excludeDocumentId) {
      recheckQuery = recheckQuery.neq('id', excludeDocumentId)
    }

    const { data: finalDocs, error: recheckError } = await recheckQuery
    if (recheckError) {
      console.error('Error re-checking title uniqueness:', recheckError)
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      )
    }

    const isUnique = !finalDocs || finalDocs.length === 0
    
    return NextResponse.json({
      isUnique,
      conflictingTitle: isUnique ? null : trimmedTitle,
      message: isUnique 
        ? 'Titel ist verfügbar' 
        : 'Ein Dokument mit diesem Namen existiert bereits'
    })
    
  } catch (error) {
    console.error('Error in check-title-uniqueness API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
