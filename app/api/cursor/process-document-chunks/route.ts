import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// SERVERLESS-OPTIMIERTE Orchestrierung für Vercel
const ORCHESTRATION_CONFIG = {
  MAX_CONCURRENT_CHUNKS: 3, // Maximale parallele Chunk-Verarbeitung
  CHUNK_PROCESSING_TIMEOUT: 40000, // 40 Sekunden Timeout pro Chunk
  BATCH_SIZE: 1, // Ein Chunk nach dem anderen für maximale Stabilität
  MAX_ORCHESTRATION_TIME: 45000, // 45 Sekunden für eine Orchestrierungs-Runde
  RETRY_ATTEMPTS: 2, // Bis zu 2 Wiederholungsversuche bei Fehlern
  RETRY_DELAY_MS: 2000, // 2 Sekunden Wartezeit zwischen Versuchen
  CONTINUE_PROCESSING: true // Flag für Fortsetzungs-Verarbeitung
};

// Logging für Serverless
const logger = {
  info: (message: string, ...data: any[]) => console.log(`[ORCHESTRATION] ${message}`, ...data),
  warn: (message: string, ...data: any[]) => console.warn(`[ORCHESTRATION] ${message}`, ...data),
  error: (message: string, ...data: any[]) => console.error(`[ORCHESTRATION] ${message}`, ...data)
};

/**
 * Ruft den process-chunk Endpunkt für einen einzelnen Chunk auf
 */
const processChunkRemotely = async (
  chunkId: string,
  documentId: string,
  userId: string,
  knowledgeBaseId: string,
  totalChunks: number,
  chunkIndex: number,
  baseUrl: string, // Neue Parameter für die Base URL
  retryCount = 0
): Promise<{ success: boolean; error?: string; retryable?: boolean }> => {
  try {
    const response = await fetch(`${baseUrl}/api/cursor/process-chunk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documentId,
        chunkId,
        userId,
        knowledgeBaseId,
        apiKey: process.env.API_SECRET_KEY,
        totalChunks,
        chunkIndex
      }),
      signal: AbortSignal.timeout(ORCHESTRATION_CONFIG.CHUNK_PROCESSING_TIMEOUT)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      
      // Prüfe ob Retry sinnvoll ist
      const isRetryable = response.status === 408 || response.status >= 500;
      
      return { 
        success: false, 
        error: errorData.error || `HTTP ${response.status}`,
        retryable: isRetryable
      };
    }

    const result = await response.json();
    return { success: true };

  } catch (error: any) {
    logger.error(`Error processing chunk ${chunkId} (attempt ${retryCount + 1}):`, error.message);
    
    // Verschiedene Fehlertypen behandeln
    let isRetryable = false;
    let errorMessage = error.message;
    
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      isRetryable = true;
      errorMessage = 'Processing timeout';
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      isRetryable = true;
      errorMessage = 'Network error';
    } else if (error.message.includes('ECONNRESET') || error.message.includes('ETIMEDOUT')) {
      isRetryable = true;
      errorMessage = 'Connection error';
    }
    
    return { 
      success: false, 
      error: errorMessage,
      retryable: isRetryable
    };
  }
};

/**
 * Verarbeitet einen Batch von Chunks mit Retry-Logik
 */
const processBatchWithRetry = async (
  chunks: { id: string; index: number }[],
  documentId: string,
  userId: string,
  knowledgeBaseId: string,
  totalChunks: number,
  baseUrl: string
): Promise<{ successful: number; failed: number; errors: string[] }> => {
  let successful = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const chunk of chunks) {
    let success = false;
    let retryCount = 0;
    
    while (!success && retryCount <= ORCHESTRATION_CONFIG.RETRY_ATTEMPTS) {
      const result = await processChunkRemotely(
        chunk.id,
        documentId,
        userId,
        knowledgeBaseId,
        totalChunks,
        chunk.index,
        baseUrl,
        retryCount
      );

      if (result.success) {
        successful++;
        success = true;
        logger.info(`Chunk ${chunk.index + 1}/${totalChunks} processed successfully`);
      } else if (result.retryable && retryCount < ORCHESTRATION_CONFIG.RETRY_ATTEMPTS) {
        retryCount++;
        logger.warn(`Chunk ${chunk.id} failed, retrying (${retryCount}/${ORCHESTRATION_CONFIG.RETRY_ATTEMPTS})`);
        await new Promise(resolve => setTimeout(resolve, ORCHESTRATION_CONFIG.RETRY_DELAY_MS));
      } else {
        failed++;
        errors.push(`Chunk ${chunk.index + 1}: ${result.error}`);
        logger.error(`Chunk ${chunk.id} failed permanently: ${result.error}`);
        break;
      }
    }
  }

  return { successful, failed, errors };
};

/**
 * SERVERLESS-OPTIMIERT: Orchestriert die Verarbeitung aller Chunks eines Dokuments
 * Arbeitet in Batches um unter Vercel Timeout-Limits zu bleiben
 */
export async function POST(req: NextRequest) {
  // Lokale Verarbeitung deaktiviert – Delegation an n8n
  return NextResponse.json({
    error: 'Local processing is disabled. Delegated to n8n workflow.',
  }, { status: 410 });
}

/*
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    // Schnelle Parameter-Extraktion
    const { documentId, userId, knowledgeBaseId, apiKey } = await req.json();
    
    // Bestimme die Base URL aus dem Request
    const host = req.headers.get('host');
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = host ? `${protocol}://${host}` : 'http://localhost:3000';
    
    // Akzeptiere entweder den API Secret Key oder den internen Marker
    const isAuthorized = apiKey === process.env.API_SECRET_KEY || apiKey === 'internal-api-call';
    
    if (!apiKey || !isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!documentId || !userId || !knowledgeBaseId) {
      return NextResponse.json({ 
        error: 'Missing required parameters' 
      }, { status: 400 });
    }

    logger.info(`Starting orchestration for document ${documentId}`);

    // Supabase Admin Client
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Hole alle unverarbeiteten Chunks
    const { data: chunks, error: chunksError } = await supabaseAdmin
      .from('document_chunks')
      .select('id, content_position')
      .eq('document_id', documentId)
      .eq('processing_complete', false)
      .order('content_position');

    if (chunksError) {
      logger.error('Error fetching chunks:', chunksError);
      return NextResponse.json({ 
        error: `Failed to fetch chunks: ${chunksError.message}` 
      }, { status: 500 });
    }

    if (!chunks || chunks.length === 0) {
      logger.info('No unprocessed chunks found');
      return NextResponse.json({ 
        message: 'All chunks already processed',
        processed: 0,
        total: 0
      });
    }

    const totalChunks = chunks.length;
    logger.info(`Found ${totalChunks} unprocessed chunks`);

    // Verarbeite in Batches für serverless Kompatibilität
    let totalProcessed = 0;
    let totalFailed = 0;
    const allErrors: string[] = [];

    for (let i = 0; i < chunks.length; i += ORCHESTRATION_CONFIG.BATCH_SIZE) {
      // Timeout-Check
      if (Date.now() - startTime > ORCHESTRATION_CONFIG.MAX_ORCHESTRATION_TIME) {
        logger.warn('Orchestration timeout reached, stopping processing');
        break;
      }

      const batch = chunks.slice(i, i + ORCHESTRATION_CONFIG.BATCH_SIZE).map((chunk, batchIndex) => ({
        id: chunk.id,
        index: i + batchIndex
      }));

      logger.info(`Processing batch ${Math.floor(i / ORCHESTRATION_CONFIG.BATCH_SIZE) + 1} (chunks ${i + 1}-${Math.min(i + ORCHESTRATION_CONFIG.BATCH_SIZE, chunks.length)})`);

      const batchResult = await processBatchWithRetry(
        batch,
        documentId,
        userId,
        knowledgeBaseId,
        totalChunks,
        baseUrl
      );

      totalProcessed += batchResult.successful;
      totalFailed += batchResult.failed;
      allErrors.push(...batchResult.errors);

      // Pause zwischen Chunks für Stabilität
      if (i + ORCHESTRATION_CONFIG.BATCH_SIZE < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 Sekunde Pause
      }
    }

    // Update document status basierend auf Ergebnissen
    const totalAttempted = totalProcessed + totalFailed;
    const successRate = totalAttempted > 0 ? (totalProcessed / totalAttempted) * 100 : 0;
    
    if (totalProcessed === totalChunks) {
      // Alle Chunks erfolgreich verarbeitet
      await supabaseAdmin
        .from('document_processing_status')
        .upsert({
          document_id: documentId,
          status: 'completed',
          progress: 100,
          message: `Verarbeitung abgeschlossen: ${totalProcessed} Chunks erfolgreich verarbeitet`,
              updated_at: new Date().toISOString()
        });
    } else if (totalProcessed > 0) {
      // Teilweise erfolgreich
      await supabaseAdmin
        .from('document_processing_status')
        .upsert({
          document_id: documentId,
          status: 'processing',
          progress: Math.round((totalProcessed / totalChunks) * 100),
          message: `${totalProcessed}/${totalChunks} Chunks verarbeitet`,
          updated_at: new Date().toISOString()
        });
    } else {
      // Komplett fehlgeschlagen
      await supabaseAdmin
        .from('document_processing_status')
        .upsert({
          document_id: documentId,
          status: 'failed',
          progress: 0,
          message: `Verarbeitung fehlgeschlagen: ${allErrors.slice(0, 3).join('; ')}`,
          error: allErrors.join('; '),
          updated_at: new Date().toISOString()
        });
    }

    const processingDuration = Date.now() - startTime;
    
    // Prüfe ob noch weitere Chunks verarbeitet werden müssen
    const remainingChunks = totalChunks - totalProcessed - totalFailed;
    const hasMoreChunks = remainingChunks > 0 && totalProcessed > 0;
    const shouldContinue = hasMoreChunks && ORCHESTRATION_CONFIG.CONTINUE_PROCESSING;
    
    logger.info(`Orchestration completed in ${processingDuration}ms: ${totalProcessed}/${totalChunks} successful, ${remainingChunks} remaining`);

    const responseBody = {
      success: totalProcessed > 0,
      totalChunks,
      processed: totalProcessed,
      failed: totalFailed,
      remaining: remainingChunks,
      successRate: Math.round(successRate),
      processingDuration,
      shouldContinue,
      errors: allErrors.slice(0, 5),
      message: shouldContinue 
        ? `Partial processing completed: ${totalProcessed}/${totalChunks} chunks. Continue processing for remaining ${remainingChunks} chunks.`
        : `Orchestration completed: ${totalProcessed}/${totalChunks} chunks processed successfully`
    };

    // Serverseitige Selbst-Fortsetzung: Wenn weitere Chunks verbleiben, neuen Lauf anstoßen
    if (shouldContinue) {
      setTimeout(async () => {
        try {
          await fetch(`${baseUrl}/api/cursor/process-document-chunks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentId,
              userId,
              knowledgeBaseId,
              apiKey: process.env.API_SECRET_KEY
            })
          });
        } catch (e) {
          logger.error('Failed to schedule continuation:', e);
        }
      }, ORCHESTRATION_CONFIG.RETRY_DELAY_MS);
    }

    return NextResponse.json(responseBody);

  } catch (error: any) {
    const processingDuration = Date.now() - startTime;
    logger.error('Error in orchestration:', error);
    
    return NextResponse.json({
      error: `Orchestration failed: ${error.message}`,
      processingDuration
    }, { status: 500 });
  }
}
*/