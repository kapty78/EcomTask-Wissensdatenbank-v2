import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

type RenameSourceRequest = {
  knowledgeBaseId: string
  documentId?: string | null
  sourceName?: string | null
  newName: string
}

export async function POST(request: Request) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

  try {
    const {
      data: { session },
      error: sessionError
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body: RenameSourceRequest = await request.json()
    const knowledgeBaseId = body.knowledgeBaseId
    const documentId = body.documentId || null
    const sourceName = body.sourceName?.trim() || null
    const newName = body.newName?.trim()

    if (!knowledgeBaseId || !newName) {
      return NextResponse.json(
        { error: "knowledgeBaseId und newName sind erforderlich" },
        { status: 400 }
      )
    }

    if (!documentId && !sourceName) {
      return NextResponse.json(
        { error: "documentId oder sourceName ist erforderlich" },
        { status: 400 }
      )
    }

    if (documentId) {
      const { data: updatedDocument, error: updateDocumentError } = await supabase
        .from("documents")
        .update({ title: newName })
        .eq("id", documentId)
        .select("id")
        .single()

      if (updateDocumentError || !updatedDocument) {
        return NextResponse.json(
          { error: updateDocumentError?.message || "Dokument konnte nicht umbenannt werden" },
          { status: 500 }
        )
      }

      const { error: documentItemsUpdateError } = await supabase
        .from("knowledge_items")
        .update({ source_name: newName })
        .eq("knowledge_base_id", knowledgeBaseId)
        .eq("document_id", documentId)

      if (documentItemsUpdateError) {
        return NextResponse.json(
          { error: documentItemsUpdateError.message },
          { status: 500 }
        )
      }

      const { data: chunkRows, error: chunksError } = await supabase
        .from("document_chunks")
        .select("id")
        .eq("document_id", documentId)

      if (chunksError) {
        return NextResponse.json(
          { error: chunksError.message },
          { status: 500 }
        )
      }

      const chunkIds = (chunkRows || []).map(chunk => chunk.id)
      const chunkBatchSize = 200

      for (let i = 0; i < chunkIds.length; i += chunkBatchSize) {
        const chunkBatch = chunkIds.slice(i, i + chunkBatchSize)
        const { error: chunkItemsUpdateError } = await supabase
          .from("knowledge_items")
          .update({ source_name: newName })
          .eq("knowledge_base_id", knowledgeBaseId)
          .in("source_chunk", chunkBatch)

        if (chunkItemsUpdateError) {
          return NextResponse.json(
            { error: chunkItemsUpdateError.message },
            { status: 500 }
          )
        }
      }

      return NextResponse.json({
        success: true,
        type: "document",
        updatedDocumentId: documentId
      })
    }

    const { data: matchingLegacyRows, error: matchingLegacyRowsError } = await supabase
      .from("knowledge_items")
      .select("id, document_id")
      .eq("knowledge_base_id", knowledgeBaseId)
      .eq("source_name", sourceName)

    if (matchingLegacyRowsError) {
      return NextResponse.json(
        { error: matchingLegacyRowsError.message },
        { status: 500 }
      )
    }

    const matchingRows = matchingLegacyRows || []
    if (matchingRows.length === 0) {
      return NextResponse.json(
        { error: `Quelle "${sourceName}" wurde in dieser Wissensdatenbank nicht gefunden` },
        { status: 404 }
      )
    }

    const { data: updatedLegacyItems, error: legacyUpdateError } = await supabase
      .from("knowledge_items")
      .update({ source_name: newName })
      .eq("knowledge_base_id", knowledgeBaseId)
      .eq("source_name", sourceName)
      .select("id, document_id")

    if (legacyUpdateError) {
      return NextResponse.json(
        { error: legacyUpdateError.message },
        { status: 500 }
      )
    }

    const updatedCount = updatedLegacyItems?.length || 0
    if (updatedCount === 0) {
      return NextResponse.json(
        {
          error:
            `Quelle "${sourceName}" gefunden, aber keine Zeile konnte aktualisiert werden. ` +
            "Möglicherweise fehlt UPDATE-Berechtigung (RLS)."
        },
        { status: 403 }
      )
    }

    const distinctDocumentIds = Array.from(
      new Set(
        matchingRows
          .map(row => row.document_id)
          .filter((docId): docId is string => typeof docId === "string" && docId.length > 0)
      )
    )

    if (distinctDocumentIds.length === 1) {
      const singleDocumentId = distinctDocumentIds[0]
      const { error: documentRenameError } = await supabase
        .from("documents")
        .update({ title: newName })
        .eq("id", singleDocumentId)

      if (documentRenameError) {
        // Kein Hard-Fail: Primärziel ist source_name in knowledge_items.
        // Fehler wird bewusst nicht an den Client propagiert.
      }
    }

    return NextResponse.json({
      success: true,
      type: "legacy",
      updatedCount
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    )
  }
}
