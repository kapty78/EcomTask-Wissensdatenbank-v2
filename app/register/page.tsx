"use client"

import { useState, useEffect } from "react"
import { getSupabaseClient } from "@/lib/supabase-browser"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { SquaresBackground } from "@/components/ui/squares-background"

type RegisterStep = "company" | "admin"

export default function Register() {
  // State für den Registrierungsprozess
  const [step, setStep] = useState<RegisterStep>("company")

  // Firmendaten
  const [companyName, setCompanyName] = useState("")
  const [accountName, setAccountName] = useState("")
  const [companyId, setCompanyId] = useState<string | null>(null)

  // Admin-Daten
  const [adminName, setAdminName] = useState("")
  const [adminEmail, setAdminEmail] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  // UI-States
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const router = useRouter()
  const supabase = getSupabaseClient()

  // Unternehmen registrieren
  const handleRegisterCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Validierungen
      if (!companyName.trim()) {
        throw new Error("Bitte geben Sie einen Unternehmensnamen ein")
      }

      if (!accountName.trim()) {
        throw new Error("Bitte geben Sie einen Account-Namen ein")
      }

      // Prüfen ob der Account-Name bereits existiert
      const domain = `${accountName.toLowerCase().replace(/[^a-z0-9]/g, "")}.app.ecomtask.cloud`
      const { data: existingCompany, error: checkError } = await supabase
        .from("companies")
        .select("id")
        .or(`domain.eq.${domain}`)
        .maybeSingle()

      if (checkError) {
        throw new Error(`Fehler bei der Überprüfung: ${checkError.message}`)
      }

      if (existingCompany) {
        throw new Error(
          `Der Account-Name "${accountName}" ist bereits vergeben. Bitte wählen Sie einen anderen Namen.`
        )
      }

      // Unternehmen in der Datenbank erstellen
      const { data, error } = await supabase
        .from("companies")
        .insert({
          name: companyName.trim(),
          domain: domain
        })
        .select("id")
        .single()

      if (error) {
        throw new Error(
          `Fehler beim Erstellen des Unternehmens: ${error.message}`
        )
      }

      // Unternehmen erfolgreich erstellt, speichere ID für den nächsten Schritt
      setCompanyId(data.id)

      // Zum Admin-Formular wechseln
      setStep("admin")
      setSuccess("Unternehmen erfolgreich angelegt!")
    } catch (err: any) {
      setError(err.message || "Ein unbekannter Fehler ist aufgetreten")
    } finally {
      setLoading(false)
    }
  }

  // Admin-Account erstellen
  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Validierungen
      if (!adminName.trim()) {
        throw new Error("Bitte geben Sie einen Namen ein")
      }

      if (!adminEmail.trim()) {
        throw new Error("Bitte geben Sie eine E-Mail-Adresse ein")
      }

      if (adminPassword.length < 8) {
        throw new Error("Das Passwort muss mindestens 8 Zeichen lang sein")
      }

      if (adminPassword !== confirmPassword) {
        throw new Error("Die Passwörter stimmen nicht überein")
      }

      if (!companyId) {
        throw new Error(
          "Unternehmens-ID fehlt. Bitte starten Sie den Prozess erneut."
        )
      }


      // 1. Benutzer in Auth erstellen
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: adminEmail,
        password: adminPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: adminName,
            company_id: companyId,
            company_name: companyName,
            preferred_language: 'de',
            pending_archive: false,
            role: 'admin'
          }
        }
      })

      if (authError) {
        // Handle specific rate limit error
        if (authError.message?.includes('rate limit') || authError.message?.includes('email rate limit exceeded')) {
          throw new Error(
            `E-Mail-Limit erreicht: Zu viele Registrierungsversuche. Bitte warten Sie 10-15 Minuten oder kontaktieren Sie den Administrator für eine manuelle Aktivierung.`
          )
        }
        
        throw new Error(
          `Fehler bei der Erstellung des Accounts: ${authError.message}`
        )
      }

      if (!authData.user) {
        throw new Error("Benutzer konnte nicht erstellt werden")
      }

      // 2. Admin-Eintrag erstellen mit unserer API-Route
      try {
        const response = await fetch("/api/register-admin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            userId: authData.user.id,
            companyId: companyId
          })
        })

        const data = await response.json()

        if (!response.ok) {
          // console.error("Admin-Erstellung fehlgeschlagen:", data)
          throw new Error(
            `Fehler bei der Zuweisung der Admin-Rolle: ${data.error || response.statusText}`
          )
        }
      } catch (adminError) {
        // console.error("Admin-Erstellung fehlgeschlagen:", adminError)
        throw new Error(
          `Fehler bei der Zuweisung der Admin-Rolle: ${adminError instanceof Error ? adminError.message : String(adminError)}`
        )
      }

      // 3. Profil direkt nach der Registrierung erstellen (mit Service Role Key)
      try {
        console.log('Registrierung: Erstelle Profil direkt mit Service Role:', {
          userId: authData.user.id,
          email: adminEmail,
          companyId,
          companyName,
          fullName: adminName
        })
        
        // Erstelle eine spezielle API-Route die das Profil mit Service Role erstellt
        const profileResponse = await fetch('/api/auth/create-profile-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: authData.user.id,
            email: adminEmail,
            companyId,
            companyName,
            fullName: adminName
          })
        })
        
        if (!profileResponse.ok) {
          const profileError = await profileResponse.json()
          console.error('Direkte Profil-Erstellung fehlgeschlagen:', profileError)
          // Don't throw error - profile will be created on login
          console.warn('Profil wird beim Login erstellt als Fallback')
        } else {
          console.log('Profil erfolgreich direkt erstellt')
        }
      } catch (profileError) {
        console.error('Fehler bei direkter Profil-Erstellung:', profileError)
        console.warn('Profil wird beim Login erstellt als Fallback')
      }

      // Erfolgreich registriert!
      if (authData.user && !authData.user.email_confirmed_at) {
        // Email confirmation required
        setSuccess(
          `Administrator-Konto erfolgreich erstellt! Bitte prüfen Sie Ihre E-Mail (${adminEmail}) und klicken Sie auf den Bestätigungslink, um Ihr Konto zu aktivieren.`
        )
      } else {
        // User is already confirmed (shouldn't happen with email confirmation enabled)
        setSuccess(
          "Administrator-Konto erfolgreich erstellt! Sie können sich jetzt anmelden."
        )
        setTimeout(() => {
          router.push("/login")
        }, 2000)
      }
    } catch (err: any) {
      setError(err.message || "Ein unbekannter Fehler ist aufgetreten")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#1e1e1e] p-4 sm:p-6 text-white w-full relative">
      <SquaresBackground squareSize={25} color="#ff55c9" opacity={0.12} speed={0.3} />
      <div className="flex flex-col items-center justify-center w-full max-w-sm mx-auto relative z-10">
        <div className="mb-4 sm:mb-6 text-center">
          <div className="mt-4 sm:mt-8 mb-2">
            <Image
              src="/EcomTask.svg"
              alt="EcomTask Logo"
              width={220}
              height={56}
              priority
              className="mx-auto w-[180px] h-auto sm:w-[220px]"
            />
          </div>
          <p className="mb-3 sm:mb-4 text-center text-xs sm:text-sm text-white px-2">
            {step === "company"
              ? "Erstellen Sie ein neues Unternehmen"
              : "Erstellen Sie einen Admin-Account"}
          </p>
        </div>

        {error && (
          <div className="mb-4 sm:mb-6 rounded-md bg-[#444444] p-3 text-center w-full">
            <p className="text-xs sm:text-sm text-red-400">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 sm:mb-6 rounded-md bg-[#444444] p-3 text-center w-full">
            <p className="text-xs sm:text-sm text-green-400">{success}</p>
          </div>
        )}

        {step === "company" ? (
          <form onSubmit={handleRegisterCompany} className="w-full space-y-4 px-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Unternehmensname
              </label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="block w-full rounded-md border-0 bg-[#333333] px-3 py-2.5 sm:py-2 text-sm sm:text-base text-white shadow-sm ring-1 ring-inset ring-[#444444] placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-[#555555]"
                placeholder="Muster GmbH"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Account-Name
              </label>
              <div className="flex rounded-md shadow-sm">
                <input
                  type="text"
                  value={accountName}
                  onChange={e =>
                    setAccountName(
                      e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "")
                    )
                  }
                  className="block w-full rounded-l-md border-0 bg-[#333333] px-3 py-2.5 sm:py-2 text-sm sm:text-base text-white shadow-sm ring-1 ring-inset ring-[#444444] placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-[#555555]"
                  required
                />
                <span className="inline-flex items-center rounded-r-md border border-l-0 border-[#444444] bg-[#444444] px-2 sm:px-3 text-xs sm:text-sm text-gray-400">
                  .app.ecomtask.cloud
                </span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center rounded-full bg-white px-3 py-3 sm:py-3.5 text-sm sm:text-base font-semibold text-[#1e1e1e] shadow-sm hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
              >
                {loading ? "Wird erstellt..." : "Unternehmen erstellen"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreateAdmin} className="w-full space-y-4 sm:space-y-6 px-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Ihr Name
              </label>
              <input
                type="text"
                value={adminName}
                onChange={e => setAdminName(e.target.value)}
                className="block w-full rounded-md border-0 bg-[#333333] px-3 py-2.5 sm:py-2 text-sm sm:text-base text-white shadow-sm ring-1 ring-inset ring-[#444444] placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-[#555555]"
                placeholder="Max Mustermann"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                E-Mail-Adresse
              </label>
              <input
                type="email"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
                className="block w-full rounded-md border-0 bg-[#333333] px-3 py-2.5 sm:py-2 text-sm sm:text-base text-white shadow-sm ring-1 ring-inset ring-[#444444] placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-[#555555]"
                placeholder="max.mustermann@firma.de"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Passwort
              </label>
              <input
                type="password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                className="block w-full rounded-md border-0 bg-[#333333] px-3 py-2.5 sm:py-2 text-sm sm:text-base text-white shadow-sm ring-1 ring-inset ring-[#444444] placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-[#555555]"
                placeholder="Mindestens 8 Zeichen"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Passwort bestätigen
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="block w-full rounded-md border-0 bg-[#333333] px-3 py-2.5 sm:py-2 text-sm sm:text-base text-white shadow-sm ring-1 ring-inset ring-[#444444] placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-[#555555]"
                placeholder="Passwort wiederholen"
                required
              />
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center rounded-full bg-white px-3 py-3 sm:py-3.5 text-sm sm:text-base font-semibold text-[#1e1e1e] shadow-sm hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
              >
                {loading ? "Wird erstellt..." : "Admin-Account erstellen"}
              </button>
              <div className="mt-4 text-center text-xs text-gray-400">oder</div>
              <button
                type="button"
                onClick={async () => {
                  setError(null)
                  setSuccess(null)
                  try {
                    if (!companyId) {
                      setError('Bitte zuerst das Unternehmen anlegen')
                      return
                    }
                    const { data, error } = await supabase.auth.signInWithOAuth({
                      provider: 'azure',
                      options: {
                        redirectTo: `${window.location.origin}/auth/post-oauth-register?companyId=${encodeURIComponent(companyId)}&companyName=${encodeURIComponent(companyName)}`,
                        scopes: 'email openid profile'
                      }
                    })
                    if (error) throw error
                  } catch (e: any) {
                    setError(e?.message || 'Microsoft-Anmeldung fehlgeschlagen')
                  }
                }}
                className="mt-3 w-full rounded-full border border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2.5 sm:py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#333333] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#666666]"
              >
                <span className="flex items-center justify-center gap-2 sm:gap-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="flex-shrink-0">
                    <rect x="1" y="1" width="10" height="10" fill="#F25022"/>
                    <rect x="13" y="1" width="10" height="10" fill="#7FBA00"/>
                    <rect x="1" y="13" width="10" height="10" fill="#00A4EF"/>
                    <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
                  </svg>
                  <span className="text-xs sm:text-sm">Mit Microsoft registrieren</span>
                </span>
              </button>
            </div>
          </form>
        )}

        {!success && (
          <div className="mt-6 sm:mt-8 text-center px-2">
            <p className="text-xs sm:text-sm text-gray-400">
              <Link
                href="/login"
                className="font-medium text-white hover:text-gray-300"
              >
                Zurück zum Login
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
