import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { verifyRegisterToken } from "@/lib/register-token"

// Läuft bewusst OHNE Session: Nach signUp mit E-Mail-Bestätigung ist der User
// noch nicht eingeloggt. Autorisierung erfolgt über den Registrierungs-Token
// aus /api/register-company plus die Erst-Admin-Regel (eine Firma mit
// bestehendem Admin kann nicht übernommen werden).
export async function POST(request: Request) {
  try {
    const { userId, companyId, registrationToken, email, fullName } = await request.json()

    if (!userId || !companyId) {
      return NextResponse.json({ error: "User ID und Company ID sind erforderlich" }, { status: 400 })
    }
    if (!verifyRegisterToken(companyId, registrationToken)) {
      return NextResponse.json(
        { error: "Ungültiger oder abgelaufener Registrierungs-Token. Bitte starten Sie die Registrierung erneut." },
        { status: 403 }
      )
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId)
    if (userError || !userData?.user) {
      return NextResponse.json({ error: "Benutzer wurde nicht gefunden" }, { status: 404 })
    }
    const user = userData.user

    const { data: existingAdmins, error: adminCheckError } = await admin
      .from("company_admins")
      .select("user_id")
      .eq("company_id", companyId)

    if (adminCheckError) {
      return NextResponse.json(
        { error: `Fehler bei der Admin-Prüfung: ${adminCheckError.message}` },
        { status: 500 }
      )
    }

    const isAlreadyAdmin = (existingAdmins ?? []).some((a) => a.user_id === userId)
    if (!isAlreadyAdmin && (existingAdmins ?? []).length > 0) {
      return NextResponse.json(
        { error: "Diese Firma hat bereits einen Administrator." },
        { status: 403 }
      )
    }

    if (!isAlreadyAdmin) {
      const { error: rpcError } = await admin.rpc("create_company_admin", {
        p_user_id: userId,
        p_company_id: companyId
      })
      if (rpcError) {
        console.error("Error creating company admin via RPC:", rpcError)
        return NextResponse.json(
          { error: `Fehler bei der Admin-Zuweisung: ${rpcError.message}` },
          { status: 500 }
        )
      }
    }

    // Profil direkt mitanlegen — ersetzt den früheren ungeschützten
    // create-profile-direct-Aufruf und macht die Registrierung einschrittig.
    const { data: company } = await admin
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle()

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        email: email || user.email,
        full_name: fullName || user.user_metadata?.full_name || user.user_metadata?.name || null,
        company_id: companyId,
        company_name: company?.name ?? null,
        can_upload: true,
        updated_at: new Date().toISOString()
      },
      { onConflict: "id" }
    )

    if (profileError) {
      console.error("Error creating profile in register-admin:", profileError)
      return NextResponse.json(
        { error: `Fehler beim Anlegen des Profils: ${profileError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Unexpected error in register-admin route:", err)
    const message = err instanceof Error ? err.message : "Ein unerwarteter Fehler ist aufgetreten"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
