import { NextResponse } from "next/server"
import { getRouteAuth } from "@/lib/route-auth"

export async function POST(request: Request) {
  const { knowledgeBaseId, newName } = await request.json()

  try {
    // Auth (Bearer im Embedded-Modus, sonst Cookies)
    const auth = await getRouteAuth(request)
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const supabase = auth.supabase

    if (!knowledgeBaseId || !newName) {
      return NextResponse.json(
        { error: "Knowledge base ID and new name are required" },
        { status: 400 }
      )
    }

    // ✅ COMPANY SHARING: RLS Policy erlaubt UPDATE für alle Company-Mitglieder
    // Kein .eq("user_id") mehr benötigt
    const { data, error } = await supabase
      .from("knowledge_bases")
      .update({ name: newName })
      .eq("id", knowledgeBaseId)
      .select()
      .single()

    if (error) {
      console.error("Error renaming knowledge base:", error)
      return NextResponse.json(
        { error: "Failed to rename knowledge base" },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
