"use client"

import { getSupabaseClient } from "@/lib/supabase-browser"
import { useState, useEffect } from "react"
import {
  getSavedDomain,
  saveDomain,
  normalizeDomain,
  formatEmailWithDomain,
  saveCompany,
  CompanyInfo
} from "@/lib/domain-manager"
import { createPkcePair, storeRecoveryVerifier, clearRecoveryVerifier } from "@/lib/auth/pkce"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { SquaresBackground } from "@/components/ui/squares-background"

export default function Login() {
  const [domain, setDomain] = useState("")
  const [step, setStep] = useState<"domain" | "login" | "recovery-otp">("domain")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otpCode, setOtpCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [company, setCompany] = useState<CompanyInfo | null>(null)
  const [isPageLoading, setIsPageLoading] = useState(true)
  const [showResendButton, setShowResendButton] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmNewPassword, setConfirmNewPassword] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [accountNameError, setAccountNameError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const supabase = getSupabaseClient()
  const router = useRouter()
  const [resetEmailSent, setResetEmailSent] = useState(false)
  const [returnUrl, setReturnUrl] = useState<string | null>(null)

  // Domain aus localStorage laden, wenn vorhanden
  useEffect(() => {
    const savedDomain = getSavedDomain()
    if (savedDomain) {
      setDomain(savedDomain)
    }
    
    // Check for URL parameters (errors from auth callback)
    const urlParams = new URLSearchParams(window.location.search)
    const error = urlParams.get('error')
    const errorDescription = urlParams.get('error_description')
    
    // Check for returnUrl (OAuth flow)
    const returnUrlParam = urlParams.get('returnUrl')
    if (returnUrlParam) {
      setReturnUrl(returnUrlParam)
      console.log('OAuth returnUrl detected:', returnUrlParam)
    }
    
    if (error) {
      let errorMessage = 'Ein Fehler ist aufgetreten'
      
      if (error === 'access_denied' && errorDescription?.includes('otp_expired')) {
        errorMessage = 'Der E-Mail-Bestätigungslink ist abgelaufen oder ungültig. Bitte registrieren Sie sich erneut oder kontaktieren Sie den Support.'
      } else if (error === 'auth_error') {
        errorMessage = errorDescription || 'Fehler bei der E-Mail-Bestätigung'
      } else {
        errorMessage = errorDescription || errorMessage
      }
      
      setError(errorMessage)
      
      // Clear URL parameters after showing error
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    
    // Hash-Token-Handling: Recovery-Mode oder Embedded-Mode (iframe SSO von Support AI)
    ;(async () => {
      try {
        const hash = window.location.hash
        if (!hash) return
        const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
        const type = params.get('type')
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')

        if (accessToken && refreshToken) {
          // Embedded-Mode: SSO von Support AI iframe - Session setzen und direkt weiterleiten
          if (type === 'embedded') {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            })
            if (!sessionError) {
              // Hash aus URL entfernen (Tokens nicht in History behalten)
              window.history.replaceState({}, document.title, window.location.pathname)
              router.push('/')
              return
            }
          }

          // Recovery-Mode: Passwort-Reset-Form anzeigen
          if (type === 'recovery') {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            })
            if (!sessionError) {
              setIsRecoveryMode(true)
              setStep("login")
              if (!domain) {
                setDomain("ecomtask.app.ecomtask.cloud")
              }
            }
          }
        }
      } catch (e) {
        // ignore
      }
    })()
    
    // Finish initial loading check
    const timer = setTimeout(() => setIsPageLoading(false), 300) // Short delay for effect
    return () => clearTimeout(timer) // Cleanup timer
  }, [])

  const handleDomainSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setAccountNameError(null)

    const accountName = domain.replace(".app.ecomtask.cloud", "").trim()
    if (!accountName) {
      setAccountNameError("Bitte gib einen Account-Namen ein")
      setLoading(false)
      return
    }

    try {
      // Account-Name in Domain-Format umwandeln
      const fullDomain = `${accountName}.app.ecomtask.cloud`

      // Domain gegen die companies-Tabelle validieren
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .select("id, name, domain")
        .or(`domain.eq.${fullDomain},domain.eq.${accountName}`)
        .maybeSingle()

      if (companyError) {
        throw new Error(
          `Fehler bei der Accountprüfung: ${companyError.message}`
        )
      }

      if (!companyData) {
        setError(
          `Der Account "${accountName}" wurde nicht gefunden. Bitte prüfe deine Eingabe oder registriere ein neues Unternehmen.`
        )
        setLoading(false)
        return
      }

      const companyInfo: CompanyInfo = {
        id: companyData.id,
        name: companyData.name,
        domain: companyData.domain
      }

      setCompany(companyInfo)
      saveCompany(companyInfo)
      saveDomain(companyData.domain)
      setDomain(companyData.domain)
      setStep("login")
    } catch (err: any) {
      setError(err.message || "Fehler bei der Accountprüfung")
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // Anmeldung mit Supabase
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formatEmailWithDomain(email, domain),
        password
      })

      if (error) {
        const errorMessage = `Login fehlgeschlagen: ${error.message}`
        setError(errorMessage)
        
        // Check if error is due to email not being confirmed
        if (error.message.includes('Email not confirmed') || error.message.includes('not confirmed')) {
          setShowResendButton(true)
        } else {
          setShowResendButton(false)
        }
      } else if (data.user) {
        // Prüfe, ob MFA notwendig ist und leite ggf. zur MFA-Seite
        try {
          const anySupabase: any = supabase as any
          // Prüfe zuerst, ob MFA-API verfügbar ist
          if (anySupabase?.auth?.mfa?.listFactors) {
            const { data: factorsData, error: mfaError } = await anySupabase.auth.mfa.listFactors()

            // Bei Fehler oder wenn keine Daten zurückgegeben werden, überspringe MFA-Prüfung
            if (mfaError || !factorsData) {
            } else {
              const factors = (factorsData?.factors || factorsData?.all || []) as any[]

              // Prüfe auf aktive (nicht abgelaufene) und verifizierte TOTP-Faktoren
              const currentTime = Math.floor(Date.now() / 1000) // Aktuelle Zeit in Sekunden
              const activeTotpFactors = factors?.filter((f: any) => {
                const factorType = f?.factor_type || f?.factorType
                const expiresAt = f?.expires_at || f?.expiresAt
                const status = f?.status

                // Prüfe Typ
                if (factorType !== 'totp') return false

                // Prüfe Status (muss 'verified' sein)
                if (status !== 'verified') {
                  return false
                }

                // Prüfe ob abgelaufen
                if (expiresAt && expiresAt < currentTime) {
                  return false
                }

                return true
              }) || []

              if (activeTotpFactors.length > 0) {
                // Pass returnUrl to MFA page if present
                const mfaUrl = returnUrl ? `/auth/mfa?returnUrl=${encodeURIComponent(returnUrl)}` : '/auth/mfa'
                router.replace(mfaUrl)
                return
              }
            }
          }
        } catch (mfaCheckError: any) {
          // Bei Fehlern fahre normal fort, da MFA wahrscheinlich deaktiviert ist
        }

        setSuccess("Login successful")

        // Save domain and company info for next time if available
        if (company) {
          saveCompany(company)
        }
        if (domain) {
          saveDomain(domain)
        }

        // Session verfügbar machen

        // Nochmalige Prüfung der Session (optional, für Debugging)
        const {
          data: { session }
        } = await supabase.auth.getSession()

        if (!session) {
          throw new Error("Keine gültige Session gefunden nach Login")
        }

        // Prüfen, ob es eine Firmenzuordnung gibt
        // REMOVED re-declarations below to fix scope issue
        // let company: any = null
        // let domain: string | null = null

        // Laden des Benutzerdetails
        const { data: userData, error: userError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single()

        if (userData?.company_id) {
          // Wenn der Benutzer eine Firma hat, diese laden
          const { data: companyData, error: companyError } = await supabase
            .from("companies")
            .select("*")
            .eq("id", userData.company_id)
            .single()

          if (!companyError && companyData) {
            // Wenn der Benutzer eine Firma hat, diese laden
            saveCompany(companyData)
            if (companyData.domain) {
              saveDomain(companyData.domain)
            }
          }
        } else {
          // Alternative: Prüfen, ob der Benutzer ein Admin einer Firma ist
          const { data: adminData, error: adminError } = await supabase
            .from("company_admins")
            .select("*, companies(*)")
            .eq("user_id", session.user.id)
            .single()

          if (!adminError && adminData?.companies) {
            // Wenn der Benutzer ein Admin einer Firma ist, diese laden
            saveCompany(adminData.companies)
            if (adminData.companies.domain) {
              saveDomain(adminData.companies.domain)
            }
          }
        }

        // If returnUrl is set (OAuth flow), redirect there instead of dashboard
        if (returnUrl) {
          console.log('OAuth flow: Redirecting to returnUrl:', returnUrl)
          router.push(returnUrl)
          return
        }

        // Weiterleitung zum Dashboard (alles läuft über company_id im Profil)
        router.push("/dashboard")
      }
    } catch (error: any) {
      setError(error.message || "Ein Fehler ist aufgetreten")
    } finally {
      setLoading(false)
    }
  }

  const handleBackToDomain = () => {
    setStep("domain")
    setError(null)
    setShowResendButton(false)
  }

  const handleResendConfirmation = async () => {
    if (!email) {
      setError("Bitte geben Sie zuerst Ihre E-Mail-Adresse ein")
      return
    }

    setResendLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/resend-confirmation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formatEmailWithDomain(email, domain)
        })
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess('Bestätigungs-E-Mail wurde erneut gesendet! Bitte prüfen Sie Ihr E-Mail-Postfach.')
        setShowResendButton(false)
      } else {
        setError(data.error || 'Fehler beim Senden der Bestätigungs-E-Mail')
      }
    } catch (err) {
      setError('Fehler beim Senden der Bestätigungs-E-Mail')
    } finally {
      setResendLoading(false)
    }
  }

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    if (newPassword.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.")
      setLoading(false)
      return
    }
    if (newPassword !== confirmNewPassword) {
      setError("Die Passwörter stimmen nicht überein.")
      setLoading(false)
      return
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      })
      if (updateError) {
        setError(updateError.message || "Fehler beim Aktualisieren des Passworts.")
        setLoading(false)
        return
      }

      setSuccess("Passwort erfolgreich geändert.")
      setTimeout(() => router.replace("/dashboard"), 1200)
    } catch (e: any) {
      setError(e?.message || "Unerwarteter Fehler.")
    } finally {
      setLoading(false)
    }
  }

  const loadDemoCompany = async () => {
    try {
      setLoading(true)

      // Demo-Unternehmen aus der Datenbank laden
      const { data: demoCompany, error: demoError } = await supabase
        .from("companies")
        .select("*")
        .eq("is_demo", true)
        .maybeSingle()

      if (demoError || !demoCompany) {
        throw new Error("Demo-Unternehmen konnte nicht geladen werden")
      }

      // Demo-Unternehmen speichern
      const companyInfo: CompanyInfo = {
        id: demoCompany.id,
        name: demoCompany.name,
        domain: demoCompany.domain
      }

      setCompany(companyInfo)
      saveCompany(companyInfo)
      saveDomain(demoCompany.domain)

      // Demo-Benutzer aus der Datenbank laden
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session?.user) {
        throw new Error("Keine gültige Session für Demo-Login gefunden")
      }

      const { data: demoUser, error: userError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", sessionData.session.user.id)
        .maybeSingle()

      if (userError || !demoUser) {
        throw new Error("Demo-Benutzer konnte nicht geladen werden")
      }

      // Demo-Login durchführen
      const { data, error } = await supabase.auth.signInWithPassword({
        email: "demo@ecomtask.cloud",
        password: "demo1234"
      })

      if (error) throw error

      // Zum Dashboard weiterleiten
      router.push("/dashboard")
    } catch (err: any) {
      setError(
        "Demo-Login fehlgeschlagen: " + (err.message || "Unbekannter Fehler")
      )
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: formatEmailWithDomain(email, domain),
        token: otpCode,
        type: 'recovery'
      })

      if (error) throw error

      setSuccess("Code bestätigt! Bitte setzen Sie jetzt Ihr neues Passwort.")
      setIsRecoveryMode(true)
      setStep("login") // Zeige Passwort-Reset Formular
    } catch (err: any) {
      setError(err.message || "Ungültiger Code. Bitte prüfen Sie Ihre Eingabe.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#1e1e1e] p-4 text-white w-full relative">
      <SquaresBackground squareSize={25} color="#ff55c9" opacity={0.12} speed={0.3} />
      <div className="flex flex-col items-center justify-center w-full max-w-sm mx-auto relative z-10">
        <div className="mb-0">
          <Image
            src="/EcomTask.svg"
            alt="EcomTask Logo"
            width={220}
            height={93}
            priority
          />
        </div>
        {step === "domain" && (
          <p className="mb-2 text-center text-sm text-white">
            Melden Sie sich in der ecomtask cloud an
          </p>
        )}
        {step === "recovery-otp" ? (
          <div className="flex w-full flex-col items-center">
             <h1 className="mb-2 text-center text-3xl font-semibold text-white">
              Code eingeben
            </h1>
            <p className="mb-4 text-center text-sm text-gray-300">
              Wir haben einen 6-stelligen Code an {email} gesendet.
            </p>
            <form onSubmit={handleVerifyOtp} className="w-full space-y-4">
               <div className="relative">
                <input
                  id="otpCode"
                  type="text"
                  inputMode="numeric"
                  placeholder=" "
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value)}
                  required
                  className="peer block w-full rounded-md border border-[#444444] bg-[#333333] px-4 py-2 text-white focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
                <label
                  htmlFor="otpCode"
                  className="absolute start-1 top-2 z-10 origin-[0] -translate-y-4 scale-75 px-2 text-sm text-gray-400 duration-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-2 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-white"
                >
                  6-stelliger Code
                </label>
              </div>
               <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-white px-4 py-2 font-semibold text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e] disabled:opacity-50"
              >
                {loading ? "Prüfe..." : "Code bestätigen"}
              </button>
            </form>
             <button
              onClick={() => setStep("login")}
              className="mt-4 text-sm text-gray-300 hover:text-white underline"
            >
              Zurück zum Login
            </button>
          </div>
        ) : step === "domain" ? (
          <div className="flex w-full flex-col items-center">
            <form onSubmit={handleDomainSubmit} noValidate className="w-full space-y-3">
            <div>
              <label
                htmlFor="accountName"
                className="mb-1 block text-xs font-medium text-gray-400"
              >
                Account-Name
              </label>
              <div className={`flex rounded-md shadow-sm ${accountNameError ? "ring-2 ring-inset ring-gray-400/50" : ""}`}>
                <input
                  id="accountName"
                  name="accountName"
                  type="text"
                  value={domain.replace(".app.ecomtask.cloud", "")}
                  onChange={e => {
                    setDomain(
                      e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "")
                    )
                    if (accountNameError) setAccountNameError(null)
                  }}
                  aria-invalid={!!accountNameError}
                  aria-describedby={accountNameError ? "accountName-error" : undefined}
                  className={`block w-full rounded-l-md border-0 bg-[#333333] px-3 py-2 text-white shadow-sm ring-1 ring-inset placeholder:text-gray-500 focus:ring-2 focus:ring-inset sm:text-sm sm:leading-6 autofill:bg-[#333333] autofill:text-white ${
                    accountNameError
                      ? "ring-gray-400/50 focus:ring-gray-400/60"
                      : "ring-[#444444] focus:ring-gray-400"
                  }`}
                />
                <span className="inline-flex items-center rounded-r-md border border-l-0 border-[#444444] bg-[#444444] px-3 text-sm text-gray-400">
                  .app.ecomtask.cloud
                </span>
              </div>
              {accountNameError && (
                <p
                  id="accountName-error"
                  role="alert"
                  className="mt-2 text-sm font-normal text-gray-400"
                >
                  {accountNameError}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-white px-4 py-2 font-semibold text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e] disabled:opacity-50"
            >
              {loading ? "Prüfe..." : "Weiter"}
            </button>
            {error && (
              <p className="mt-1 text-center text-sm text-red-400">{error}</p>
            )}
          </form>
          <div className="mt-3 text-center">
            <span className="text-sm text-gray-400">Neues Unternehmen? </span>
            <Link
              href="/register"
              className="text-sm text-white hover:underline"
            >
              Registrieren
            </Link>
          </div>
          <div className="mt-3 text-center text-xs text-gray-400">
            <Link href="/terms" className="hover:underline">Nutzungsbedingungen</Link>
            <span className="mx-2">|</span>
            <Link href="/privacy" className="hover:underline">Datenschutzrichtlinie</Link>
            </div>
          </div>
        ) : isRecoveryMode ? (
          <div className="flex w-full flex-col items-center">
            <h1 className="mb-4 text-center text-3xl font-semibold text-white">
              Neues Passwort setzen
            </h1>
          <form onSubmit={handlePasswordReset} className="w-full space-y-4">
            <div className="relative">
              <input
                id="newPassword"
                type="password"
                placeholder=" "
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                className="peer block w-full rounded-md border border-[#444444] bg-[#333333] px-4 py-2 text-white focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <label
                htmlFor="newPassword"
                className="absolute start-1 top-2 z-10 origin-[0] -translate-y-4 scale-75 px-2 text-sm text-gray-400 duration-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-2 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-white"
              >
                Neues Passwort
              </label>
            </div>
            <div className="relative">
              <input
                id="confirmNewPassword"
                type="password"
                placeholder=" "
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
                required
                className="peer block w-full rounded-md border border-[#444444] bg-[#333333] px-4 py-2 text-white focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <label
                htmlFor="confirmNewPassword"
                className="absolute start-1 top-2 z-10 origin-[0] -translate-y-4 scale-75 px-2 text-sm text-gray-400 duration-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-2 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-white"
              >
                Passwort bestätigen
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-white px-4 py-2 font-semibold text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e] disabled:opacity-50"
            >
              {loading ? "Speichere..." : "Passwort setzen"}
            </button>
          </form>
          {error && (
            <p className="mt-3 text-center text-sm text-red-400">{error}</p>
            )}
            {success && (
              <p className="mt-3 text-center text-sm text-green-400">{success}</p>
            )}
          </div>
        ) : (
          <div className="flex w-full flex-col items-center">
            <h1 className="mb-1 text-center text-3xl font-semibold text-white">
              Willkommen zurück
            </h1>
            <p className="mb-3 text-center text-sm text-gray-400">
              Melden Sie sich bei Ihrem Account an
            </p>
          <form onSubmit={isRecoveryMode ? handlePasswordReset : handleLogin} noValidate className="w-full space-y-3">
            <div className="space-y-2">
            {isRecoveryMode ? (
              <>
                <div className="relative">
                  <input
                    id="newPassword"
                    type="password"
                    placeholder=" "
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                    className="peer block w-full rounded-md border border-[#444444] bg-[#333333] px-4 py-2 text-white focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                  <label
                    htmlFor="newPassword"
                    className="absolute start-1 top-2 z-10 origin-[0] -translate-y-4 scale-75 px-2 text-sm text-gray-400 duration-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-2 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-white rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4"
                  >
                    Neues Passwort
                  </label>
                </div>
                <div className="relative">
                  <input
                    id="confirmNewPassword"
                    type="password"
                    placeholder=" "
                    value={confirmNewPassword}
                    onChange={e => setConfirmNewPassword(e.target.value)}
                    required
                    className="peer block w-full rounded-md border border-[#444444] bg-[#333333] px-4 py-2 text-white focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                  <label
                    htmlFor="confirmNewPassword"
                    className="absolute start-1 top-2 z-10 origin-[0] -translate-y-4 scale-75 px-2 text-sm text-gray-400 duration-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-2 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-white rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4"
                  >
                    Passwort bestätigen
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    placeholder=" "
                    value={email}
                    onChange={e => { setEmail(e.target.value); setEmailError(null) }}
                    required
                    aria-invalid={!!emailError}
                    className="peer block w-full rounded-md border border-[#444444] bg-[#333333] px-4 py-2 text-white focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 autofill:bg-[#333333] autofill:text-white"
                  />
                  <label
                    htmlFor="email"
                    className="absolute start-1 top-2 z-10 origin-[0] -translate-y-4 scale-75 px-2 text-sm text-gray-400 duration-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-2 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-white rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4"
                  >
                    E-Mail-Adresse
                  </label>
                </div>
                {emailError && (
                  <p className="mt-1 text-xs text-red-400">{emailError}</p>
                )}
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder=" "
                    value={password}
                    onChange={e => { setPassword(e.target.value); setPasswordError(null) }}
                    required
                    aria-invalid={!!passwordError}
                    className="peer block w-full rounded-md border border-[#444444] bg-[#333333] px-4 pr-14 py-2 text-white focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 autofill:bg-[#333333] autofill:text-white"
                  />
                  <label
                    htmlFor="password"
                    className="absolute start-1 top-2 z-10 origin-[0] -translate-y-4 scale-75 px-2 text-sm text-gray-400 duration-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-2 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-white rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4"
                  >
                    Passwort
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(prev => !prev)}
                    className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-400 hover:text-white focus:outline-none"
                    aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                  >
                    {showPassword ? "Verbergen" : "Anzeigen"}
                  </button>
                </div>
                {passwordError && (
                  <p className="mt-1 text-xs text-red-400">{passwordError}</p>
                )}
                {!isRecoveryMode && (
                  <div className="mt-2 text-right">
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null)
                        setSuccess(null)
                        if (!email) {
                          setEmailError("Bitte E-Mail-Adresse eingeben.")
                          return
                        }
                        try {
                          setLoading(true)

                          const recoverResponse = await fetch(
                            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/recover`,
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                                apikey: `${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
                                Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
                              },
                              body: JSON.stringify({
                                email: formatEmailWithDomain(email, domain),
                                redirect_to: `${window.location.origin}/auth/callback?type=recovery`
                              })
                            }
                          )

                          if (!recoverResponse.ok) {
                            const errorText = await recoverResponse.text()
                            throw new Error(errorText || "Fehler beim Senden der Reset-E-Mail")
                          }

                          setResetEmailSent(true)
                          setSuccess("Code gesendet! Bitte geben Sie den 6-stelligen Code aus der E-Mail ein.")
                          setStep("recovery-otp")
                        } catch (e: any) {
                          setError(e?.message || "Fehler beim Senden der Reset-E-Mail")
                        } finally {
                          setLoading(false)
                        }
                      }}
                      className="text-sm text-gray-400 hover:text-white hover:underline"
                    >
                      Passwort vergessen?
                    </button>
                  </div>
                )}
              </>
            )}
            </div>

            {/* OAuth Provider */}
            {!isRecoveryMode && (
              <div className="pt-1 space-y-2">
                <div className="h-px bg-[#333]" />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setError(null)
                      setSuccess(null)
                      const { error } = await supabase.auth.signInWithOAuth({
                        provider: 'azure',
                        options: {
                          redirectTo: company ? `${window.location.origin}/auth/post-oauth-register?companyId=${encodeURIComponent(company.id)}&companyName=${encodeURIComponent(company.name)}` : `${window.location.origin}/auth/post-oauth-register`,
                          scopes: 'openid profile email offline_access'
                        }
                      })
                      if (error) throw error
                    } catch (e: any) {
                      setError(e?.message || 'Microsoft-Anmeldung fehlgeschlagen')
                    }
                  }}
                  aria-label="Mit Microsoft anmelden"
                  className="w-full rounded-md border border-[#444444] bg-[#2a2a2a] px-4 py-2 text-white hover:bg-[#333333] flex items-center justify-center gap-2"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <rect x="1" y="1" width="10" height="10" fill="#F35325" />
                    <rect x="13" y="1" width="10" height="10" fill="#81BC06" />
                    <rect x="1" y="13" width="10" height="10" fill="#05A6F0" />
                    <rect x="13" y="13" width="10" height="10" fill="#FFBA08" />
                  </svg>
                  <span>Mit Microsoft anmelden</span>
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-white px-4 py-2 font-semibold text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e] disabled:opacity-50"
            >
              {loading ? (isRecoveryMode ? "Speichere..." : "Anmelden...") : (isRecoveryMode ? "Passwort setzen" : "Weiter")}
            </button>
            </form>

            <div className="mt-3 text-center">
              <span className="text-sm text-gray-400">
                Du hast noch kein Konto?{" "}
              </span>
              <Link
                href="/register"
                className="text-sm text-white hover:underline"
              >
                Registrieren
              </Link>
            </div>

            <div className="mt-6 text-center text-xs text-gray-400">
              <Link href="/terms" className="hover:underline">Nutzungsbedingungen</Link>
              <span className="mx-2">|</span>
              <Link href="/privacy" className="hover:underline">Datenschutzrichtlinie</Link>
            </div>

            {error && (
              <p className="mt-3 text-center text-sm text-red-400">{error}</p>
            )}
            {success && (
              <p className="mt-3 text-center text-sm text-green-400">{success}</p>
            )}

            <button
              onClick={handleBackToDomain}
              className="mt-3 text-sm text-gray-400 hover:text-white hover:underline"
            >
              Zurück zur Account-Auswahl
            </button>
          </div>
        )}
      </div>
      
      {/* Powered by EcomTask Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#1e1e1e] border-t border-[#333333] z-20">
        <div className="flex justify-center items-center py-2 px-4">
          <p className="text-xs text-gray-500 text-center">
            powered by <span className="text-white font-medium">EcomTask</span>
          </p>
        </div>
      </div>
    </div>
  )
}
