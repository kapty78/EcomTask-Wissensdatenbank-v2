import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { createClient } from "@supabase/supabase-js"

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const authClient = createRouteHandlerClient({ cookies: () => cookieStore })

    // Also check Bearer token
    const authHeader = request.headers.get("authorization")
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
    let userId: string | null = null

    if (bearerToken) {
      const tokenClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
      )
      const { data } = await tokenClient.auth.getUser()
      userId = data?.user?.id || null
    }

    if (!userId) {
      const { data: { user }, error } = await authClient.auth.getUser()
      if (error || !user) return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 })
      userId = user.id
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "Keine Datei" }, { status: 400 })
    if (file.size > 200 * 1024 * 1024) return NextResponse.json({ error: "Max 200MB" }, { status: 400 })

    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const ext = file.name.split(".").pop() || "bin"
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const storagePath = `agent-uploads/${userId}/${fileId}.${ext}`

    const { error: uploadError } = await serviceClient.storage
      .from("documents")
      .upload(storagePath, file, { contentType: file.type, upsert: true })

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

    const { data: urlData } = serviceClient.storage.from("documents").getPublicUrl(storagePath)

    return NextResponse.json({
      url: urlData.publicUrl,
      name: file.name,
      type: file.type,
      size: file.size
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Upload fehlgeschlagen" }, { status: 500 })
  }
}
