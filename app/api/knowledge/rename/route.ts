import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { Database } from "@/supabase/types"

export async function POST(request: Request) {
  const { knowledgeBaseId, newName } = await request.json()
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient<Database>({ cookies: () => cookieStore })

  try {
    const {
      data: { session }
    } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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
