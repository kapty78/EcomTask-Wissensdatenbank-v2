import { NextResponse } from "next/server";
import { getRouteAuth } from "@/lib/route-auth";
import { enqueueGraphJob, resolveGraphTarget } from "@/lib/knowledge-base/graph-enqueue";

export async function DELETE(request: Request) {
  try {
    // Auth (Bearer im Embedded-Modus, sonst Cookies)
    const auth = await getRouteAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { user, supabase } = auth;

    const { documentId } = await request.json();

    if (!documentId) {
      return NextResponse.json(
        { error: "Missing documentId" },
        { status: 400 }
      );
    }

    // Graph-Ziel VOR dem Löschen auflösen — danach gibt es keine
    // knowledge_items mehr, aus denen sich KB und Firma ableiten ließen.
    const graphTarget = await resolveGraphTarget(documentId);

    const { error: rpcError } = await supabase.rpc(
      "delete_document_and_related_data",
      {
        doc_id: documentId,
        user_id_check: user.id
      }
    );

    if (rpcError) {
      return NextResponse.json(
        { error: rpcError.message },
        { status: 500 }
      );
    }

    // Aufräum-Lauf ohne documentId: das Dokument existiert nicht mehr,
    // aber seine Entitäten und Kanten schon. Ohne das bleiben sie für
    // immer im Graphen und wirken weiter in die Antworten hinein.
    if (graphTarget) {
      await enqueueGraphJob(
        {
          companyId: graphTarget.companyId,
          knowledgeBaseId: graphTarget.knowledgeBaseId
        },
        'delete'
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
