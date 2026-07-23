import { NextResponse } from "next/server"
import { getRouteAuth } from "@/lib/route-auth"
import { enqueueGraphJob } from "@/lib/knowledge-base/graph-enqueue"

type DeleteSourceRequest = {
  knowledgeBaseId: string
  sourceName: string
}

async function deleteDocumentTreeFallback(
  supabase: any,
  documentId: string,
  userId: string
) {
  const { data: ownedDoc, error: ownedDocError } = await supabase
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle()

  if (ownedDocError) {
    throw new Error(ownedDocError.message)
  }

  if (!ownedDoc) {
    throw new Error("Document not found or user does not have permission")
  }

  const { data: chunkRows, error: chunkRowsError } = await supabase
    .from("document_chunks")
    .select("id")
    .eq("document_id", documentId)

  if (chunkRowsError) {
    throw new Error(chunkRowsError.message)
  }

  const chunkIds = (chunkRows || []).map((row: any) => row.id)

  const { error: deleteKnowledgeItemsByDocumentError } = await supabase
    .from("knowledge_items")
    .delete()
    .eq("document_id", documentId)

  if (deleteKnowledgeItemsByDocumentError) {
    throw new Error(deleteKnowledgeItemsByDocumentError.message)
  }

  if (chunkIds.length > 0) {
    const { error: deleteKnowledgeItemsByChunkError } = await supabase
      .from("knowledge_items")
      .delete()
      .in("source_chunk", chunkIds)

    if (deleteKnowledgeItemsByChunkError) {
      throw new Error(deleteKnowledgeItemsByChunkError.message)
    }
  }

  const { error: deleteProcessingStatusError } = await supabase
    .from("document_processing_status")
    .delete()
    .eq("document_id", documentId)

  if (deleteProcessingStatusError) {
    throw new Error(deleteProcessingStatusError.message)
  }

  const { error: deleteChunksError } = await supabase
    .from("document_chunks")
    .delete()
    .eq("document_id", documentId)

  if (deleteChunksError) {
    throw new Error(deleteChunksError.message)
  }

  const { error: deleteDocumentError } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("user_id", userId)

  if (deleteDocumentError) {
    throw new Error(deleteDocumentError.message)
  }
}

export async function DELETE(request: Request) {
  try {
    // Auth (Bearer im Embedded-Modus, sonst Cookies)
    const auth = await getRouteAuth(request)
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const supabase = auth.supabase
    const session = { user: auth.user }

    const body: DeleteSourceRequest = await request.json()
    const knowledgeBaseId = body.knowledgeBaseId
    const sourceName = body.sourceName?.trim()

    if (!knowledgeBaseId || !sourceName) {
      return NextResponse.json(
        { error: "knowledgeBaseId und sourceName sind erforderlich" },
        { status: 400 }
      )
    }

    const { data: matchingRows, error: matchingRowsError } = await supabase
      .from("knowledge_items")
      .select("id, document_id, company_id")
      .eq("knowledge_base_id", knowledgeBaseId)
      .eq("source_name", sourceName)

    // company_id VOR dem Löschen sichern — danach gibt es keine Zeile mehr,
    // aus der sie sich ableiten ließe, und der Graph-Aufräumlauf braucht sie.
    const companyIdForGraph: string | null =
      (matchingRows || []).find((r: any) => r?.company_id)?.company_id ?? null

    if (matchingRowsError) {
      return NextResponse.json(
        { error: matchingRowsError.message },
        { status: 500 }
      )
    }

    if (!matchingRows || matchingRows.length === 0) {
      return NextResponse.json(
        { error: `Quelle "${sourceName}" wurde in dieser Wissensdatenbank nicht gefunden` },
        { status: 404 }
      )
    }

    const { data: deletedItems, error: deleteError } = await supabase
      .from("knowledge_items")
      .delete()
      .eq("knowledge_base_id", knowledgeBaseId)
      .eq("source_name", sourceName)
      .select("id")

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      )
    }

    const deletedCount = deletedItems?.length || 0
    if (deletedCount === 0) {
      return NextResponse.json(
        {
          error:
            `Quelle "${sourceName}" gefunden, aber keine Zeile konnte gelöscht werden. ` +
            "Möglicherweise fehlt DELETE-Berechtigung (RLS)."
        },
        { status: 403 }
      )
    }

    // Optional cleanup:
    // If source rows belonged to documents and those documents now have no
    // knowledge_items left in this KB, remove the document tree as well.
    const relatedDocumentIds = Array.from(
      new Set(
        (matchingRows || [])
          .map((row: any) => row.document_id)
          .filter((docId: unknown): docId is string => typeof docId === "string" && docId.length > 0)
      )
    )

    const deletedDocumentIds: string[] = []
    const documentCleanupErrors: Array<{ documentId: string; error: string }> = []

    for (const documentId of relatedDocumentIds) {
      const { data: remainingItems, error: remainingItemsError } = await supabase
        .from("knowledge_items")
        .select("id")
        .eq("knowledge_base_id", knowledgeBaseId)
        .eq("document_id", documentId)
        .limit(1)

      if (remainingItemsError) {
        documentCleanupErrors.push({
          documentId,
          error: remainingItemsError.message
        })
        continue
      }

      // Document still has other items, do not remove it.
      if (remainingItems && remainingItems.length > 0) {
        continue
      }

      const { error: deleteDocumentError } = await supabase.rpc(
        "delete_document_and_related_data",
        {
          doc_id: documentId,
          user_id_check: session.user.id
        }
      )

      if (deleteDocumentError) {
        const message = String(deleteDocumentError.message || "")
        const functionMissing =
          message.includes("Could not find the function public.delete_document_and_related_data") ||
          message.includes("delete_document_and_related_data")

        if (functionMissing) {
          try {
            await deleteDocumentTreeFallback(supabase, documentId, session.user.id)
            deletedDocumentIds.push(documentId)
            continue
          } catch (fallbackError: any) {
            documentCleanupErrors.push({
              documentId,
              error: fallbackError?.message || "Fallback cleanup failed"
            })
            continue
          }
        }

        documentCleanupErrors.push({
          documentId,
          error: deleteDocumentError.message
        })
        continue
      }

      deletedDocumentIds.push(documentId)
    }

    // Knowledge Graph aufräumen.
    //
    // Löschen ging bisher spurlos am Graphen vorbei: die Entitäten und
    // Beziehungen einer entfernten Quelle blieben stehen und wirkten weiter
    // in die Antworten hinein. Hier gibt es kein Dokument mehr, das man neu
    // extrahieren könnte — deshalb ein Auftrag OHNE documentId/sourceName:
    // der Worker liest das als reinen Aufräum-Lauf und entfernt alles, was
    // ohne Anker zurückgeblieben ist. Manuell gepflegte Verknüpfungen
    // bleiben dabei erhalten.
    if (companyIdForGraph) {
      await enqueueGraphJob(
        { companyId: companyIdForGraph, knowledgeBaseId },
        'delete'
      )
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      deletedDocumentCount: deletedDocumentIds.length,
      deletedDocumentIds,
      cleanupWarnings: documentCleanupErrors
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    )
  }
}
