import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import { Document, DocumentChunk } from '@/types/cursor-documents'
import { chunkTextForKnowledgeBase } from '@/lib/knowledge-base/chunking'
import { extractTextFromFile } from '@/lib/knowledge-base/extraction'
import { generateEmbeddings } from '@/lib/knowledge-base/embedding'
import { extractFactsFromText, preprocessTextChunk } from '@/lib/knowledge-base/llm-processing'

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Initialize Supabase client (server-side only)
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'KEY_NOT_FOUND'

// Optimiertes Logging-System
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // 'debug', 'info', 'warn', 'error'
const PROD_MODE = process.env.NODE_ENV === 'production';

const logger = {
  debug: (message: string, ...data: any[]) => {
    if (LOG_LEVEL === 'debug' && !PROD_MODE) {
      console.debug(`[DEBUG] ${message}`, ...data);
    }
  },
  info: (message: string, ...data: any[]) => {
    if (['debug', 'info'].includes(LOG_LEVEL)) {
      console.log(`[INFO] ${message}`, ...data);
    }
  },
  warn: (message: string, ...data: any[]) => {
    if (['debug', 'info', 'warn'].includes(LOG_LEVEL)) {
      console.warn(`[WARN] ${message}`, ...data);
    }
  },
  error: (message: string, ...data: any[]) => {
    console.error(`[ERROR] ${message}`, ...data);
  }
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Nur bei erster Initialisierung relevante Debug-Info
if (LOG_LEVEL === 'debug' && !PROD_MODE) {
  logger.debug('Service Key Check:', serviceRoleKey ? 
    'Key exists (length: ' + serviceRoleKey.length + ', starts with: ' + 
    serviceRoleKey.substring(0, 3) + '..., ends with: ...' + 
    serviceRoleKey.substring(serviceRoleKey.length - 3) + ')' : 
    'Key is missing or empty');
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  serviceRoleKey
)

/**
 * Uploads a file to Supabase Storage
 * @param file The file to upload
 * @param userId The user ID
 * @returns The storage URL
 */
export const uploadFileToStorage = async (
  file: File,
  userId: string
): Promise<string> => {
  try {
    const fileBuffer = await file.arrayBuffer()
    const fileId = uuidv4()
    const fileExtension = file.name.split('.').pop()
    
    const filePath = `uploads_test/${fileId}.${fileExtension}`
    logger.debug("USING TEMPORARY SIMPLIFIED STORAGE PATH:", filePath);
    
    const { data, error } = await supabaseAdmin
      .storage
      .from('documents')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false
      })
    
    if (error) {
      logger.error('Error uploading file to storage:', {
        message: error.message,
        name: error.name,
        errorObject: error
      })
      
      // Check for RLS violations specifically
      if (error.message.includes('row-level security') || error.message.includes('RLS')) {
        logger.error('RLS VIOLATION DETECTED: Service role key may not be working correctly or RLS policy is misconfigured');
        
        // Test if we can at least access the bucket (this won't upload but checks permissions)
        const { data: listData, error: listError } = await supabaseAdmin
          .storage
          .from('documents')
          .list('uploads_test', { limit: 1 })
          
        logger.error('Bucket list test result:', { 
          canList: listError ? 'No' : 'Yes',
          listError
        });
      }
      
      throw new Error(`Failed to upload file to storage: ${error.message}`)
    }
    
    // Get public URL for the file
    const { data: urlData } = supabaseAdmin
      .storage
      .from('documents')
      .getPublicUrl(filePath)
    
    return urlData.publicUrl
  } catch (error: any) {
    logger.error('Unexpected exception in uploadFileToStorage:', error);
    throw error;
  }
}

/**
 * Creates a document record in the database
 * @param documentData The document data
 * @returns The created document
 */
export const createDocumentRecord = async (
  documentData: Omit<Document, 'id' | 'created_at' | 'updated_at'>
): Promise<Document> => {
  logger.debug('Attempting document record insert...');
  const { data, error } = await supabaseAdmin
    .from('documents')
    .insert(documentData)
    .select()
    .single()
  
  if (error) {
    logger.error('Error creating document record:', error)
    throw new Error(`Failed to create document record: ${error.message}`)
  }
  
  return data
}

/**
 * Updates the document processing status
 * @param documentId The document ID
 * @param status The processing status
 * @param progress The processing progress (0-100)
 * @param message Optional status message to display in the UI
 * @param error Optional error message
 */
export const updateDocumentStatus = async (
  documentId: string,
  status: 'uploading' | 'processing' | 'embedding' | 'completed' | 'failed',
  progress: number,
  message?: string,
  error?: string
): Promise<void> => {
  // Runde den Fortschrittswert auf ganze Zahlen
  const roundedProgress = Math.round(progress);
  
  // Check if document_processing_status table exists before upserting
  // Note: This check might add slight overhead but prevents errors if the table is missing.
  // Consider removing if performance is critical and table existence is guaranteed.
  try {
    const { error: checkError } = await supabaseAdmin
      .from('document_processing_status')
      .select('document_id', { count: 'exact', head: true })
      .limit(1);

    if (checkError && checkError.code === '42P01') { // 42P01: undefined_table
        logger.error('CRITICAL: \'document_processing_status\' table does not exist. Cannot update status.');
        return; // Stop further execution for status update
    } else if (checkError) {
        logger.warn('Warning checking document_processing_status table:', checkError)
        // Continue anyway, maybe a transient error
    }

    // Proceed with upsert if table check passed or only warned
    const { data, error: statusError } = await supabaseAdmin
      .from('document_processing_status')
      .upsert({
        document_id: documentId,
        status,
        progress: roundedProgress,
        message, // Speichere die Statusmeldung für die UI-Anzeige
        error,
        updated_at: new Date().toISOString()
      })
      .select()
    
    if (statusError) {
      logger.error('Error updating document status:', statusError)
      // Non-critical, continue without throwing
    }
  } catch (err) {
      logger.error('Unexpected error during status update check:', err)
  }
}

/**
 * Extracts both potential user questions and key facts from a text chunk
 * @param chunk The text chunk
 * @returns Array of knowledge items (questions and facts) with content and source reference
 */
const extractFactsFromChunk = async (chunk: string, chunkIndex: number): Promise<Array<{content: string, sourceChunk: number}>> => {
  try {
    // Verwende die zentrale Faktenextraktionsfunktion
    const facts = await extractFactsFromText(chunk);
    
    // Add source reference to each knowledge item
    const knowledgeItemsWithSource = facts.map(fact => ({
      content: fact,
      sourceChunk: chunkIndex
    }));
    
    logger.debug(`Generated ${knowledgeItemsWithSource.length} knowledge items from chunk ${chunkIndex}`);
    return knowledgeItemsWithSource;
  } catch (error) {
    logger.error('Error generating knowledge items from chunk:', error);
    // Return empty array in case of error
    return [];
  }
}

/**
 * Preprocesses a text chunk to optimize it for storage and AI prompting
 * Makes the chunk more structured, readable, and informative when used as context
 * @param chunk The raw text chunk
 * @param fileName File name for reference
 * @param pageNumber Page number (if applicable)
 * @returns Processed text chunk
 */
/**
 * Bereinigt Text für PostgreSQL-Datenbank-Kompatibilität
 * Entfernt NULL-Zeichen und andere problematische Unicode-Zeichen
 * @param text Der zu bereinigende Text
 * @returns Bereinigter Text
 */
const cleanTextForDatabase = (text: string): string => {
  if (!text) return '';
  // Minimal notwendige Bereinigung für DB-Sicherheit + "Fließtext":
  return text
    .replace(/\u0000/g, '') // NULL-Zeichen entfernen
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // Control-Zeichen
    .replace(/[\r\n]+/g, ' ') // Zeilenumbrüche zu Leerzeichen (ohne Absätze)
    .replace(/\s{2,}/g, ' ') // Mehrfach-Leerzeichen reduzieren
    .replace(/[\uFFF0-\uFFFF]/g, '') // seltene Problemblöcke
    .normalize('NFC')
    .trim();
};

// Entfernt: preprocessChunk wird nicht mehr benötigt, 
// da Preprocessing direkt in process-chunk/route.ts erfolgt

/**
 * Processes a document file, extracts text, chunks it, and prepares for distributed processing
 * @param document The document record
 * @param file The document file
 * @param knowledgeBaseId Optional knowledge base ID for facts extraction
 * @param userId The user ID who uploaded the document
 */
export const processDocumentFile = async (
  document: Document,
  file: File,
  knowledgeBaseId?: string,
  userId?: string
): Promise<void> => {
  try {
    logger.info('processDocumentFile started', { documentId: document.id, fileName: file.name });
    // Update status to processing
    await updateDocumentStatus(document.id, 'processing', 5, 'Initialisiere Dokumentenverarbeitung...')
    
    // Extract text from file
    logger.debug('Extracting text...');
    await updateDocumentStatus(document.id, 'processing', 10, 'Starte Textextraktion aus dem Dokument...')
    
    const extractedText = await extractTextFromFile(file, (progress) => {
      const extractionProgress = 10 + Math.round(progress.percentComplete * 0.2); // Extraktion macht 20% des Gesamtfortschritts aus (von 10% bis 30%)
      const statusMessage = `Extrahiere Text: ${Math.round(progress.percentComplete)}% abgeschlossen...`;
      updateDocumentStatus(document.id, 'processing', extractionProgress, statusMessage);
    })
    
    // SEITEN-BASIERTES CHUNKING: Jede Seite wird zu einem eigenen Chunk
    await updateDocumentStatus(document.id, 'processing', 30, 'Textextraktion abgeschlossen. Starte seiten-basiertes Chunking...');
    logger.info('Text extracted, starting page-based chunking...');

    // Erstelle einen Chunk pro Seite/Abschnitt
    const finalChunks: string[] = Array.isArray(extractedText)
      ? extractedText.map((pageText, index) => {
          // Bereinige jede Seite für Datenbank-Kompatibilität
          const cleanText = cleanTextForDatabase(pageText);
          logger.debug(`Seiten-Chunk ${index + 1}: ${cleanText.length} Zeichen`);
      return cleanText;
        })
      : [cleanTextForDatabase(extractedText)]; // Für Einzeltext-Dateien wie TXT

    // Validierung: Maximale Anzahl von 100 Seiten
    const MAX_PAGES = 100;
    if (finalChunks.length > MAX_PAGES) {
      const errorMessage = `Das Dokument hat ${finalChunks.length} Seiten, aber nur maximal ${MAX_PAGES} Seiten sind erlaubt. Bitte reduzieren Sie die Anzahl der Seiten oder teilen Sie das Dokument auf.`;
      logger.error(`Document page limit exceeded: ${finalChunks.length} pages (max: ${MAX_PAGES})`);
      await updateDocumentStatus(document.id, 'failed', 0, errorMessage, errorMessage);
      throw new Error(errorMessage);
    }
    
    await updateDocumentStatus(document.id, 'processing', 35, `${finalChunks.length} Seiten-Chunks erstellt (1 Chunk pro Seite).`);
    logger.info(`Seiten-basierte Chunks erstellt: ${finalChunks.length} Chunks (1 pro Seite/Abschnitt)`);
    
    // Aktualisiere die Statusmeldungen für weniger API-Anfragen
    await updateDocumentStatus(document.id, 'processing', 40, `Speichere ${finalChunks.length} Chunks in der Datenbank...`);
    
    // Insert page chunks into database
    // Wichtig: Hier werden die Chunks nur erstellt, aber nicht verarbeitet
    // Die eigentliche Verarbeitung erfolgt in separaten API-Aufrufen
    const pageChunkRecords = finalChunks.map((pageContent, index) => ({
      document_id: document.id,
      content: pageContent, // Bereits als Fließtext bereinigt – unverändert speichern
      content_position: index,
      chunk_size: pageContent.length,
      created_at: new Date().toISOString(),
      processing_complete: false // Neues Feld, um den Verarbeitungsstatus zu verfolgen
    }));
    
    const { data: insertedChunks, error: chunkInsertError } = await supabaseAdmin
      .from('document_chunks')
      .insert(pageChunkRecords)
      .select('id, content_position');
    
    if (chunkInsertError) {
      logger.error('Error inserting page chunks:', chunkInsertError);
      await updateDocumentStatus(document.id, 'failed', 45, `Fehler beim Speichern der Chunks: ${chunkInsertError.message}`, chunkInsertError.message);
      throw new Error(`Failed to insert page chunks: ${chunkInsertError.message}`);
    }
    
    logger.info(`Inserted ${insertedChunks.length} page-based chunks.`);
    
    // Update status to indicate that chunks are ready for processing
    await updateDocumentStatus(
      document.id, 
      'processing', 
      60, 
      `${insertedChunks.length} Chunks für verteilte Verarbeitung vorbereitet.`
    );

    // N8N-Webhook direkt hier aufrufen (unabhängig von Upload-Route-Timeout).
    // Die Upload-Route wartet nur ~10s auf Chunks; bei langsamer Extraktion (z. B. NuMarkdown Service)
    // sind die Chunks oft erst später fertig – dann wird n8n nie von der Route aus aufgerufen.
    if (knowledgeBaseId) {
      const webhookUrl = process.env.N8N_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;
      if (webhookUrl) {
        try {
          const payload = {
            document: {
              id: document.id,
              title: document.title ?? document.file_name ?? null,
              file_name: document.file_name ?? null,
              file_type: document.file_type ?? null,
              file_size: document.file_size ?? null,
              storage_url: document.storage_url ?? null,
              company_id: (document as any).company_id ?? null,
              knowledge_base_id: knowledgeBaseId,
              user_id: userId,
            },
            chunks: insertedChunks.map((c: { id: string; content_position: number }) => ({
              id: c.id,
              position: c.content_position,
            })),
            options: {
              language: 'de',
              max_facts_per_chunk: 20,
              create_embeddings: true,
              embedding_provider: 'openai',
              source_type: 'document',
            },
          };
          const timeoutMs = 10_000;
          let resp: Response | null = null;
          try {
            resp = await fetchWithTimeout(
              webhookUrl,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              },
              timeoutMs
            );
          } catch (err: any) {
            // 1 Retry (kurz), damit sporadische Netzwerk-Hiccups nicht alles blockieren
            logger.warn('[n8n] Webhook call failed (attempt 1), retrying once...', err?.message ?? err);
            await new Promise((r) => setTimeout(r, 500));
            resp = await fetchWithTimeout(
              webhookUrl,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              },
              timeoutMs
            );
          }
          if (!resp.ok) {
            const txt = await resp.text();
            logger.warn('[n8n] Webhook returned non-200:', resp.status, txt);
            await updateDocumentStatus(document.id, 'processing', 60, `Chunks bereit. Server-Annahme fehlgeschlagen (${resp.status}).`);
          } else {
            logger.info(`[n8n] Chunks an Server übergeben: ${insertedChunks.length} Chunks für Dokument ${document.id}`);
            await updateDocumentStatus(document.id, 'processing', 70, `${insertedChunks.length} Chunks an Server übergeben. Verarbeitung wurde angenommen.`);
          }
        } catch (err: any) {
          logger.error('[n8n] Webhook call failed:', err);
          await updateDocumentStatus(document.id, 'processing', 60, `Chunks bereit. Übergabe an Server fehlgeschlagen: ${err.message}`);
        }
      } else {
        logger.warn('[n8n] N8N_WEBHOOK_URL nicht gesetzt – Chunks nicht an Backend gesendet.');
      }
    }
    
    logger.info('Chunks prepared for distributed processing.');
  } catch (error: any) {
    logger.error('Error in processDocumentFile:', error);
    await updateDocumentStatus(document.id, 'failed', 0, `Fehler bei der Verarbeitung: ${error.message}`, error.message);
  }
}

/**
 * Complete document processing workflow from upload to embedding
 * @param file The file to process
 * @param userId The user ID
 * @param title Optional document title
 * @param description Optional document description
 * @param companyId Optional company ID (from profile)
 * @param knowledgeBaseId Optional knowledge base ID
 * @returns The document ID
 */
export const processDocument = async (
  file: File, 
  userId: string,
  title?: string,
  description?: string,
  companyId?: string,
  knowledgeBaseId?: string
): Promise<string> => {
  logger.info('processDocument started', { fileName: file.name, userId, companyId });
  try {
    const storageUrl = await uploadFileToStorage(file, userId)
    logger.info('File uploaded to storage');

    const document = await createDocumentRecord({
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      storage_url: storageUrl,
      title: title || file.name,
      description,
      user_id: userId,
      company_id: companyId
    } as any)
    logger.info('Document record created:', document.id);
    
    // Warten bis Extraktion + Chunking + N8N-Webhook fertig sind.
    // Auf Vercel gibt es kein echtes Background: Sobald die Route antwortet, kann die
    // Laufzeit beendet werden – dann würde processDocumentFile abgebrochen, bevor
    // das Markdown vom PDF-RAG-Service zurück ist und Chunks/N8N laufen.
    await processDocumentFile(document, file, knowledgeBaseId, userId);
    
    return document.id
  } catch (error) {
    logger.error('Error in processDocument (initial phase):', error);
    throw error // Re-throw to be caught by the API route
  }
} 