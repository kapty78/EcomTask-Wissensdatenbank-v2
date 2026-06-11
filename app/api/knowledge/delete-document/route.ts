import { NextResponse } from "next/server";
import { getRouteAuth } from "@/lib/route-auth";

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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
