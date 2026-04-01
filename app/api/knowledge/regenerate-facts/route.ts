import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    console.log('[regenerate-facts] API called')
    
    const { chunkId, chunkContent, documentId, knowledgeBaseId: bodyKnowledgeBaseId, customPrompt } = await request.json()
    console.log('[regenerate-facts] Request data:', { chunkId, documentId, contentLength: chunkContent?.length, knowledgeBaseId: bodyKnowledgeBaseId, hasCustomPrompt: !!customPrompt })

    if (!chunkId || !chunkContent || !documentId) {
      console.log('[regenerate-facts] Missing required fields')
      return NextResponse.json(
        { error: 'chunkId, chunkContent und documentId sind erforderlich' },
        { status: 400 }
      )
    }

    // Supabase Client erstellen
    const supabase = createRouteHandlerClient({ cookies })

    // Benutzer authentifizieren
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.log('[regenerate-facts] Auth error:', authError)
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
    }

    console.log('[regenerate-facts] User authenticated:', user.id)

    // Chunk-Informationen abrufen (zuerst)
    const { data: chunk, error: chunkError } = await supabase
      .from('document_chunks')
      .select('*')
      .eq('id', chunkId)
      .single()

    if (chunkError || !chunk) {
      console.log('[regenerate-facts] Chunk error:', chunkError, 'Chunk found:', !!chunk)
      return NextResponse.json(
        { error: 'Chunk nicht gefunden' },
        { status: 404 }
      )
    }

    console.log('[regenerate-facts] Chunk found:', chunk.content_position, 'document_id:', chunk.document_id)

    // Korrigiere inkonsistente Request-Daten: maßgeblich ist immer die DB-Relation des Chunks.
    if (documentId && documentId !== chunk.document_id) {
      console.warn('[regenerate-facts] documentId mismatch, using chunk.document_id instead', {
        requestedDocumentId: documentId,
        chunkDocumentId: chunk.document_id,
      })
    }

    // Dokument-Informationen abrufen für Webhook-Payload (mit document_id aus chunk)
    // Note: RLS policies now handle company-wide access automatically
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', chunk.document_id)
      .single()

    if (docError || !document) {
      console.log('[regenerate-facts] Document error:', docError, 'Document found:', !!document)
      console.log('[regenerate-facts] Looking for document_id:', chunk.document_id)
      return NextResponse.json(
        { error: 'Dokument nicht gefunden oder keine Berechtigung' },
        { status: 404 }
      )
    }

    console.log('[regenerate-facts] Document found:', document.title)

    let knowledgeBaseId: string | null = bodyKnowledgeBaseId || document.knowledge_base_id || null

    if (knowledgeBaseId) {
      console.log('[regenerate-facts] Using knowledge_base_id from document:', knowledgeBaseId)
    } else {
      // Hole knowledge_base_id von einem bestehenden Fakt dieses Chunks (oder verwende Fallback)
      const { data: existingFact, error: factError } = await supabase
        .from('knowledge_items')
        .select('knowledge_base_id')
        .eq('source_chunk', chunkId)
        .limit(1)
        .single()

      if (!factError && existingFact?.knowledge_base_id) {
        knowledgeBaseId = existingFact.knowledge_base_id
        console.log('[regenerate-facts] Found knowledge_base_id from chunk facts:', knowledgeBaseId)
      } else {
        console.log('[regenerate-facts] No existing facts found for chunk, trying to get knowledge_base_id from document facts')

        const { data: documentFacts, error: docFactError } = await supabase
          .from('knowledge_items')
          .select('knowledge_base_id')
          .eq('document_id', chunk.document_id)
          .limit(1)
          .single()

        if (!docFactError && documentFacts?.knowledge_base_id) {
          knowledgeBaseId = documentFacts.knowledge_base_id
          console.log('[regenerate-facts] Found knowledge_base_id from document facts:', knowledgeBaseId)
        }
      }
    }

    if (!knowledgeBaseId) {
      console.log('[regenerate-facts] No knowledge_base_id from document or facts, using default knowledge base')

      const { data: userKnowledgeBases, error: kbError } = await supabase
        .from('knowledge_bases')
        .select('id')
        .limit(1)
        .single()

      if (kbError || !userKnowledgeBases) {
        return NextResponse.json(
          { error: 'Keine Knowledge Base verfügbar' },
          { status: 404 }
        )
      }

      knowledgeBaseId = userKnowledgeBases.id
      console.log('[regenerate-facts] Using fallback knowledge_base_id:', knowledgeBaseId)
    }

    const resolvedKnowledgeBaseId = knowledgeBaseId
    if (!resolvedKnowledgeBaseId) {
      return NextResponse.json(
        { error: 'Knowledge Base konnte nicht bestimmt werden' },
        { status: 500 }
      )
    }

    // Company ID aus Knowledge Base ableiten (Fallback über Dokument)
    let companyId: string | null = null
    const { data: knowledgeBase, error: knowledgeBaseError } = await supabase
      .from('knowledge_bases')
      .select('company_id')
      .eq('id', resolvedKnowledgeBaseId)
      .single()

    if (knowledgeBaseError) {
      console.log('[regenerate-facts] Knowledge Base company lookup failed:', knowledgeBaseError)
    } else if (knowledgeBase?.company_id) {
      companyId = knowledgeBase.company_id
      console.log('[regenerate-facts] Using company_id from knowledge base:', companyId)
    }

    if (!companyId && document.company_id) {
      companyId = document.company_id
      console.log('[regenerate-facts] Fallback company_id from document:', companyId)
    }

    // N8N Facts Webhook URL aus Environment
    const factsWebhookUrl = process.env.N8N_WEBHOOK_URL_FACTS
    if (!factsWebhookUrl) {
      console.log('[regenerate-facts] No webhook URL configured')
      return NextResponse.json(
        { error: 'Facts Webhook URL nicht konfiguriert' },
        { status: 500 }
      )
    }

    console.log('[regenerate-facts] Using webhook URL:', factsWebhookUrl.substring(0, 50) + '...')

    const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
      : null

    // Payload für Facts-Webhook erstellen (basierend auf Standard-Webhook-Struktur)
    const payload = {
      document: {
        id: document.id,
        title: document.title || document.file_name || null,
        file_name: document.file_name || null,
        file_type: document.file_type || null,
        file_size: document.file_size || null,
        storage_url: document.storage_url || null,
        workspace_id: document.workspace_id,
        company_id: companyId,
        knowledge_base_id: resolvedKnowledgeBaseId, // ✅ Von existierendem Fakt geholt
        user_id: user.id
      },
      chunk: {
        id: chunk.id,
        content: chunkContent,
        position: chunk.content_position,
        document_id: chunk.document_id,
        regenerate_facts: true // Flag für Webhook
      },
      options: {
        language: 'de',
        max_facts_per_chunk: 20,
        create_embeddings: true,
        embedding_provider: 'openai',
        source_type: 'regenerate_facts',
        knowledge_base_id: resolvedKnowledgeBaseId,
        source_chunk_id: chunk.id,
        source_document_id: chunk.document_id,
        supabase_host: supabaseHost,
        ...(customPrompt ? { custom_prompt: customPrompt } : {})
      }
    }

    console.log(`[regenerate-facts] Sending chunk ${chunk.id} to facts webhook`)

    // Webhook aufrufen
    const webhookResponse = await fetch(factsWebhookUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(payload)
    })

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text()
      console.error('[regenerate-facts] Webhook failed:', webhookResponse.status, errorText)
      return NextResponse.json(
        { error: `Fakten-Regenerierung fehlgeschlagen: ${webhookResponse.status}` },
        { status: 500 }
      )
    }

    console.log(`[regenerate-facts] Webhook responded with status: ${webhookResponse.status}`)
    
    return NextResponse.json({
      success: true,
      message: 'Fakten-Regenerierung wurde gestartet',
      chunkId: chunk.id,
      documentId: document.id
    })

  } catch (error) {
    console.error('Fehler bei Fakten-Regenerierung:', error)
    return NextResponse.json(
      { error: 'Unerwarteter Fehler bei der Fakten-Regenerierung' },
      { status: 500 }
    )
  }
}
