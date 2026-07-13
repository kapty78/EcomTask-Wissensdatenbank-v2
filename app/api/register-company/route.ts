import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createRegisterToken } from "@/lib/register-token"

const DOMAIN_SUFFIX = ".app.ecomtask.cloud"

export async function POST(request: Request) {
  try {
    const { companyName, accountName } = await request.json()

    if (!companyName || !String(companyName).trim()) {
      return NextResponse.json({ error: "Bitte geben Sie einen Unternehmensnamen ein" }, { status: 400 })
    }
    if (!accountName || !String(accountName).trim()) {
      return NextResponse.json({ error: "Bitte geben Sie einen Account-Namen ein" }, { status: 400 })
    }

    const slug = String(accountName).toLowerCase().replace(/[^a-z0-9]/g, "")
    if (!slug) {
      return NextResponse.json(
        { error: "Der Account-Name muss mindestens einen Buchstaben oder eine Zahl enthalten" },
        { status: 400 }
      )
    }
    const domain = `${slug}${DOMAIN_SUFFIX}`

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: existingCompany, error: checkError } = await admin
      .from("companies")
      .select("id")
      .eq("domain", domain)
      .maybeSingle()

    if (checkError) {
      return NextResponse.json({ error: `Fehler bei der Überprüfung: ${checkError.message}` }, { status: 500 })
    }
    if (existingCompany) {
      return NextResponse.json(
        { error: `Der Account-Name "${accountName}" ist bereits vergeben. Bitte wählen Sie einen anderen Namen.` },
        { status: 409 }
      )
    }

    const { data, error } = await admin
      .from("companies")
      .insert({ name: String(companyName).trim(), domain })
      .select("id")
      .single()

    if (error) {
      return NextResponse.json({ error: `Fehler beim Erstellen des Unternehmens: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({
      companyId: data.id,
      registrationToken: createRegisterToken(data.id)
    })
  } catch (err) {
    console.error("Unexpected error in register-company route:", err)
    const message = err instanceof Error ? err.message : "Ein unerwarteter Fehler ist aufgetreten"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
