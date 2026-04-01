import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function POST(request: Request) {
  // Daten aus dem Request extrahieren
  const { userId, companyId } = await request.json()

  if (!userId || !companyId) {
    return NextResponse.json(
      { error: "User ID und Company ID sind erforderlich" },
      { status: 400 }
    )
  }

  // Client for user context (e.g., calling RPC)
  const supabaseUserClient = createRouteHandlerClient({ cookies })

  try {
    // Verify session exists
    const { data: { session }, error: sessionError } = await supabaseUserClient.auth.getSession()
    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // 1. Create company admin relationship (using user context or specific RPC)
    // Assuming 'create_company_admin' RPC correctly handles permissions
    const { error: rpcError } = await supabaseUserClient.rpc(
      "create_company_admin",
      {
        p_user_id: userId,
        p_company_id: companyId
      }
    )

    if (rpcError) {
      console.error("Error creating company admin via RPC:", rpcError)
      return NextResponse.json(
        { error: `Fehler bei der Admin-Zuweisung: ${rpcError.message}` },
        { status: 500 }
      )
    }

    // If we reached here, admin role assignment was successful
    return NextResponse.json({ success: true })
  } catch (err) {
    // Catch potential errors from the RPC call or unexpected issues
    console.error("Unexpected error in register-admin route:", err)
    const message =
      err instanceof Error
        ? err.message
        : "Ein unerwarteter Fehler ist aufgetreten"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
