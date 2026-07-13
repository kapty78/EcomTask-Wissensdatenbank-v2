"use client"

import { getSupabaseClient } from "@/lib/supabase-browser"
import { useState, useEffect } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Eye, EyeOff } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  getSavedDomain,
  saveDomain,
  formatEmailWithDomain,
  saveCompany,
  CompanyInfo
} from "@/lib/domain-manager"
import { BrandPanel } from "./_components/BrandPanel"
import { AuthField } from "./_components/AuthField"
import {
  PrimaryButton,
  SecondaryButton,
  ErrorBanner,
  OrDivider,
  MicrosoftButton
} from "./_components/auth-ui"

const DOMAIN_SUFFIX = ".app.ecomtask.cloud"

const stepMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18, ease: "easeOut" as const }
}

export default function Login() {
  const [domain, setDomain] = useState("")
  const [step, setStep] = useState<"domain" | "login" | "recovery-otp">(
    "domain"
  )
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otpCode, setOtpCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [company, setCompany] = useState<CompanyInfo | null>(null)
  const [showResendButton, setShowResendButton] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmNewPassword, setConfirmNewPassword] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [accountNameError, setAccountNameError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [returnUrl, setReturnUrl] = useState<string | null>(null)

  const supabase = getSupabaseClient()
  const router = useRouter()

  const accountName = domain.replace(DOMAIN_SUFFIX, "")

  // Domain aus localStorage laden, URL-Fehler anzeigen, Hash-Tokens behandeln
  useEffect(() => {
    const savedDomain = getSavedDomain()
    if (savedDomain) {
      setDomain(savedDomain)
    }

    // Check for URL parameters (errors from auth callback)
    const urlParams = new URLSearchParams(window.location.search)
    const urlError = urlParams.get("error")
    const errorDescription = urlParams.get("error_description")

    // Check for returnUrl (OAuth flow)
    const returnUrlParam = urlParams.get("returnUrl")
    if (returnUrlParam) {
      setReturnUrl(returnUrlParam)
    }

    if (urlError) {
      let errorMessage = "Ein Fehler ist aufgetreten"

      if (
        urlError === "access_denied" &&
        errorDescription?.includes("otp_expired")
      ) {
        errorMessage =
          "Der E-Mail-Bestätigungslink ist abgelaufen oder ungültig. Bitte registrieren Sie sich erneut oder kontaktieren Sie den Support."
      } else if (urlError === "auth_error") {
        errorMessage = errorDescription || "Fehler bei der E-Mail-Bestätigung"
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
        const params = new URLSearchParams(
          hash.startsWith("#") ? hash.slice(1) : hash
        )
        const type = params.get("type")
        const accessToken = params.get("access_token")
        const refreshToken = params.get("refresh_token")

        if (accessToken && refreshToken) {
          // Embedded-Mode: SSO von Support AI iframe - Session setzen und direkt weiterleiten
          if (type === "embedded") {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            })
            if (!sessionError) {
              // Hash aus URL entfernen (Tokens nicht in History behalten)
              window.history.replaceState(
                {},
                document.title,
                window.location.pathname
              )
              router.push("/")
              return
            }
          }

          // Recovery-Mode: Passwort-Reset-Form anzeigen
          if (type === "recovery") {
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
  }, [])

  const handleDomainSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setAccountNameError(null)

    const name = accountName.trim()
    if (!name) {
      setAccountNameError("Bitte gib einen Account-Namen ein")
      setLoading(false)
      return
    }

    try {
      const fullDomain = `${name}${DOMAIN_SUFFIX}`

      // Domain gegen die companies-Tabelle validieren
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .select("id, name, domain")
        .or(`domain.eq.${fullDomain},domain.eq.${name}`)
        .maybeSingle()

      if (companyError) {
        throw new Error(`Fehler bei der Accountprüfung: ${companyError.message}`)
      }

      if (!companyData) {
        setError(
          `Der Account "${name}" wurde nicht gefunden. Bitte prüfe deine Eingabe oder registriere ein neues Unternehmen.`
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
    setEmailError(null)
    setPasswordError(null)

    try {
      // Eigene Feldvalidierung statt Browser-Tooltips
      if (!email || !password) {
        if (!email) setEmailError("Bitte E-Mail-Adresse eingeben")
        if (!password) setPasswordError("Bitte Passwort eingeben")
        setLoading(false)
        return
      }

      // Anmeldung mit Supabase
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formatEmailWithDomain(email, domain),
        password
      })

      if (error) {
        setError(`Login fehlgeschlagen: ${error.message}`)

        // Check if error is due to email not being confirmed
        if (
          error.message.includes("Email not confirmed") ||
          error.message.includes("not confirmed")
        ) {
          setShowResendButton(true)
        } else {
          setShowResendButton(false)
        }
      } else if (data.user) {
        // Prüfe, ob MFA notwendig ist und leite ggf. zur MFA-Seite
        try {
          const anySupabase: any = supabase as any
          if (anySupabase?.auth?.mfa?.listFactors) {
            const { data: factorsData, error: mfaError } =
              await anySupabase.auth.mfa.listFactors()

            if (!mfaError && factorsData) {
              const factors = (factorsData?.factors ||
                factorsData?.all ||
                []) as any[]

              // Prüfe auf aktive (nicht abgelaufene) und verifizierte TOTP-Faktoren
              const currentTime = Math.floor(Date.now() / 1000)
              const activeTotpFactors =
                factors?.filter((f: any) => {
                  const factorType = f?.factor_type || f?.factorType
                  const expiresAt = f?.expires_at || f?.expiresAt
                  const status = f?.status

                  if (factorType !== "totp") return false
                  if (status !== "verified") return false
                  if (expiresAt && expiresAt < currentTime) return false
                  return true
                }) || []

              if (activeTotpFactors.length > 0) {
                // Pass returnUrl to MFA page if present
                const mfaUrl = returnUrl
                  ? `/auth/mfa?returnUrl=${encodeURIComponent(returnUrl)}`
                  : "/auth/mfa"
                router.replace(mfaUrl)
                return
              }
            }
          }
        } catch (mfaCheckError: any) {
          // Bei Fehlern fahre normal fort, da MFA wahrscheinlich deaktiviert ist
        }

        setSuccess("Login erfolgreich")

        // Save domain and company info for next time if available
        if (company) {
          saveCompany(company)
        }
        if (domain) {
          saveDomain(domain)
        }

        const {
          data: { session }
        } = await supabase.auth.getSession()

        if (!session) {
          throw new Error("Keine gültige Session gefunden nach Login")
        }

        // Firmenzuordnung des Benutzers laden
        const { data: userData } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .single()

        if (userData?.company_id) {
          const { data: companyData, error: companyError } = await supabase
            .from("companies")
            .select("*")
            .eq("id", userData.company_id)
            .single()

          if (!companyError && companyData) {
            saveCompany(companyData)
            if (companyData.domain) {
              saveDomain(companyData.domain)
            }
          }
        } else {
          // Alternative: Benutzer ist Admin einer Firma
          const { data: adminData, error: adminError } = await supabase
            .from("company_admins")
            .select("*, companies(*)")
            .eq("user_id", session.user.id)
            .single()

          if (!adminError && adminData?.companies) {
            saveCompany(adminData.companies)
            if (adminData.companies.domain) {
              saveDomain(adminData.companies.domain)
            }
          }
        }

        // If returnUrl is set (OAuth flow), redirect there instead of dashboard
        if (returnUrl) {
          router.push(returnUrl)
          return
        }

        // Weiterleitung zum Dashboard (alles läuft über company_id im Profil)
        router.push("/dashboard")
      }
    } catch (err: any) {
      setError(err.message || "Ein Fehler ist aufgetreten")
    } finally {
      setLoading(false)
    }
  }

  const handleBackToDomain = () => {
    setStep("domain")
    setError(null)
    setShowResendButton(false)
    setEmailError(null)
    setPasswordError(null)
  }

  const handleResendConfirmation = async () => {
    if (!email) {
      setError("Bitte geben Sie zuerst Ihre E-Mail-Adresse ein")
      return
    }

    setResendLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: formatEmailWithDomain(email, domain)
        })
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(
          "Bestätigungs-E-Mail wurde erneut gesendet! Bitte prüfen Sie Ihr E-Mail-Postfach."
        )
        setShowResendButton(false)
      } else {
        setError(data.error || "Fehler beim Senden der Bestätigungs-E-Mail")
      }
    } catch (err) {
      setError("Fehler beim Senden der Bestätigungs-E-Mail")
    } finally {
      setResendLoading(false)
    }
  }

  const handleForgotPassword = async () => {
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

      setSuccess(
        "Code gesendet! Bitte geben Sie den 6-stelligen Code aus der E-Mail ein."
      )
      setStep("recovery-otp")
    } catch (e: any) {
      setError(e?.message || "Fehler beim Senden der Reset-E-Mail")
    } finally {
      setLoading(false)
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
        setError(
          updateError.message || "Fehler beim Aktualisieren des Passworts."
        )
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

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: formatEmailWithDomain(email, domain),
        token: otpCode,
        type: "recovery"
      })

      if (error) throw error

      setSuccess("Code bestätigt! Bitte setzen Sie jetzt Ihr neues Passwort.")
      setIsRecoveryMode(true)
      setStep("login")
    } catch (err: any) {
      setError(err.message || "Ungültiger Code. Bitte prüfen Sie Ihre Eingabe.")
    } finally {
      setLoading(false)
    }
  }

  const handleOAuthLogin = async () => {
    try {
      setError(null)
      setSuccess(null)
      // Login (nicht Registrierung): NIEMALS companyId/registrationToken anhängen.
      // Sonst würde post-oauth-register die Admin-Registrierung auslösen, die ohne
      // gültigen Registrierungs-Token 403t — genau der Grund, warum sich bestehende
      // User bisher nicht per Microsoft anmelden konnten. Die Firmenzuordnung kommt
      // beim Login ausschließlich aus dem Profil des Users.
      const base = `${window.location.origin}/auth/post-oauth-register`
      const redirectTo = returnUrl
        ? `${base}?returnUrl=${encodeURIComponent(returnUrl)}`
        : base
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo,
          scopes: "openid profile email offline_access"
        }
      })
      if (error) throw error
    } catch (e: any) {
      setError(e?.message || "Microsoft-Anmeldung fehlgeschlagen")
    }
  }

  const view =
    step === "domain"
      ? "domain"
      : step === "recovery-otp"
        ? "otp"
        : isRecoveryMode
          ? "reset"
          : "login"

  return (
    <div className="flex min-h-screen w-full gap-4 bg-[#141414] p-3 text-white lg:p-4">
      <BrandPanel />

      <main className="relative flex flex-1 items-center justify-center px-2 py-10 sm:px-6">
        {/* dezenter Brand-Glow hinter der Karte */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(255,85,201,0.07) 0%, rgba(255,85,201,0) 70%)"
          }}
        />

        <div className="relative w-full max-w-[400px]">
          {/* Brand-Header auf Mobile (Brand-Panel ist dort ausgeblendet) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Image
              src="/wissensdatenbank-logo-v2.png"
              alt="Wissensdatenbank Logo"
              width={88}
              height={88}
              priority
              className="drop-shadow-[0_8px_24px_rgba(255,85,201,0.35)]"
            />
          </div>

          <div className="rounded-3xl border border-white/[0.06] bg-[#1c1c1c] p-7 shadow-[0_16px_48px_rgba(0,0,0,0.35)] sm:p-8">
            <AnimatePresence mode="wait" initial={false}>
              {view === "domain" && (
                <motion.div key="domain" {...stepMotion}>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    Anmelden
                  </h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                    Melden Sie sich in der ecomtask cloud an
                  </p>

                  <form
                    onSubmit={handleDomainSubmit}
                    noValidate
                    className="mt-7 space-y-4"
                  >
                    <AuthField
                      id="accountName"
                      label="Account-Name"
                      value={accountName}
                      onChange={value => {
                        setDomain(value.toLowerCase().replace(/[^a-z0-9]/g, ""))
                        if (accountNameError) setAccountNameError(null)
                      }}
                      suffix={DOMAIN_SUFFIX}
                      error={accountNameError}
                      autoComplete="organization"
                      autoFocus
                    />

                    {error && <ErrorBanner>{error}</ErrorBanner>}

                    <PrimaryButton loading={loading} loadingLabel="Prüfe...">
                      Weiter
                    </PrimaryButton>
                  </form>
                </motion.div>
              )}

              {view === "login" && (
                <motion.div key="login" {...stepMotion}>
                  {/* Gewählter Account als Chip — Klick wechselt zurück */}
                  <button
                    type="button"
                    onClick={handleBackToDomain}
                    className="group mb-6 flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-left transition-all duration-150 hover:border-white/[0.14] hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff55c9]"
                      />
                      <span className="truncate text-sm text-white/80">
                        {domain}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-medium text-white/40 transition-colors group-hover:text-white">
                      Ändern
                    </span>
                  </button>

                  <h1 className="text-2xl font-semibold tracking-tight">
                    Willkommen zurück
                  </h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                    Melden Sie sich bei Ihrem Account an
                  </p>

                  <form
                    onSubmit={handleLogin}
                    noValidate
                    className="mt-7 space-y-4"
                  >
                    <AuthField
                      id="email"
                      type="email"
                      label="E-Mail-Adresse"
                      value={email}
                      onChange={value => {
                        setEmail(value)
                        setEmailError(null)
                      }}
                      error={emailError}
                      autoComplete="email"
                      inputMode="email"
                      autoFocus
                    />
                    <AuthField
                      id="password"
                      type={showPassword ? "text" : "password"}
                      label="Passwort"
                      value={password}
                      onChange={value => {
                        setPassword(value)
                        setPasswordError(null)
                      }}
                      error={passwordError}
                      autoComplete="current-password"
                      labelAction={
                        <button
                          type="button"
                          onClick={handleForgotPassword}
                          className="text-[13px] text-white/40 transition-colors hover:text-white"
                        >
                          Passwort vergessen?
                        </button>
                      }
                      trailing={
                        <button
                          type="button"
                          onClick={() => setShowPassword(prev => !prev)}
                          aria-label={
                            showPassword
                              ? "Passwort verbergen"
                              : "Passwort anzeigen"
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/35 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" aria-hidden />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden />
                          )}
                        </button>
                      }
                    />

                    {error && <ErrorBanner>{error}</ErrorBanner>}
                    {success && (
                      <p className="text-center text-sm text-white/60">
                        {success}
                      </p>
                    )}
                    {showResendButton && (
                      <SecondaryButton
                        onClick={handleResendConfirmation}
                        loading={resendLoading}
                        loadingLabel="Sende..."
                      >
                        Bestätigungs-E-Mail erneut senden
                      </SecondaryButton>
                    )}

                    <PrimaryButton loading={loading} loadingLabel="Anmelden...">
                      Anmelden
                    </PrimaryButton>

                    <OrDivider label="oder" />
                    <MicrosoftButton
                      label="Mit Microsoft anmelden"
                      onClick={handleOAuthLogin}
                      disabled={loading}
                    />
                  </form>
                </motion.div>
              )}

              {view === "otp" && (
                <motion.div key="otp" {...stepMotion}>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    Code eingeben
                  </h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                    Wir haben einen 6-stelligen Code an {email} gesendet.
                  </p>

                  <form
                    onSubmit={handleVerifyOtp}
                    noValidate
                    className="mt-7 space-y-4"
                  >
                    <AuthField
                      id="otpCode"
                      label="6-stelliger Code"
                      value={otpCode}
                      onChange={setOtpCode}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      autoFocus
                      inputClassName="text-center tracking-[0.35em]"
                    />

                    {error && <ErrorBanner>{error}</ErrorBanner>}
                    {success && (
                      <p className="text-center text-sm text-white/60">
                        {success}
                      </p>
                    )}

                    <PrimaryButton loading={loading} loadingLabel="Prüfe...">
                      Code bestätigen
                    </PrimaryButton>
                  </form>

                  <button
                    type="button"
                    onClick={() => {
                      setStep("login")
                      setError(null)
                    }}
                    className="mt-5 w-full text-center text-sm text-white/40 transition-colors hover:text-white"
                  >
                    Zurück zum Login
                  </button>
                </motion.div>
              )}

              {view === "reset" && (
                <motion.div key="reset" {...stepMotion}>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    Neues Passwort setzen
                  </h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                    Wählen Sie ein neues Passwort mit mindestens 8 Zeichen.
                  </p>

                  <form
                    onSubmit={handlePasswordReset}
                    noValidate
                    className="mt-7 space-y-4"
                  >
                    <AuthField
                      id="newPassword"
                      type="password"
                      label="Neues Passwort"
                      value={newPassword}
                      onChange={setNewPassword}
                      autoComplete="new-password"
                      autoFocus
                    />
                    <AuthField
                      id="confirmNewPassword"
                      type="password"
                      label="Passwort bestätigen"
                      value={confirmNewPassword}
                      onChange={setConfirmNewPassword}
                      autoComplete="new-password"
                    />

                    {error && <ErrorBanner>{error}</ErrorBanner>}
                    {success && (
                      <p className="text-center text-sm text-white/60">
                        {success}
                      </p>
                    )}

                    <PrimaryButton loading={loading} loadingLabel="Speichere...">
                      Passwort setzen
                    </PrimaryButton>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer unter der Karte */}
          <div className="mt-6 text-center text-sm">
            <span className="text-white/40">
              {step === "domain"
                ? "Neues Unternehmen?"
                : "Du hast noch kein Konto?"}{" "}
            </span>
            <Link
              href="/register"
              className="font-medium text-white/80 transition-colors hover:text-white"
            >
              Registrieren
            </Link>
          </div>
          <div className="mt-4 flex items-center justify-center gap-3 text-xs text-white/30">
            <Link href="/terms" className="transition-colors hover:text-white/60">
              Nutzungsbedingungen
            </Link>
            <span aria-hidden className="h-3 w-px bg-white/[0.12]" />
            <Link
              href="/privacy"
              className="transition-colors hover:text-white/60"
            >
              Datenschutzrichtlinie
            </Link>
          </div>
          <p className="mt-4 text-center text-xs text-white/25">
            powered by <span className="font-medium text-white/60">EcomTask</span>
          </p>
        </div>
      </main>
    </div>
  )
}
