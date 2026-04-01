import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { processDocument } from '@/lib/cursor-documents/processing'
import OpenAI from 'openai'
import { generateEmbeddings } from '@/lib/knowledge-base/embedding'

// Vercel Function Configuration für größere Uploads
export const maxDuration = 300; // 5 Minuten für Ordner-Uploads
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Konfigurationskonstanten für die Textverarbeitung
const MIN_TEXT_LENGTH_FOR_EXTRACTION = 50;
const MAX_FACTS_PER_CHUNK = 20;
const DEBUG_MODE = true;

// Debug-Hilfsfunktion
function debugLog(message: string) {
  if (DEBUG_MODE) {
    console.log(`[DEBUG][CURSOR-FOLDER] ${message}`);
  }
}

// Initialisiere OpenAI-Client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

/**
 * Handles folder upload requests
 * Receives multiple files from a folder as FormData objects
 * Processes each document and returns the document IDs
 */
export async function POST(req: NextRequest) {
  console.log('--- API /api/cursor/upload-folder reached ---');
  console.log('🚀 Request method:', req.method);
  console.log('🚀 Request URL:', req.url);
  console.log('🚀 Content-Type:', req.headers.get('content-type'));
  console.log('🚀 Content-Length:', req.headers.get('content-length'));

  // 🧪 IMMEDIATE RESPONSE TEST - If this appears in logs, the route is reached
  console.log('✅ TEST: Route reached - this means 413 is from Vercel Edge, not our code!');

  // Try to read a small part of the request to test if we can access it
  try {
    console.log('📋 Attempting to parse FormData...')
    const formData = await req.formData()
    console.log('✅ FormData parsed successfully')
  } catch (error) {
    console.log('❌ FormData parsing failed:', error.message)
    return NextResponse.json(
      {
        error: 'Request too large - blocked by Vercel Edge',
        message: 'The request was blocked by Vercel\'s Edge Network due to size limits',
        details: error.message
      },
      { status: 413 }
    )
  }

  try {
    // Extract auth token from request
    const authHeader = req.headers.get('authorization')
    const authToken = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null

    console.log('🔐 Auth header present:', !!authHeader);
    console.log('🔐 Auth token extracted:', !!authToken);

    if (!authToken) {
      console.log('❌ No authentication token provided')
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
      console.log('Unauthorized - User error:', userError)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('User authenticated:', user.id);

    // Parse FormData
    console.log('📋 Attempting to parse FormData...')
    const formData = await req.formData()
    console.log('✅ FormData parsed successfully')

    const files = formData.getAll('files') as File[]
    console.log(`📁 Found ${files.length} files in FormData`)
    console.log('📋 File details:', files.map((f, i) => `${i+1}. ${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`))

    if (!files || files.length === 0) {
      console.log('❌ No files provided')
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      )
    }

    // Get form fields
    const title = formData.get('title') as string | null
    const description = formData.get('description') as string | null
    const workspaceId = formData.get('workspace_id') as string | null
    const knowledgeBaseId = formData.get('knowledge_base_id') as string | null
    const folderName = formData.get('folder_name') as string | null

    // 🔒 VALIDATE FILES BEFORE PROCESSING 🔒
    const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.md', '.html']
    const maxFileSize = 50 * 1024 * 1024 // 50MB per file
    const systemFiles = ['.ds_store', 'thumbs.db', 'desktop.ini', '._.', '._ds_store']
    const validFiles: File[] = []
    const invalidFiles: { name: string, reason: string }[] = []

    console.log(`🔍 Validating ${files.length} files for folder upload`)

    files.forEach(file => {
      const fileName = file.name.toLowerCase()
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()

      console.log(`  📄 Checking: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)}MB)`)

      // Skip macOS and Windows system files silently
      if (systemFiles.some(sysFile => fileName === sysFile || fileName.startsWith(sysFile))) {
        console.log(`  ⏭️ Skipping system file: ${file.name}`)
        return
      }

      if (!allowedTypes.includes(fileExtension)) {
        console.log(`  ❌ Invalid type: ${file.name} (${fileExtension})`)
        invalidFiles.push({ name: file.name, reason: `Nicht unterstützter Dateityp: ${fileExtension}` })
      } else if (file.size > maxFileSize) {
        console.log(`  ❌ Too large: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)}MB)`)
        invalidFiles.push({ name: file.name, reason: `Datei zu groß: ${(file.size / (1024 * 1024)).toFixed(1)}MB (max. 50MB)` })
      } else {
        console.log(`  ✅ Valid: ${file.name}`)
        validFiles.push(file)
      }
    })

    // If all files are invalid, return error
    if (validFiles.length === 0 && invalidFiles.length > 0) {
      console.log(`❌ All ${files.length} files are invalid`)
      return NextResponse.json(
        {
          error: `Keine gültigen Dateien gefunden:\n${invalidFiles.map(f => `• ${f.name}: ${f.reason}`).join('\n')}`,
          invalidFiles
        },
        { status: 400 }
      )
    }

    // If some files are invalid but we have valid ones, continue with valid files
    if (invalidFiles.length > 0 && validFiles.length > 0) {
      console.log(`⚠️ ${invalidFiles.length} invalid files skipped, continuing with ${validFiles.length} valid files`)
    }

    console.log(`✅ Validation complete: ${filesToProcess.length}/${files.length} files will be processed`)

    // Use valid files instead of all files
    const filesToProcess = validFiles

    console.log(`Folder: ${folderName}, Files: ${filesToProcess.length}/${files.length}, Workspace: ${workspaceId}, Knowledge Base: ${knowledgeBaseId}`)

    // Validate knowledge base ID is provided
    if (!knowledgeBaseId) {
      console.error('❌ No knowledge base ID provided');
      return NextResponse.json(
        {
          error: 'Missing knowledge_base_id - Knowledge base selection is required',
          message: 'Knowledge base selection is required for folder upload'
        },
        { status: 400 }
      );
    }

    // Validate file count
    const MAX_FILES_PER_FOLDER = 50;
    if (filesToProcess.length > MAX_FILES_PER_FOLDER) {
      return NextResponse.json(
        {
          error: 'Too many files',
          message: `Maximum ${MAX_FILES_PER_FOLDER} files allowed per folder upload. You provided ${filesToProcess.length} valid files.`
        },
        { status: 400 }
      )
    }

    // Validate total size
    const totalSize = filesToProcess.reduce((sum, file) => sum + file.size, 0);
    const MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB

    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        {
          error: 'Folder too large',
          message: `Ordner insgesamt zu groß: ${(totalSize / 1024 / 1024).toFixed(2)}MB (max. ${MAX_TOTAL_SIZE / 1024 / 1024}MB)`
        },
        { status: 413 }
      )
    }

    // Files are already validated above, continue with filesToProcess
    console.log(`✅ Using ${filesToProcess.length} pre-validated files`);

    // Supabase Admin client für direkten DB-Zugriff
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Process each file and collect document IDs for n8n processing
    const results = [];
    const errors = [];
    const documentsForProcessing = [];

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      console.log(`Processing file ${i + 1}/${filesToProcess.length}: ${file.name}`);

      try {
        // Process the document (upload & initial chunking)
        const documentId = await processDocument(
          file,
          user.id,
          folderName ? `${folderName}/${file.name}` : file.name,
          description || undefined,
          workspaceId || undefined,
          knowledgeBaseId || undefined
        )

        console.log(`✅ Document uploaded successfully: ${file.name} -> ${documentId}`);

        // Add to results and processing queue
        results.push({
          file_name: file.name,
          document_id: documentId,
          size: file.size,
          type: file.type,
          status: 'uploaded'
        });

        documentsForProcessing.push({
          documentId,
          fileName: file.name
        });

      } catch (error: any) {
        console.error(`❌ Error processing file ${file.name}:`, error);
        errors.push({
          file_name: file.name,
          error: error.message || 'Processing failed'
        });
      }
    }

    // Wait for chunks to be created and delegate to n8n for each document
    console.log(`📊 Starting n8n delegation for ${documentsForProcessing.length} documents`);
    
    for (const doc of documentsForProcessing) {
      try {
        await processFolderDocumentWithN8n(supabaseAdmin, doc.documentId, doc.fileName, knowledgeBaseId, workspaceId, user.id);
      } catch (error: any) {
        console.error(`❌ Error delegating ${doc.fileName} to n8n:`, error);
        // Update the result status but don't fail the entire folder upload
        const resultIndex = results.findIndex(r => r.document_id === doc.documentId);
        if (resultIndex >= 0) {
          results[resultIndex].status = 'processing_failed';
        }
      }
    }

    // Check if we have any successful uploads
    if (results.length === 0) {
      return NextResponse.json(
        {
          error: 'All files failed to process',
          errors: errors
        },
        { status: 400 }
      )
    }

    // Return summary
    return NextResponse.json({
      success: true,
      message: `Folder upload completed: ${results.length} files processed successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
      folder_name: folderName || 'Uploaded Folder',
      total_files: files.length,
      successful_uploads: results.length,
      failed_uploads: errors.length,
      results: results,
      errors: errors.length > 0 ? errors : undefined,
      knowledge_base_id: knowledgeBaseId
    });

  } catch (error: any) {
    console.error('!!! Error in /api/cursor/upload-folder:', error);
    return NextResponse.json(
      {
        error: `Folder upload failed: ${error.message}`,
        details: error.stack
      },
      { status: 500 }
    )
  }
}

/**
 * Processes a single document from folder upload with n8n webhook integration
 * Similar to the logic in upload/route.ts but for individual documents
 */
async function processFolderDocumentWithN8n(
  supabaseAdmin: any,
  documentId: string,
  fileName: string,
  knowledgeBaseId: string,
  workspaceId: string | null,
  userId: string
) {
  console.log(`📋 Processing document ${fileName} (${documentId}) with n8n...`);

  // Function to check if chunk creation is complete
  const waitForChunkCreationCompletion = async (): Promise<boolean> => {
    const { data: statusData, error: statusError } = await supabaseAdmin
      .from('document_processing_status')
      .select('status, progress')
      .eq('document_id', documentId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (statusError) {
      console.error(`❌ Error checking document_processing_status for ${fileName}: ${statusError.message}`);
      return false;
    }

    if (statusData) {
      // Chunks are created when progress reaches 60 (after saving chunks)
      const chunksCreated = statusData.status === 'processing' && statusData.progress >= 60;
      const processPastChunkingStage = ['embedding', 'completed', 'failed'].includes(statusData.status);
      
      if (chunksCreated || processPastChunkingStage) {
        console.log(`[INFO] Document chunks should be available for ${fileName} (Status: ${statusData.status}, Progress: ${statusData.progress})`);
        return true;
      }
    }
    return false;
  };

  // Wait for chunk creation (shorter window for folder uploads)
  let chunksCreated = false;
  let attempts = 0;
  const maxAttempts = 3; // ~6 seconds (3 * 2s) for folder uploads
  const intervalMs = 2000;

  console.log(`⏳ Waiting for chunks to be created for ${fileName} (${documentId})...`);
  while (attempts < maxAttempts && !chunksCreated) {
    chunksCreated = await waitForChunkCreationCompletion();
    if (chunksCreated) {
      console.log(`✅ Chunks created for ${fileName} (${documentId})`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    attempts++;
  }

  if (!chunksCreated) {
    console.warn(`[WARN] Timeout while waiting for chunks for ${fileName}. Skipping n8n delegation.`);
    return;
  }

  // Load the created chunks from database
  const { data: chunks, error: chunksError } = await supabaseAdmin
    .from('document_chunks')
    .select('id, content_position')
    .eq('document_id', documentId)
    .order('content_position', { ascending: true });

  if (chunksError || !chunks || chunks.length === 0) {
    throw new Error(`Failed to load chunks for document ${fileName} (${documentId}).`);
  }

  console.log(`📊 Found ${chunks.length} chunks for ${fileName}. Delegating to n8n webhook`);

  // Update processing status
  const updateStatus = async (status: string, progress: number, message: string) => {
    try {
      await supabaseAdmin
        .from('document_processing_status')
        .upsert({
          document_id: documentId,
          status: status as any,
          progress,
          message,
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      console.error(`Error updating status for ${fileName}:`, error);
    }
  };

  // Delegate to n8n webhook
  const webhookUrl = process.env.N8N_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await updateStatus('processing', 70, `${chunks.length} Chunks erstellt. Wird vom Server analysiert...`);
      
      // Load additional document details
      const { data: docDetails } = await supabaseAdmin
        .from('documents')
        .select('file_name, title, file_type, file_size, storage_url')
        .eq('id', documentId)
        .single();

      const payload = {
        document: {
          id: documentId,
          title: docDetails?.title || docDetails?.file_name || null,
          file_name: docDetails?.file_name || null,
          file_type: docDetails?.file_type || null,
          file_size: docDetails?.file_size || null,
          storage_url: docDetails?.storage_url || null,
          workspace_id: workspaceId,
          knowledge_base_id: knowledgeBaseId,
          user_id: userId
        },
        chunks: chunks.map(c => ({ 
          id: c.id, 
          position: c.content_position
        })),
        options: {
          language: 'de',
          max_facts_per_chunk: 20,
          create_embeddings: true,
          embedding_provider: 'openai',
          source_type: 'document'
        }
      };

      // Call n8n webhook
      const webhookPromise = fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(async (resp) => {
        console.log(`[n8n] Webhook response status for ${fileName}: ${resp.status}`);
        if (!resp.ok) {
          const txt = await resp.text();
          console.warn(`[n8n] Webhook returned non-200 for ${fileName}:`, resp.status, txt);
          await updateStatus('failed', 0, `Server-Verarbeitung fehlgeschlagen (${resp.status}): ${txt}`);
        } else {
          // 200 means: Workflow was accepted; progress follows via callback HTTP requests
          await updateStatus('processing', 70, `${chunks.length} Chunks an Server übergeben. Verarbeitung wurde angenommen.`);
        }
      }).catch(async (err) => {
        console.error(`[n8n] Webhook call failed for ${fileName}:`, err);
        await updateStatus('processing', 60, `Chunks erstellt. Übergabe an Server fehlgeschlagen: ${err.message}`);
      });

      // Wait briefly (max 5s) for acceptance; actual progress comes asynchronously via callback
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000));
      await Promise.race([webhookPromise, timeoutPromise]);
      console.log(`[n8n] Webhook call completed or timed out for ${fileName}`);
      
    } catch (err: any) {
      console.error(`[n8n] Webhook call failed for ${fileName}:`, err);
      await updateStatus('processing', 60, `Chunks erstellt. Übergabe an Server fehlgeschlagen: ${err.message}`);
    }
  } else {
    // If no webhook is set: communicate status clearly
    await updateStatus('processing', 60, `${chunks.length} Chunks erstellt. Kein Server-Webhook konfiguriert.`);
  }
}
