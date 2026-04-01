import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractFactsFromText, extractFactsWithTypes, preprocessTextChunk } from '@/lib/knowledge-base/llm-processing'
import { generateEmbeddings } from '@/lib/knowledge-base/embedding'

// SERVERLESS-OPTIMIERTE Konfiguration für Vercel
const SERVERLESS_CONFIG = {
  MAX_PROCESSING_TIME_MS: 50000, // 50 Sekunden für Vercel Pro (mit 10s Puffer)
  CHUNK_TIMEOUT_WARNING_MS: 40000, // Warnung bei 40 Sekunden
  MAX_FACTS_PER_CHUNK: 20, // Optimiert für Stabilität und Performance
  BATCH_SIZE: 1, // Nur ein Chunk pro Request für Serverless
  ENABLE_PARALLEL_PROCESSING: false // Sequenzielle Verarbeitung für Stabilität
};

// Optimiertes Logging-System für Serverless
const LOG_LEVEL = process.env.API_LOG_LEVEL || 'info';
const PROD_MODE = process.env.NODE_ENV === 'production';

const logger = {
  debug: (message: string, ...data: any[]) => {
    if (LOG_LEVEL === 'debug' && !PROD_MODE) {
      console.debug(`[CHUNK-API:DEBUG] ${message}`, ...data);
    }
  },
  info: (message: string, ...data: any[]) => {
    if (['debug', 'info'].includes(LOG_LEVEL)) {
      console.log(`[CHUNK-API:INFO] ${message}`, ...data);
    }
  },
  warn: (message: string, ...data: any[]) => {
    if (['debug', 'info', 'warn'].includes(LOG_LEVEL)) {
      console.warn(`[CHUNK-API:WARN] ${message}`, ...data);
    }
  },
  error: (message: string, ...data: any[]) => {
    console.error(`[CHUNK-API:ERROR] ${message}`, ...data);
  }
};

/**
 * Serverless-optimierte Timeout-Überwachung
 */
const createTimeoutGuard = (timeoutMs: number) => {
  let isTimedOut = false;
  const timer = setTimeout(() => {
    isTimedOut = true;
    logger.warn(`Process nähert sich Timeout-Limit (${timeoutMs}ms)`);
  }, timeoutMs);

  return {
    isTimedOut: () => isTimedOut,
    clear: () => clearTimeout(timer)
  };
};

/**
 * Aktualisiert den Dokument-Verarbeitungsstatus (Serverless-optimiert)
 */
const updateDocumentStatus = async (
  supabaseAdmin: any,
  documentId: string,
  status: 'uploading' | 'processing' | 'embedding' | 'completed' | 'failed',
  progress: number,
  message?: string,
  error?: string
): Promise<void> => {
  try {
    // Schnelle Upsert-Operation ohne aufwendige Validierung
    const { error: statusError } = await supabaseAdmin
      .from('document_processing_status')
      .upsert({
        document_id: documentId,
        status,
        progress: Math.round(progress),
        message,
        error,
        updated_at: new Date().toISOString()
      }, { 
        onConflict: 'document_id',
        ignoreDuplicates: false 
      });
    
    if (statusError) {
      logger.error('Error updating document status:', statusError);
    }
  } catch (err) {
    logger.error('Unexpected error during status update:', err);
  }
};

/**
 * SERVERLESS-OPTIMIERT: Verarbeitet einen einzelnen Chunk mit Timeout-Schutz
 * Designed für Vercel Function Limits (10-60 Sekunden)
 */
export async function POST(req: NextRequest) {
  return NextResponse.json({
    error: 'Local chunk processing disabled. Use n8n workflow.'
  }, { status: 410 });
}

/*
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const timeoutGuard = createTimeoutGuard(SERVERLESS_CONFIG.CHUNK_TIMEOUT_WARNING_MS);
  try {
    // Schnelle Admin-Client Initialisierung
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Request-Body parsen (optimiert)
    const body = await req.json();
    const { 
      documentId, 
      chunkId, 
      userId, 
      knowledgeBaseId,
      apiKey,
      totalChunks,
      chunkIndex = 0 
    } = body;

    logger.info(`Starting serverless chunk processing: ${chunkId} (${chunkIndex + 1}/${totalChunks})`);

    // Schnelle API-Schlüssel-Prüfung
    if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
      logger.warn('Unauthorized API access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parameter-Validierung (minimal)
    if (!documentId || !chunkId) {
      logger.warn('Missing required parameters');
      return NextResponse.json(
        { error: 'Missing required parameters: documentId and chunkId' },
        { status: 400 }
      );
    }

    // OPTIMIERT: Chunk-Daten mit minimalen Feldern holen
    const { data: chunkData, error: chunkError } = await supabaseAdmin
      .from('document_chunks')
      .select('content, content_position, processing_complete')
      .eq('id', chunkId)
      .single();

    if (chunkError || !chunkData) {
      logger.error(`Chunk ${chunkId} not found:`, chunkError);
      return NextResponse.json(
        { error: `Chunk not found: ${chunkError?.message}` },
        { status: 404 }
      );
    }

    // Überspringe bereits verarbeitete Chunks
    if (chunkData.processing_complete) {
      logger.info(`Chunk ${chunkId} already processed, skipping`);
      return NextResponse.json({ 
        success: true, 
        message: 'Chunk already processed',
        factsCount: 0,
        skipped: true 
      });
    }

    // OPTIMIERT: Nur notwendige Dokument-Daten holen
    const { data: documentData, error: documentError } = await supabaseAdmin
      .from('documents')
      .select('file_name, title')
      .eq('id', documentId)
      .single();

    if (documentError || !documentData) {
      logger.error(`Document ${documentId} not found:`, documentError);
      return NextResponse.json(
        { error: `Document not found: ${documentError?.message}` },
        { status: 404 }
      );
    }

    const documentName = documentData.title || documentData.file_name;
    
    // Timeout-Check
    if (timeoutGuard.isTimedOut()) {
      logger.warn('Processing timeout warning triggered');
      return NextResponse.json({ 
        error: 'Processing timeout risk', 
        retry: true 
      }, { status: 408 });
    }
    
    // 1. SEITENAUFBEREITUNG: Jede Seite durch GPT-4.1-nano strukturieren (OHNE Informationsverlust)
    logger.info(`Preprocessing page chunk ${chunkId} (${chunkData.content_position + 1}/${totalChunks}) with GPT-4.1-nano`);
    
    // Verwende GPT-4.1-nano zur Aufbereitung jeder Seite für optimale Faktenextraktion
    const processedText = await preprocessTextChunk(
      chunkData.content,
      documentName,
      chunkData.content_position + 1,
      false // Preprocessing AKTIV für alle Chunks
    );

    // Timeout-Check nach Preprocessing
    if (timeoutGuard.isTimedOut()) {
      logger.warn('Timeout warning after preprocessing');
      return NextResponse.json({ 
        error: 'Processing timeout after preprocessing', 
        retry: true 
      }, { status: 408 });
    }

    // 2. SERVERLESS-OPTIMIERT: Effiziente Faktenextraktion
    logger.info(`Extracting facts from chunk ${chunkId}`);
    
    const factsWithTypes = await extractFactsWithTypes(
      processedText,
      documentName,
      chunkData.content_position + 1,
      totalChunks
    );

    const facts = factsWithTypes.texts;
    const types = factsWithTypes.types;

    // Begrenze Fakten für serverless Performance
    const limitedFacts = facts.slice(0, SERVERLESS_CONFIG.MAX_FACTS_PER_CHUNK);
    const limitedTypes = types.slice(0, SERVERLESS_CONFIG.MAX_FACTS_PER_CHUNK);
    logger.info(`Extracted ${limitedFacts.length} facts from chunk ${chunkId} (limited from ${facts.length})`);

    // Timeout-Check nach Faktenextraktion
    if (timeoutGuard.isTimedOut()) {
      logger.warn('Timeout warning after fact extraction');
      return NextResponse.json({ 
        error: 'Processing timeout after fact extraction', 
        retry: true 
      }, { status: 408 });
    }

    // 3. SERVERLESS-OPTIMIERT: Batch-Embedding-Generierung
    let factsCount = 0;
    if (limitedFacts.length > 0 && knowledgeBaseId && userId) {
      logger.info(`Generating embeddings for ${limitedFacts.length} facts from chunk ${chunkId}`);
      
      const factChunks = limitedFacts.map(fact => ({
        content: fact,
        tokens: fact.split(/\s+/).length
      }));

      // Verwende Batch-Embedding für Effizienz
      const embeddings = await generateEmbeddings(factChunks, 'openai');

      // Schnelle Knowledge Items Insertion
      const knowledgeItems = limitedFacts.map((fact, index) => ({
        document_id: documentId,
        content: fact,
        openai_embedding: Array.isArray(embeddings[index]) ? `[${embeddings[index].join(",")}]` : null,
        source_chunk: chunkId,
        knowledge_base_id: knowledgeBaseId,
        user_id: userId,
        tokens: factChunks[index].tokens,
        source_type: 'document',
        source_name: documentData.title || documentData.file_name,
        created_at: new Date().toISOString(),
        fact_type: limitedTypes[index] || null
      }));

      const { error: itemsError } = await supabaseAdmin
        .from('knowledge_items')
        .insert(knowledgeItems);

      if (itemsError) {
        logger.error(`Error inserting knowledge items for chunk ${chunkId}:`, itemsError);
        // Nicht abbrechen - versuche Chunk trotzdem als verarbeitet zu markieren
      } else {
        factsCount = limitedFacts.length;
      }
    }

    // 4. FINAL: Chunk als verarbeitet markieren (mit Performance-Daten)
    const processingDuration = Date.now() - startTime;
    
    const { error: updateError } = await supabaseAdmin
      .from('document_chunks')
      .update({ 
        content: processedText, 
        processing_complete: true,
        facts_count: factsCount,
        processing_duration_ms: processingDuration,
        quality_score: Math.min(100, Math.max(0, Math.round(factsCount * 4))), // Einfache Qualitätsbewertung
        updated_at: new Date().toISOString() 
      })
      .eq('id', chunkId);

    if (updateError) {
      logger.error(`Error updating chunk ${chunkId}:`, updateError);
      return NextResponse.json(
        { error: `Failed to update chunk: ${updateError.message}` },
        { status: 500 }
      );
    }

    // Cleanup
    timeoutGuard.clear();

    logger.info(`Chunk ${chunkId} processing completed in ${processingDuration}ms - ${factsCount} facts generated`);

    return NextResponse.json({
      success: true,
      chunkId,
      factsCount,
      processingDuration,
      message: `Chunk ${chunkIndex + 1}/${totalChunks} processed successfully`
    });

  } catch (error: any) {
    timeoutGuard.clear();
    const processingDuration = Date.now() - startTime;
    
    logger.error('Error in serverless chunk processing:', error);

    return NextResponse.json(
      { 
        error: `Chunk processing failed: ${error.message}`,
        processingDuration,
        retry: processingDuration < SERVERLESS_CONFIG.MAX_PROCESSING_TIME_MS // Suggest retry if we didn't timeout
      },
      { status: 500 }
    );
  }
}
*/