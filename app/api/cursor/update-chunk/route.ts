import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { Database } from '@/supabase/types'
import { generateEmbeddings } from '@/lib/knowledge-base/embedding'
import { logger } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let chunkId: string | undefined
  
  try {
    const requestBody = await request.json()
    const { 
      chunkId: requestChunkId, 
      newChunkContent, 
      updatedFacts, 
      newFacts, 
      deletedFactIds,
      knowledgeBaseId
    } = requestBody
    
    chunkId = requestChunkId
    
    logger.info(`🚀 Update-Chunk API called for chunk ${chunkId}`)
    logger.info(`📤 Request body:`, {
      chunkId,
      hasNewChunkContent: !!newChunkContent,
      updatedFactsCount: updatedFacts ? Object.keys(updatedFacts).length : 0,
      newFactsCount: newFacts ? newFacts.length : 0,
        deletedFactsCount: deletedFactIds ? deletedFactIds.length : 0,
        hasKnowledgeBaseId: !!knowledgeBaseId
    })
    
    if (!chunkId) {
      logger.error('❌ Missing chunkId in request')
      return NextResponse.json(
        { error: 'chunkId ist erforderlich' },
        { status: 400 }
      )
    }

    // Use auth client for user verification
    const authClient = createRouteHandlerClient<Database>({ cookies })
    
    // Get user from session
    const { data: { user }, error: userError } = await authClient.auth.getUser()
    
    if (userError || !user) {
      logger.error('❌ Authentication failed:', userError)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(`✅ User authenticated: ${user.id}`)
    
    // Use service role client for database operations to avoid RLS issues
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    
    logger.info(`🔄 Updating chunk ${chunkId} with new content and facts`)

    // 1. Update Chunk-Content wenn geändert
    // Schutz: vermeidet unbeabsichtigtes "Wipen" des Chunk-Contents durch leeren String.
    if (typeof newChunkContent === 'string' && newChunkContent.trim().length === 0) {
      logger.warn(
        `⚠️ Ignoring empty newChunkContent for chunk ${chunkId} (prevents accidental content wipe)`
      )
    } else if (typeof newChunkContent === 'string') {
      logger.info(`🔄 Updating chunk ${chunkId} content:`)
      logger.info(`   New content: "${newChunkContent.substring(0, 100)}..."`)
      logger.info(`   Content length: ${newChunkContent.length} characters`)
      
      const { data: updateResult, error: chunkUpdateError } = await supabase
        .from('document_chunks')
        .update({ 
          content: newChunkContent,
          updated_at: new Date().toISOString()
        })
        .eq('id', chunkId)
        .select()

      if (chunkUpdateError) {
        logger.error('❌ Error updating chunk content:', chunkUpdateError)
        throw new Error(`Failed to update chunk: ${chunkUpdateError.message}`)
      }
      
      if (!updateResult || updateResult.length === 0) {
        logger.error('❌ No rows were updated for chunk content')
        throw new Error('Chunk update failed: No rows affected')
      }
      
      logger.info(`✅ Chunk content updated successfully: ${updateResult.length} row(s) affected`)
    } else {
      logger.info(`ℹ️ No chunk content changes to save`)
    }

    // 2. Lösche Fakten die entfernt wurden
    if (deletedFactIds && deletedFactIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('knowledge_items')
        .delete()
        .in('id', deletedFactIds)

      if (deleteError) {
        logger.error('Error deleting facts:', deleteError)
        throw new Error(`Failed to delete facts: ${deleteError.message}`)
      }
    }

    // 3. Update existierende Fakten und generiere neue Embeddings
    if (updatedFacts && Object.keys(updatedFacts).length > 0) {
      logger.info(`🔄 Updating ${Object.keys(updatedFacts).length} existing facts with new embeddings`)
      
      for (const [factId, newContent] of Object.entries(updatedFacts)) {
        logger.info(`📝 Generating new embedding for fact ${factId}`)
        
        // Generiere neues Embedding für geänderten Fakt
        const factChunks = [{
          content: newContent as string,
          tokens: (newContent as string).split(/\s+/).length
        }]

        const embeddings = await generateEmbeddings(factChunks, 'openai')
        
        if (!embeddings || !embeddings[0]) {
          logger.error(`❌ Failed to generate embedding for fact ${factId}`)
          throw new Error(`Failed to generate embedding for fact ${factId}`)
        }

        // Stelle sicher, dass das Embedding korrekt formatiert ist
        const embeddingString = Array.isArray(embeddings[0]) 
          ? `[${embeddings[0].join(",")}]`
          : JSON.stringify(embeddings[0])

        logger.info(`✅ Generated new embedding for fact ${factId} (${embeddings[0].length} dimensions)`)

        // Update Fakt mit neuem Content und Embedding
        const { error: updateError } = await supabase
          .from('knowledge_items')
          .update({
            content: newContent as string,
            openai_embedding: embeddingString,
            tokens: factChunks[0].tokens,
            updated_at: new Date().toISOString()
          })
          .eq('id', factId)

        if (updateError) {
          logger.error(`❌ Error updating fact ${factId}:`, updateError)
          throw new Error(`Failed to update fact ${factId}: ${updateError.message}`)
        }
        
        logger.info(`✅ Successfully updated fact ${factId} with new embedding`)
      }
    }

    // 4. Füge neue Fakten hinzu
    if (newFacts && newFacts.length > 0) {
      // Hole Chunk-Details für Kontext
      const { data: chunkData, error: chunkError } = await supabase
        .from('document_chunks')
        .select('document_id')
        .eq('id', chunkId)
        .single()

      if (chunkError) {
        throw new Error(`Failed to get chunk info: ${chunkError.message}`)
      }

      // Knowledge Base ID robust bestimmen:
      // 1) aus Request (UI weiß, in welcher KB wir sind) – funktioniert auch bei 0 Fakten
      // 2) Fallback: aus existierendem Fakt des Chunks
      // 3) Fallback: aus irgendeinem Fakt des Dokuments
      let resolvedKnowledgeBaseId: string | null | undefined = knowledgeBaseId
      let fallbackSourceName: string | null = null

      if (!resolvedKnowledgeBaseId) {
        const { data: existingFact, error: factError } = await supabase
          .from('knowledge_items')
          .select('knowledge_base_id, source_name')
          .eq('source_chunk', chunkId)
          .limit(1)
          .maybeSingle()

        if (factError) {
          throw new Error(`Failed to get knowledge base info: ${factError.message}`)
        }

        resolvedKnowledgeBaseId = existingFact?.knowledge_base_id
        fallbackSourceName = existingFact?.source_name ?? null
      }

      if (!resolvedKnowledgeBaseId) {
        const { data: documentFact, error: docFactError } = await supabase
          .from('knowledge_items')
          .select('knowledge_base_id, source_name')
          .eq('document_id', chunkData.document_id)
          .limit(1)
          .maybeSingle()

        if (docFactError) {
          throw new Error(`Failed to get knowledge base info from document facts: ${docFactError.message}`)
        }

        resolvedKnowledgeBaseId = documentFact?.knowledge_base_id
        if (!fallbackSourceName) {
          fallbackSourceName = documentFact?.source_name ?? null
        }
      }

      if (!resolvedKnowledgeBaseId) {
        throw new Error('Failed to resolve knowledge base id for new facts')
      }

      // Hole Dokument-Details (best effort). Falls fehlgeschlagen, verwenden wir Fallback-Quelle.
      let documentData: { title?: string | null; file_name?: string | null } | null = null
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .select('title, file_name')
        .eq('id', chunkData.document_id)
        .maybeSingle()

      if (docError) {
        logger.warn(`⚠️ Failed to get document info for ${chunkData.document_id}: ${docError.message}`)
      } else {
        documentData = docData
      }

      const sourceName =
        documentData?.title ||
        documentData?.file_name ||
        fallbackSourceName ||
        `Document ${chunkData.document_id}`

      // Generiere Embeddings für neue Fakten
      const factChunks = newFacts.map((fact: string) => ({
        content: fact,
        tokens: fact.split(/\s+/).length
      }))

      const embeddings = await generateEmbeddings(factChunks, 'openai')

      // Erstelle neue Knowledge Items
      const knowledgeItems = newFacts.map((fact: string, index: number) => ({
        content: fact,
        openai_embedding: JSON.stringify(embeddings[index]),
        source_chunk: chunkId,
        document_id: chunkData.document_id, // ✅ FIXED: document_id hinzugefügt
        knowledge_base_id: resolvedKnowledgeBaseId,
        user_id: user.id,
        tokens: factChunks[index].tokens,
        source_type: 'document' as const,
        source_name: sourceName,
        created_at: new Date().toISOString()
      }))

      const { error: insertError } = await supabase
        .from('knowledge_items')
        .insert(knowledgeItems)

      if (insertError) {
        logger.error('Error inserting new facts:', insertError)
        throw new Error(`Failed to insert new facts: ${insertError.message}`)
      }
    }

    const duration = Date.now() - startTime
    logger.info(`✅ Successfully updated chunk ${chunkId} in ${duration}ms`)

    return NextResponse.json({
      success: true,
      message: 'Chunk und Fakten erfolgreich aktualisiert',
      processingTime: duration,
      updates: {
        chunkUpdated: !!newChunkContent,
        factsUpdated: updatedFacts ? Object.keys(updatedFacts).length : 0,
        factsAdded: newFacts ? newFacts.filter((f: string) => f.trim()).length : 0,
        factsDeleted: deletedFactIds ? deletedFactIds.length : 0
      }
    })

  } catch (error: any) {
    const duration = Date.now() - startTime
    logger.error(`💥 Error updating chunk ${chunkId || 'unknown'} after ${duration}ms:`, error)
    
    return NextResponse.json(
      { error: `Update fehlgeschlagen: ${error.message}` },
      { status: 500 }
    )
  }
} 
