import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

interface DocumentChunkRow {
  id: string
  content: string | null
  document_id: string
  content_position: number | null
}

interface KnowledgeItemRow {
  id: string
  content: string
  source_name: string
  knowledge_base_id: string
}

interface MergeRequestBody {
  knowledgeBaseId?: string
  primaryChunkId?: string
  chunkIdsToMerge?: string[]
  manualKnowledgeItemIds?: string[]
}

function uniqueArray(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function sanitizeContent(content: string | null | undefined): string {
  return (content ?? '').trim()
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MergeRequestBody
    const knowledgeBaseId = body.knowledgeBaseId
    const primaryChunkId = body.primaryChunkId
    const chunkIdsToMerge = uniqueArray(body.chunkIdsToMerge || [])
    const manualKnowledgeItemIds = uniqueArray(body.manualKnowledgeItemIds || [])

    if (!knowledgeBaseId) {
      return NextResponse.json({ error: 'knowledgeBaseId ist erforderlich' }, { status: 400 })
    }

    if (!primaryChunkId) {
      return NextResponse.json({ error: 'primaryChunkId ist erforderlich' }, { status: 400 })
    }

    if (chunkIdsToMerge.includes(primaryChunkId)) {
      return NextResponse.json({ error: 'primaryChunkId darf nicht in chunkIdsToMerge enthalten sein' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let companyId: string | null = null
    const { data: knowledgeBase, error: knowledgeBaseError } = await supabase
      .from('knowledge_bases')
      .select('company_id')
      .eq('id', knowledgeBaseId)
      .single()

    if (knowledgeBaseError) {
      console.error('[combine-execute] Knowledge Base company lookup failed:', knowledgeBaseError)
    } else if (knowledgeBase?.company_id) {
      companyId = knowledgeBase.company_id
    }

    const { data: primaryChunk, error: primaryError } = await supabase
      .from('document_chunks')
      .select('id, content, document_id, content_position')
      .eq('id', primaryChunkId)
      .single()

    if (primaryError || !primaryChunk) {
      return NextResponse.json(
        { error: 'Primärer Chunk wurde nicht gefunden' },
        { status: 404 }
      )
    }

    const sections: string[] = []
    const warnings: string[] = []

    const cleanedPrimaryContent = sanitizeContent(primaryChunk.content)
    if (cleanedPrimaryContent) {
      sections.push(cleanedPrimaryContent)
    }

    let chunksMarkedForDeletion: DocumentChunkRow[] = []
    let manualItemsToDelete: KnowledgeItemRow[] = []
    let primaryKnowledgeItemIds: string[] = []
    let mergeKnowledgeItemIds: string[] = []

    if (chunkIdsToMerge.length > 0) {
      const { data: mergeChunks, error: mergeError } = await supabase
        .from('document_chunks')
        .select('id, content, document_id, content_position')
        .in('id', chunkIdsToMerge)

      if (mergeError) {
        console.error('[combine-execute] Fehler beim Laden der Merge-Chunks:', mergeError)
        return NextResponse.json(
          { error: 'Zusätzliche Chunks konnten nicht geladen werden' },
          { status: 500 }
        )
      }

      const foundChunkIds = new Set((mergeChunks || []).map(chunk => chunk.id))
      const missingChunks = chunkIdsToMerge.filter(id => !foundChunkIds.has(id))
      if (missingChunks.length > 0) {
        return NextResponse.json(
          { error: `Die folgenden Chunk-IDs wurden nicht gefunden: ${missingChunks.join(', ')}` },
          { status: 404 }
        )
      }

      mergeChunks?.forEach(chunk => {
        const cleaned = sanitizeContent(chunk.content)
        if (cleaned) {
          sections.push(cleaned)
        }
      })

      chunksMarkedForDeletion = mergeChunks as DocumentChunkRow[]
    }

    if (manualKnowledgeItemIds.length > 0) {
      const { data: manualItems, error: manualError } = await supabase
        .from('knowledge_items')
        .select('id, content, source_name, knowledge_base_id')
        .in('id', manualKnowledgeItemIds)

      if (manualError) {
        console.error('[combine-execute] Fehler beim Laden der manuellen Einträge:', manualError)
        return NextResponse.json(
          { error: 'Manuelle Wissenseinträge konnten nicht geladen werden' },
          { status: 500 }
        )
      }

      const invalidKnowledgeItems =
        manualItems?.filter(item => item.knowledge_base_id !== knowledgeBaseId) ?? []
      if (invalidKnowledgeItems.length > 0) {
        return NextResponse.json(
          { error: 'Einige Knowledge Items gehören nicht zur angegebenen Knowledge Base' },
          { status: 403 }
        )
      }

      const groupedManualContent = new Map<string, string[]>()
      manualItems?.forEach(item => {
        const key = item.source_name || 'Manuelle Notiz'
        const existing = groupedManualContent.get(key) || []
        const cleaned = sanitizeContent(item.content)
        if (cleaned) {
          existing.push(cleaned)
          groupedManualContent.set(key, existing)
        }
      })

      const manualSections = Array.from(groupedManualContent.entries()).map(([source, contents]) => {
        return `${source}:\n${contents.join('\n')}`
      })

      if (manualSections.length > 0) {
        sections.push(manualSections.join('\n\n'))
      }

      manualItemsToDelete = manualItems as KnowledgeItemRow[]
    }

    // Sammle bestehende Fakten zur späteren Bereinigung (nur bei erfolgreicher Regeneration)
    const { data: primaryKnowledgeItems, error: primaryFactsLoadError } = await supabase
      .from('knowledge_items')
      .select('id')
      .eq('source_chunk', primaryChunkId)

    if (primaryFactsLoadError) {
      console.error('[combine-execute] Fehler beim Laden der Fakten des primären Chunks:', primaryFactsLoadError)
      warnings.push('Fakten des primären Chunks konnten nicht geladen werden. Bitte prüfen Sie die Daten manuell.')
    } else {
      primaryKnowledgeItemIds = (primaryKnowledgeItems || []).map(item => item.id)
    }

    if (chunkIdsToMerge.length > 0) {
      const { data: mergeFacts, error: mergeFactsError } = await supabase
        .from('knowledge_items')
        .select('id')
        .in('source_chunk', chunkIdsToMerge)

      if (mergeFactsError) {
        console.error('[combine-execute] Fehler beim Laden der Fakten der Merge-Chunks:', mergeFactsError)
        warnings.push('Fakten der zusammenzuführenden Chunks konnten nicht vollständig geladen werden.')
      } else {
        mergeKnowledgeItemIds = (mergeFacts || []).map(item => item.id)
      }
    }

    const newContent = sections.join('\n\n').trim()

    const { error: updateChunkError } = await supabase
      .from('document_chunks')
      .update({
        content: newContent,
        updated_at: new Date().toISOString()
      })
      .eq('id', primaryChunkId)

    if (updateChunkError) {
      console.error('[combine-execute] Fehler beim Aktualisieren des primären Chunks:', updateChunkError)
      return NextResponse.json(
        { error: 'Primärer Chunk konnte nicht aktualisiert werden' },
        { status: 500 }
      )
    }

    // Schritt 1: Backup der betroffenen Chunks und Fakten (für Rollback)
    const backupData: any = {
      primaryChunk: primaryChunk,
      mergeChunks: chunksMarkedForDeletion,
      primaryKnowledgeItemIds,
      mergeKnowledgeItemIds,
      manualKnowledgeItemIds: manualItemsToDelete.map(item => item.id)
    }

    // Regeneriere Fakten über N8N Webhook
    let regenerationTriggered = false
    let cleanupCompleted = false
    const webhookUrl = process.env.N8N_WEBHOOK_URL_FACTS

    if (!webhookUrl) {
      warnings.push('N8N Webhook URL ist nicht konfiguriert. Bitte Fakten manuell regenerieren.')
    } else {
      const { data: document, error: documentError } = await supabase
        .from('documents')
        .select('id, title, file_name, file_type, storage_url, workspace_id, user_id, company_id')
        .eq('id', primaryChunk.document_id)
        .single()

      if (documentError || !document) {
        console.error('[combine-execute] Dokument konnte für die Fakten-Regenerierung nicht geladen werden:', documentError)
        warnings.push('Dokument konnte nicht geladen werden. Fakten-Regenerierung wurde übersprungen.')
      } else {
        if (!companyId && document.company_id) {
          companyId = document.company_id
        }

        const payload = {
          document: {
            id: document.id,
            title: document.title || document.file_name || null,
            file_name: document.file_name || null,
            file_type: document.file_type || null,
            storage_url: document.storage_url || null,
            workspace_id: document.workspace_id,
            company_id: companyId,
            knowledge_base_id: knowledgeBaseId,
            user_id: document.user_id
          },
          chunk: {
            id: primaryChunkId,
            content: newContent,
            position: primaryChunk.content_position,
            regenerate_facts: true
          },
          options: {
            language: 'de',
            max_facts_per_chunk: 20,
            create_embeddings: true,
            embedding_provider: 'openai',
            source_type: 'combine_merge',
            knowledge_base_id: knowledgeBaseId
          }
        }

        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          })

          if (!response.ok) {
            const errorText = await response.text()
            console.error('[combine-execute] N8N Webhook Antwort:', response.status, errorText)
            warnings.push('Fakten-Regenerierung konnte nicht gestartet werden. Bitte später erneut versuchen.')

            // Rollback: Lasche Änderungen rückgängig machen
            try {
              await supabase
                .from('document_chunks')
                .update({
                  content: primaryChunk.content,
                  updated_at: primaryChunk.updated_at || primaryChunk.created_at || new Date().toISOString()
                })
                .eq('id', primaryChunkId)
            } catch (rollbackError) {
              console.error('[combine-execute] Rollback fehlgeschlagen:', rollbackError)
              warnings.push('Rollback nach fehlgeschlagener Fakten-Regenerierung ist fehlgeschlagen. Bitte prüfen Sie den Haupt-Chunk manuell.')
            }

            return NextResponse.json(
              {
                error: 'Fakten-Regenerierung konnte nicht gestartet werden. Die Zusammenführung wurde zurückgesetzt.',
                warnings
              },
              { status: 500 }
            )

          } else {
            regenerationTriggered = true
            // cleanupCompleted is set to true only after ALL deletions succeed
            let allCleanupSucceeded = true

            // Fakten und Chunks nur löschen, wenn Regeneration erfolgreich angestoßen wurde
            if (primaryKnowledgeItemIds.length > 0) {
              const { error: deletePrimaryFactsError } = await supabase
                .from('knowledge_items')
                .delete()
                .in('id', primaryKnowledgeItemIds)

              if (deletePrimaryFactsError) {
                console.error('[combine-execute] Fehler beim Löschen der Fakten des primären Chunks:', deletePrimaryFactsError)
                warnings.push('Bestehende Fakten des Haupt-Chunks konnten nicht entfernt werden.')
                allCleanupSucceeded = false
              }
            }

            if (manualItemsToDelete.length > 0) {
              const { error: deleteManualItemsError } = await supabase
                .from('knowledge_items')
                .delete()
                .in('id', manualItemsToDelete.map(item => item.id))

              if (deleteManualItemsError) {
                console.error('[combine-execute] Fehler beim Löschen manueller Knowledge Items:', deleteManualItemsError)
                warnings.push('Manuelle Knowledge Items konnten nicht entfernt werden.')
                allCleanupSucceeded = false
              }
            }

            if (mergeKnowledgeItemIds.length > 0) {
              const { error: deleteMergeFactsError } = await supabase
                .from('knowledge_items')
                .delete()
                .in('id', mergeKnowledgeItemIds)

              if (deleteMergeFactsError) {
                console.error('[combine-execute] Fehler beim Entfernen der Fakten der Merge-Chunks:', deleteMergeFactsError)
                warnings.push('Fakten der zusammengeführten Chunks konnten nicht vollständig gelöscht werden.')
                allCleanupSucceeded = false
              }
            }

            if (chunksMarkedForDeletion.length > 0) {
              const chunkIds = chunksMarkedForDeletion.map(chunk => chunk.id)
              const { error: deleteChunksError } = await supabase
                .from('document_chunks')
                .delete()
                .in('id', chunkIds)

              if (deleteChunksError) {
                console.error('[combine-execute] Fehler beim Löschen der zusammengeführten Chunks:', deleteChunksError)
                warnings.push('Einige der zusammengeführten Chunks konnten nicht gelöscht werden.')
                allCleanupSucceeded = false
              }
            }

            // Only mark cleanup as complete when every deletion step succeeded
            cleanupCompleted = allCleanupSucceeded
          }
        } catch (error) {
          console.error('[combine-execute] Fehler beim Aufrufen des N8N Webhooks:', error)
          warnings.push('Fakten-Regenerierung konnte nicht gestartet werden. Bitte später erneut versuchen.')
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Chunks wurden erfolgreich kombiniert.',
      data: {
        primaryChunkId,
        mergedChunkIds: chunkIdsToMerge,
        removedManualKnowledgeItems: manualItemsToDelete.map(item => item.id),
        newContentLength: newContent.length,
        regenerationTriggered,
        cleanupCompleted,
        warnings
      }
    })
  } catch (error) {
    console.error('[combine-execute] Unerwarteter Fehler:', error)
    return NextResponse.json(
      { error: 'Kombination der Chunks ist fehlgeschlagen' },
      { status: 500 }
    )
  }
}


