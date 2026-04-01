import { NextRequest, NextResponse } from 'next/server'

// Diese Route nutzt Query-Parameter, Auth-Header und sollte niemals statisch generiert werden
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
import { createClient } from '@supabase/supabase-js'

// Optimiertes Logging-System für die API
const LOG_LEVEL = process.env.API_LOG_LEVEL || 'error'; // 'debug', 'info', 'warn', 'error', 'none'
const PROD_MODE = process.env.NODE_ENV === 'production';

const logger = {
  debug: (message: string, ...data: any[]) => {
    if (LOG_LEVEL === 'debug' && !PROD_MODE) {
      console.debug(`[STATUS-API:DEBUG] ${message}`, ...data);
    }
  },
  info: (message: string, ...data: any[]) => {
    if (['debug', 'info'].includes(LOG_LEVEL) && !PROD_MODE) {
      console.log(`[STATUS-API:INFO] ${message}`, ...data);
    }
  },
  warn: (message: string, ...data: any[]) => {
    if (['debug', 'info', 'warn'].includes(LOG_LEVEL)) {
      console.warn(`[STATUS-API:WARN] ${message}`, ...data);
    }
  },
  error: (message: string, ...data: any[]) => {
    if (['debug', 'info', 'warn', 'error'].includes(LOG_LEVEL)) {
      console.error(`[STATUS-API:ERROR] ${message}`, ...data);
    }
  }
};

/**
 * Handles document status check requests
 * Returns the processing status of a document
 */
export async function GET(req: NextRequest) {
  try {
    logger.debug('Status API called'); // Reduziertes Logging (debug statt info)
    
    // Extract document ID from URL
    const url = new URL(req.url)
    const documentId = url.searchParams.get('document_id')
    
    if (!documentId) {
      logger.warn('No document_id provided');
      return NextResponse.json(
        { error: 'No document_id provided' },
        { status: 400 }
      )
    }
    
    // Extract auth token from request
    const authHeader = req.headers.get('authorization')
    const authToken = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null
    
    if (!authToken) {
      logger.warn('No authentication token provided');
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
      logger.warn('Unauthorized - User error:', userError);
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    logger.debug(`User ${user.id} checking document: ${documentId}`);
    
    // Check if the document exists and belongs to the user
    const { data: document, error: documentError } = await supabase
      .from('documents')
      .select('id, user_id, file_name, file_type, created_at')
      .eq('id', documentId)
      .single()
    
    if (documentError || !document) {
      logger.warn('Document not found or error:', documentError);
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }
    
    // Verify the document belongs to the user
    if (document.user_id !== user.id) {
      logger.warn('Document does not belong to user');
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }
    
    // Get the processing status
    const { data: statusData, error: statusError } = await supabase
      .from('document_processing_status')
      .select('status, progress, error, message, updated_at')
      .eq('document_id', documentId)
      .single()
    
    if (statusError) {
      logger.debug('Status not found or error:', statusError);
      
      // If no status found, check if there are any chunks or extracted knowledge items
      const { count, error: chunksError } = await supabase
        .from('document_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', documentId)

      const { count: knowledgeItemsCount, error: knowledgeItemsError } = await supabase
        .from('knowledge_items')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', documentId)
      
      if (!chunksError && !knowledgeItemsError && count !== null && knowledgeItemsCount !== null) {
        // If chunks OR extracted items exist but no status row, processing is effectively complete.
        if (count > 0 || knowledgeItemsCount > 0) {
          return NextResponse.json({
            document_id: documentId,
            status: 'completed',
            progress: 100,
            message: 'Verarbeitung erfolgreich abgeschlossen.',
            chunks_count: count,
            knowledge_items_count: knowledgeItemsCount,
            document: {
              file_name: document.file_name,
              file_type: document.file_type,
              created_at: document.created_at
            }
          })
        }

        // If document is already older and still has no chunks/items/status, treat as failed to avoid endless loading.
        const createdAtMs = Date.parse(String(document.created_at || ''))
        const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0
        const isStale = ageMs > 10 * 60 * 1000
        if (isStale) {
          return NextResponse.json({
            document_id: documentId,
            status: 'failed',
            progress: 100,
            error: 'Keine verarbeiteten Inhalte gefunden.',
            message: 'Verarbeitung fehlgeschlagen oder unvollständig (keine Chunks/Fakten gefunden).',
            chunks_count: 0,
            knowledge_items_count: 0,
            document: {
              file_name: document.file_name,
              file_type: document.file_type,
              created_at: document.created_at
            }
          })
        }
        
        // Fresh upload without status/chunks/items yet -> still processing.
        return NextResponse.json({
          document_id: documentId,
          status: 'processing',
          progress: 10,
          message: 'Verarbeitung gestartet...',
          chunks_count: 0,
          knowledge_items_count: 0,
          document: {
            file_name: document.file_name,
            file_type: document.file_type,
            created_at: document.created_at
          }
        })
      }
      
      // If fallback checks fail, return generic unknown status.
      return NextResponse.json({
        document_id: documentId,
        status: 'unknown',
        progress: 0,
        message: 'Unbekannter Status',
        document: {
          file_name: document.file_name,
          file_type: document.file_type,
          created_at: document.created_at
        }
      })
    }
    
    // Get chunk + extracted-item count for smarter fallback decisions
    const { count: chunksCount, error: chunksError } = await supabase
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)

    const { count: knowledgeItemsCount, error: knowledgeItemsError } = await supabase
      .from('knowledge_items')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)

    const statusValue = String(statusData.status || 'unknown')
    const processingLikeStates = ['uploading', 'processing', 'embedding', 'facts_extracting', 'facts_saving']
    const isProcessingLike = processingLikeStates.includes(statusValue)
    const hasExtractedData = (chunksError ? 0 : chunksCount || 0) > 0 || (knowledgeItemsError ? 0 : knowledgeItemsCount || 0) > 0
    const updatedAtMs = Date.parse(String(statusData.updated_at || document.created_at || ''))
    const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : 0
    const isStaleProcessing = isProcessingLike && !hasExtractedData && ageMs > 10 * 60 * 1000

    if (isStaleProcessing) {
      return NextResponse.json({
        document_id: documentId,
        status: 'failed',
        progress: 100,
        error: statusData.error || 'Zeitüberschreitung bei der Verarbeitung.',
        message: 'Verarbeitung scheint hängen geblieben zu sein (kein verarbeiteter Inhalt gefunden).',
        updated_at: statusData.updated_at,
        chunks_count: 0,
        knowledge_items_count: 0,
        document: {
          file_name: document.file_name,
          file_type: document.file_type,
          created_at: document.created_at
        }
      })
    }
    
    // Return the status
    return NextResponse.json({
      document_id: documentId,
      status: statusValue,
      progress: statusData.progress,
      error: statusData.error,
      message: statusData.message,
      updated_at: statusData.updated_at,
      chunks_count: chunksError ? 0 : chunksCount,
      knowledge_items_count: knowledgeItemsError ? 0 : knowledgeItemsCount,
      document: {
        file_name: document.file_name,
        file_type: document.file_type,
        created_at: document.created_at
      }
    })
    
  } catch (error: any) {
    logger.error('General status API error:', error);
    return NextResponse.json(
      { error: `Status check failed: ${error.message}` },
      { status: 500 }
    )
  }
} 
