"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import { CheckCircle2 } from "lucide-react"
import { getSupabaseClient } from "@/lib/supabase-browser"
import { BrandPanel } from "@/app/login/_components/BrandPanel"
import { PrimaryButton, ErrorBanner } from "@/app/login/_components/auth-ui"

// Supabase-OTP-Typen, die wir über diese Bestätigungsseite zulassen.
const ALLOWED_TYPES = [
  "signup",
  "email",
  "invite",
  "magiclink",
  "recovery",
  "email_change"
] as const
type ConfirmType = (typeof ALLOWED_TYPES)[number]

type Status = "idle" | "verifying" | "success" | "error"

/**
 * Prefetch-sichere E-Mail-Bestätigung.
 *
 * Mail-Security-Scanner (Microsoft Defender/SafeLinks, Mail-Gateways) rufen jeden
 * Link in einer eingehenden Mail automatisch per GET auf. Bei Supabase-Standard-
 * Links (`/auth/v1/verify`, Einmal-Token) verbraucht dieser Scan-GET den Token,
 * sodass der spätere Klick des Menschen als „abgelaufen" (otp_expired) scheitert.
 *
 * Deshalb passiert die Verifikation hier ausschließlich beim expliziten Klick
 * auf den Button (Formular-Submit) — niemals beim Laden der Seite. Ein Scanner
 * macht nur GET, klickt aber keinen Button → der Token bleibt gültig, bis der
 * Nutzer bestätigt. `verifyOtp({ token_hash })` benötigt zudem keinen PKCE-
 * code_verifier und funktioniert daher auch geräteübergreifend.
 */
function ConfirmInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = getSupabaseClient()

  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)

  const tokenHash = searchParams.get("token_hash")
  const rawType = searchParams.get("type")
  const confirmType = useMemo<ConfirmType | null>(() => {
    return ALLOWED_TYPES.includes(rawType as ConfirmType)
      ? (rawType as ConfirmType)
      : null
  }, [rawType])

  const isRecovery = confirmType === "recovery"

  // Fehlender/ungültiger Link → sofort Fehlerzustand (aber KEINE Verifikation).
  const linkInvalid = !tokenHash || !confirmType

  // Nach erfolgreicher Signup-Bestätigung sanft zum Login weiterleiten.
  useEffect(() => {
    if (status !== "success" || isRecovery) return
    const timer = setTimeout(() => router.replace("/login"), 2200)
    return () => clearTimeout(timer)
  }, [status, isRecovery, router])

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (linkInvalid || !tokenHash || !confirmType) return

    setStatus("verifying")
    setError(null)

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: confirmType
      })

      if (verifyError) {
        const msg = (verifyError.message || "").toLowerCase()
        if (msg.includes("expired") || msg.includes("invalid")) {
          setError(
            "Dieser Bestätigungslink ist nicht mehr gültig — vermutlich wurde er bereits verwendet. Bitte starte die Registrierung erneut, um einen neuen Bestätigungslink zu erhalten."
          )
        } else {
          setError(verifyError.message || "Bestätigung fehlgeschlagen.")
        }
        setStatus("error")
        return
      }

      setStatus("success")

      if (isRecovery) {
        router.replace("/auth/reset-password")
      }
    } catch (err: any) {
      setError(err?.message || "Unerwarteter Fehler bei der Bestätigung.")
      setStatus("error")
    }
  }

  const heading = isRecovery ? "Zugang bestätigen" : "E-Mail bestätigen"
  const subtitle = isRecovery
    ? "Klicke auf den Button, um fortzufahren und ein neues Passwort zu setzen."
    : "Nur noch ein Klick: Bestätige deine E-Mail-Adresse, um deine Registrierung abzuschließen."

  return (
    <div className="flex min-h-screen w-full gap-4 bg-[#141414] p-3 text-white lg:p-4">
      <BrandPanel />

      <main className="relative flex flex-1 items-center justify-center px-2 py-10 sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(255,85,201,0.07) 0%, rgba(255,85,201,0) 70%)"
          }}
        />

        <div className="relative w-full max-w-[400px]">
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
            {status === "success" && !isRecovery ? (
              <div className="text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#ff55c9]/10">
                  <CheckCircle2 className="h-8 w-8 text-[#ff55c9]" aria-hidden />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  E-Mail bestätigt
                </h1>
                <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                  Deine Registrierung ist abgeschlossen. Du wirst zum Login
                  weitergeleitet …
                </p>
                <div className="mt-7">
                  <button
                    type="button"
                    onClick={() => router.replace("/login")}
                    className="flex h-11 w-full items-center justify-center rounded-xl bg-white text-[15px] font-semibold text-[#161616] transition-all duration-150 hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff55c9]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1c1c]"
                  >
                    Zum Login
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {heading}
                </h1>
                <p className="mt-1.5 text-sm leading-relaxed text-white/50">
                  {subtitle}
                </p>

                {linkInvalid ? (
                  <div className="mt-7 space-y-4">
                    <ErrorBanner>
                      Dieser Link ist unvollständig oder ungültig. Bitte öffne
                      den Bestätigungslink direkt aus der E-Mail.
                    </ErrorBanner>
                    <button
                      type="button"
                      onClick={() => router.replace("/login")}
                      className="flex h-11 w-full items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-[15px] font-medium text-white/90 transition-all duration-150 hover:border-white/[0.14] hover:bg-white/[0.06]"
                    >
                      Zum Login
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleConfirm} className="mt-7 space-y-4">
                    {status === "error" && error && (
                      <ErrorBanner>{error}</ErrorBanner>
                    )}
                    <PrimaryButton
                      loading={status === "verifying"}
                      loadingLabel="Bestätige …"
                    >
                      {isRecovery ? "Fortfahren" : "Registrierung bestätigen"}
                    </PrimaryButton>
                    {status === "error" && (
                      <button
                        type="button"
                        onClick={() => router.replace("/login")}
                        className="w-full text-center text-sm text-white/40 transition-colors hover:text-white"
                      >
                        Zurück zum Login
                      </button>
                    )}
                  </form>
                )}
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-white/25">
            powered by{" "}
            <span className="font-medium text-white/60">EcomTask</span>
          </p>
        </div>
      </main>
    </div>
  )
}

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#141414] text-white/60">
          Einen Moment bitte …
        </div>
      }
    >
      <ConfirmInner />
    </Suspense>
  )
}
