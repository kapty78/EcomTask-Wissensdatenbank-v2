"use client"

import { useState } from "react"
import { getSupabaseClient } from "@/lib/supabase-browser"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { AnimatePresence, motion } from "motion/react"
import { Eye, EyeOff, Mail } from "lucide-react"
import { BrandPanel } from "../login/_components/BrandPanel"
import { AuthField } from "../login/_components/AuthField"
import {
  PrimaryButton,
  ErrorBanner,
  OrDivider,
  MicrosoftButton
} from "../login/_components/auth-ui"

const DOMAIN_SUFFIX = ".app.ecomtask.cloud"

const stepMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18, ease: "easeOut" as const }
}

export default function Register() {
  const [step, setStep] = useState<"company" | "admin" | "done">("company")

  const [companyName, setCompanyName] = useState("")
  const [accountName, setAccountName] = useState("")
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [registrationToken, setRegistrationToken] = useState<string | null>(null)

  const [adminName, setAdminName] = useState("")
  const [adminEmail, setAdminEmail] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneEmail, setDoneEmail] = useState("")

  const router = useRouter()
  const supabase = getSupabaseClient()

  const handleRegisterCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!companyName.trim()) throw new Error("Bitte geben Sie einen Unternehmensnamen ein")
      if (!accountName.trim()) throw new Error("Bitte geben Sie einen Account-Namen ein")

      const res = await fetch("/api/register-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, accountName })
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "Fehler beim Erstellen des Unternehmens")

      setCompanyId(d.companyId)
      setRegistrationToken(d.registrationToken)
      setStep("admin")
    } catch (err: any) {
      setError(err.message || "Ein unbekannter Fehler ist aufgetreten")
    } finally {
      setLoading(false)
    }
  }

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!adminName.trim()) throw new Error("Bitte geben Sie einen Namen ein")
      if (!adminEmail.trim()) throw new Error("Bitte geben Sie eine E-Mail-Adresse ein")
      if (adminPassword.length < 8) throw new Error("Das Passwort muss mindestens 8 Zeichen lang sein")
      if (adminPassword !== confirmPassword) throw new Error("Die Passwörter stimmen nicht überein")
      if (!companyId || !registrationToken) throw new Error("Unternehmens-ID fehlt. Bitte starten Sie den Prozess erneut.")

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: adminEmail,
        password: adminPassword,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: adminName,
            company_id: companyId,
            company_name: companyName,
            preferred_language: "de",
            pending_archive: false,
            role: "admin"
          }
        }
      })

      if (authError) {
        if (authError.message?.includes("rate limit") || authError.message?.includes("email rate limit exceeded")) {
          throw new Error("E-Mail-Limit erreicht: Zu viele Registrierungsversuche. Bitte warten Sie 10–15 Minuten oder kontaktieren Sie den Administrator.")
        }
        throw new Error(`Fehler bei der Erstellung des Accounts: ${authError.message}`)
      }

      if (!authData.user) throw new Error("Benutzer konnte nicht erstellt werden")

      try {
        const res = await fetch("/api/register-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: authData.user.id,
            companyId,
            registrationToken,
            email: adminEmail,
            fullName: adminName
          })
        })
        const d = await res.json()
        if (!res.ok) throw new Error(`Fehler bei der Zuweisung der Admin-Rolle: ${d.error || res.statusText}`)
      } catch (err) {
        throw new Error(`Fehler bei der Zuweisung der Admin-Rolle: ${err instanceof Error ? err.message : String(err)}`)
      }

      setDoneEmail(adminEmail)
      setStep("done")
    } catch (err: any) {
      setError(err.message || "Ein unbekannter Fehler ist aufgetreten")
    } finally {
      setLoading(false)
    }
  }

  const handleMicrosoftRegister = async () => {
    setError(null)
    try {
      if (!companyId || !registrationToken) { setError("Bitte zuerst das Unternehmen anlegen"); return }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: `${window.location.origin}/auth/post-oauth-register?companyId=${encodeURIComponent(companyId)}&companyName=${encodeURIComponent(companyName)}&registrationToken=${encodeURIComponent(registrationToken)}`,
          scopes: "email openid profile"
        }
      })
      if (error) throw error
    } catch (e: any) {
      setError(e?.message || "Microsoft-Anmeldung fehlgeschlagen")
    }
  }

  return (
    <div className="flex min-h-screen w-full gap-4 bg-[#141414] p-3 text-white lg:p-4">
      <BrandPanel />

      <main className="relative flex flex-1 items-center justify-center px-2 py-10 sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(255,85,201,0.07) 0%, rgba(255,85,201,0) 70%)" }}
        />

        <div className="relative w-full max-w-[400px]">
          {/* Mobile logo */}
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

              {step === "company" && (
                <motion.div key="company" {...stepMotion}>
                  <h1 className="text-2xl font-semibold tracking-tight">Registrieren</h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                    Erstellen Sie ein neues Unternehmen
                  </p>

                  <form onSubmit={handleRegisterCompany} noValidate className="mt-7 space-y-4">
                    <AuthField
                      id="companyName"
                      label="Unternehmensname"
                      value={companyName}
                      onChange={setCompanyName}
                      placeholder="Muster GmbH"
                      autoComplete="organization"
                      autoFocus
                    />
                    <AuthField
                      id="accountName"
                      label="Account-Name"
                      value={accountName}
                      onChange={v => setAccountName(v.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                      suffix={DOMAIN_SUFFIX}
                      autoComplete="off"
                    />

                    {error && <ErrorBanner>{error}</ErrorBanner>}

                    <PrimaryButton loading={loading} loadingLabel="Wird erstellt...">
                      Weiter
                    </PrimaryButton>
                  </form>
                </motion.div>
              )}

              {step === "admin" && (
                <motion.div key="admin" {...stepMotion}>
                  <button
                    type="button"
                    onClick={() => { setStep("company"); setError(null) }}
                    className="group mb-6 flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-left transition-all duration-150 hover:border-white/[0.14] hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="truncate text-sm font-medium text-white/80">{companyName}</span>
                      <span className="shrink-0 text-xs text-white/30">{accountName}{DOMAIN_SUFFIX}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-medium text-white/40 transition-colors group-hover:text-white">
                      Ändern
                    </span>
                  </button>

                  <h1 className="text-2xl font-semibold tracking-tight">Admin-Account</h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                    Erstellen Sie Ihren Administrator-Account
                  </p>

                  <form onSubmit={handleCreateAdmin} noValidate className="mt-7 space-y-4">
                    <AuthField
                      id="adminName"
                      label="Ihr Name"
                      value={adminName}
                      onChange={setAdminName}
                      placeholder="Max Mustermann"
                      autoComplete="name"
                      autoFocus
                    />
                    <AuthField
                      id="adminEmail"
                      label="E-Mail-Adresse"
                      value={adminEmail}
                      onChange={setAdminEmail}
                      type="email"
                      placeholder="max@firma.de"
                      autoComplete="email"
                      inputMode="email"
                    />
                    <AuthField
                      id="adminPassword"
                      label="Passwort"
                      value={adminPassword}
                      onChange={setAdminPassword}
                      type={showPassword ? "text" : "password"}
                      placeholder="Mindestens 8 Zeichen"
                      autoComplete="new-password"
                      trailing={
                        <button
                          type="button"
                          onClick={() => setShowPassword(p => !p)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/35 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60"
                          aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      }
                    />
                    <AuthField
                      id="confirmPassword"
                      label="Passwort bestätigen"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      type={showConfirm ? "text" : "password"}
                      placeholder="Passwort wiederholen"
                      autoComplete="new-password"
                      trailing={
                        <button
                          type="button"
                          onClick={() => setShowConfirm(p => !p)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/35 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60"
                          aria-label={showConfirm ? "Passwort verbergen" : "Passwort anzeigen"}
                        >
                          {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      }
                    />

                    {error && <ErrorBanner>{error}</ErrorBanner>}

                    <PrimaryButton loading={loading} loadingLabel="Wird erstellt...">
                      Account erstellen
                    </PrimaryButton>
                  </form>

                  <OrDivider label="oder" />
                  <MicrosoftButton
                    label="Mit Microsoft registrieren"
                    onClick={handleMicrosoftRegister}
                  />
                </motion.div>
              )}

              {step === "done" && (
                <motion.div key="done" {...stepMotion} className="flex flex-col items-center py-4 text-center">
                  <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-[#ff55c9]/15">
                    <Mail className="size-6 text-[#ff55c9]" />
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight">E-Mail bestätigen</h1>
                  <p className="mt-3 text-sm leading-relaxed text-white/50">
                    Wir haben eine Bestätigungs-E-Mail an{" "}
                    <span className="font-medium text-white/80">{doneEmail}</span> gesendet.
                    Bitte klicken Sie auf den Link, um Ihren Account zu aktivieren.
                  </p>
                  <Link
                    href="/login"
                    className="mt-8 text-sm font-medium text-white/80 transition-colors hover:text-white"
                  >
                    Zum Login
                  </Link>
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {step !== "done" && (
            <div className="mt-4 flex items-center justify-center gap-3 text-xs text-white/30">
              <Link href="/login" className="transition-colors hover:text-white/60">
                Zurück zum Login
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
