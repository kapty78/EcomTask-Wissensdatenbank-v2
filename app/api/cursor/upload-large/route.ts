import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Vercel Function Configuration
export const maxDuration = 60; // Increased timeout for large file processing
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API Route für große Datei-Uploads über presigned URLs
 * Umgeht Vercel's 4.5MB Request Body Limit
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
    
    // Parse request body for file metadata
    const { fileName, fileSize, fileType, title, description, workspaceId, knowledgeBaseId } = await req.json()
    
    if (!fileName || !fileSize || !fileType) {
      return NextResponse.json(
        { error: 'Missing file metadata' },
        { status: 400 }
      )
    }
    
    // Check if file is actually large enough to warrant this endpoint
    const MIN_LARGE_FILE_SIZE = 4 * 1024 * 1024; // 4MB
    const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB maximum - updated for larger files
    
    if (fileSize < MIN_LARGE_FILE_SIZE) {
      return NextResponse.json(
        { 
          error: 'File too small for large upload endpoint',
          message: 'Please use the regular upload endpoint for files under 4MB'
        },
        { status: 400 }
      )
    }
    
    if (fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { 
          error: 'Datei zu groß',
          message: `Die Datei ist ${(fileSize / 1024 / 1024).toFixed(2)}MB groß. Das Maximum ist 200MB.`,
          max_size_mb: 200,
          current_size_mb: Math.round((fileSize / 1024 / 1024) * 100) / 100
        },
        { status: 413 }
      )
    }
    
    // Generate unique file path
    const fileId = crypto.randomUUID()
    const fileExtension = fileName.split('.').pop()
    const filePath = `uploads_large/${fileId}.${fileExtension}`
    
    // Create presigned URL for upload
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    
    const { data: uploadData, error: uploadError } = await supabaseAdmin
      .storage
      .from('documents')
      .createSignedUploadUrl(filePath, {
        upsert: true
      })
    
    if (uploadError) {
      console.error('Error creating presigned URL:', uploadError)
      return NextResponse.json(
        { error: 'Failed to create upload URL' },
        { status: 500 }
      )
    }
    
    // Pre-create document record with pending status
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .insert({
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        storage_url: uploadData.path, // Temporary path
        title: title || fileName,
        description,
        user_id: user.id,
        workspace_id: workspaceId
      })
      .select()
      .single()
    
    if (docError) {
      console.error('Error creating document record:', docError)
      return NextResponse.json(
        { error: 'Failed to create document record' },
        { status: 500 }
      )
    }
    
    return NextResponse.json({
      success: true,
      uploadUrl: uploadData.signedUrl,
      documentId: document.id,
      filePath: uploadData.path,
      message: 'Presigned URL created. Upload file directly to this URL, then call process endpoint.'
    })
    
  } catch (error: any) {
    console.error('Error in large upload endpoint:', error)
    return NextResponse.json(
      { error: `Large upload failed: ${error.message}` },
      { status: 500 }
    )
  }
}

/**
 * Confirm upload completion and start processing
 */
export async function PUT(req: NextRequest) {
  try {
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
    
    const { documentId, knowledgeBaseId } = await req.json()
    
    if (!documentId) {
      return NextResponse.json(
        { error: 'Missing document ID' },
        { status: 400 }
      )
    }
    
    // Initialize Supabase client
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
    
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Get document and start processing
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('user_id', user.id)
      .single()
    
    if (docError || !document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }
    
    // Debug: Check the actual storage path
    console.log('[DEBUG] Document storage path:', document.storage_url)
    
    // Get public URL - note: storage_url contains just the path, not full URL
    const { data: urlData } = supabaseAdmin
      .storage
      .from('documents')
      .getPublicUrl(document.storage_url)
    
    console.log('[DEBUG] Generated public URL:', urlData.publicUrl)
    
    // Verify file exists in storage
    const { data: fileList, error: listError } = await supabaseAdmin
      .storage
      .from('documents')
      .list(document.storage_url.split('/')[0], {
        search: document.storage_url.split('/').pop()
      })
    
    if (listError) {
      console.error('[ERROR] Could not list files in storage:', listError)
    } else {
      console.log('[DEBUG] File found in storage:', fileList)
    }
    
    await supabaseAdmin
      .from('documents')
      .update({ 
        storage_url: urlData.publicUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId)
    
    // Start document processing like in normal upload route
    const { processDocument, processDocumentFile } = await import('@/lib/cursor-documents/processing')
    
    try {
      // Download file directly via Supabase Storage API instead of public URL
      console.log('[INFO] Downloading file from storage path:', document.storage_url)
      
      const { data: fileData, error: downloadError } = await supabaseAdmin
        .storage
        .from('documents')
        .download(document.storage_url)
      
      if (downloadError) {
        console.error('[ERROR] Failed to download file from storage:', downloadError)
        throw new Error(`Storage download failed: ${downloadError.message}`)
      }
      
      if (!fileData) {
        throw new Error('No file data received from storage')
      }
      
      // Convert Blob to ArrayBuffer
      const arrayBuffer = await fileData.arrayBuffer()
      console.log(`[INFO] Downloaded file size: ${arrayBuffer.byteLength} bytes (expected: ${document.file_size} bytes)`)
      
      // Verify the downloaded file size matches expected
      if (arrayBuffer.byteLength !== document.file_size) {
        console.error(`[ERROR] File size mismatch! Downloaded: ${arrayBuffer.byteLength}, Expected: ${document.file_size}`)
      }
      
      const file = new File([arrayBuffer], document.file_name, { type: document.file_type })
      console.log(`[INFO] Created File object: name=${file.name}, size=${file.size}, type=${file.type}`)
      
      // Use processDocumentFile directly since document already exists
      // processDocument would create a duplicate document record
      // IMPORTANT: await the processing to ensure chunks are created before response
      await processDocumentFile(
        document,
        file,
        knowledgeBaseId || undefined,
        user.id
      )
      
      console.log('[INFO] Document file processing completed')
      
      // 🔥 Delegate to n8n webhook like normal upload route
      // Validate knowledge base ID is provided
      if (!knowledgeBaseId) {
        console.error('❌ No knowledge base ID provided for large file upload');
        return NextResponse.json({
          success: true,
          documentId,
          message: 'Large file upload confirmed but knowledge base ID is missing for processing',
          storageUrl: urlData.publicUrl,
          warning: 'Processing skipped - no knowledge base ID provided'
        })
      }
      
      if (knowledgeBaseId) {
        try {
          console.log('[INFO] Starting n8n delegation for large file...')
          
          // Get chunks created during processing
          const { data: chunks, error: chunksError } = await supabaseAdmin
            .from('document_chunks')
            .select('id, content_position')
            .eq('document_id', documentId)
            .order('content_position')
          
          if (chunksError || !chunks?.length) {
            console.warn('[n8n] No chunks found for delegation:', chunksError)
          } else {
            console.log(`📊 Found ${chunks.length} chunks for document ${documentId}. Delegating to n8n webhook`)
            console.log(`🔍 Using knowledge_base_id: ${knowledgeBaseId} for large file document ${documentId}`)
            
            // Build n8n payload (like normal upload route)
            const payload = {
              document: {
                id: documentId,
                title: document.title || document.file_name || null,
                file_name: document.file_name || null,
                file_type: document.file_type || null,
                file_size: document.file_size || null,
                storage_url: document.storage_url || null,
                workspace_id: document.workspace_id,
                knowledge_base_id: knowledgeBaseId,
                user_id: user.id
              },
              chunks: chunks.map(chunk => ({
                id: chunk.id,
                position: chunk.content_position
              })),
              options: {
                language: 'de',
                max_facts_per_chunk: 20,
                create_embeddings: true,
                embedding_provider: 'openai',
                source_type: 'document'
              }
            }
            
            // Send to n8n webhook
            const webhookUrl = process.env.N8N_WEBHOOK_URL
            console.log('[n8n] Webhook URL check:', webhookUrl ? `Set (${webhookUrl.substring(0, 50)}...)` : 'NOT SET')
            
            if (!webhookUrl) {
              console.error('[n8n] N8N_WEBHOOK_URL not configured')
            } else {
              console.log('[n8n] Starting webhook call...')
              console.log('[n8n] Payload size:', JSON.stringify(payload).length, 'bytes')
              
              // Debug: Temporarily await the call to see errors
              try {
                const resp = await fetch(webhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                })
                console.log(`[n8n] Large file webhook response status: ${resp.status}`)
                if (!resp.ok) {
                  const txt = await resp.text()
                  console.warn('[n8n] Large file webhook returned non-200:', resp.status, txt)
                } else {
                  console.log('[n8n] Large file successfully delegated to server')
                }
              } catch (err: any) {
                console.error('[n8n] Large file webhook call failed:', err.message)
              }
            }
          }
        } catch (n8nError: any) {
          console.error('[n8n] Error delegating large file:', n8nError)
        }
      }
      
      return NextResponse.json({
        success: true,
        documentId,
        message: 'Large file upload confirmed. Processing started.',
        storageUrl: urlData.publicUrl
      })
      
    } catch (processingError: any) {
      console.error('Error starting document processing:', processingError)
      
      // Still return success for upload, but note processing issue
      return NextResponse.json({
        success: true,
        documentId,
        message: 'Upload confirmed but processing failed to start: ' + processingError.message,
        storageUrl: urlData.publicUrl,
        processingError: processingError.message
      })
    }
    
  } catch (error: any) {
    console.error('Error confirming upload:', error)
    return NextResponse.json(
      { error: `Upload confirmation failed: ${error.message}` },
      { status: 500 }
    )
  }
} 