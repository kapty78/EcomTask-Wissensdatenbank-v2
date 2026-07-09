"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getSupabaseClient } from "@/lib/supabase-browser"

export default function PostOAuthRegister() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = getSupabaseClient()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      try {
        const companyId = searchParams.get("companyId")
        const registrationToken = searchParams.get("registrationToken")
        // Open-Redirect-Schutz: nur relative Pfade auf gleicher Origin zulassen.
        const rawReturnUrl = searchParams.get("returnUrl")
        const returnUrl =
          rawReturnUrl && rawReturnUrl.startsWith("/") && !rawReturnUrl.startsWith("//")
            ? rawReturnUrl
            : null

        const { data: sessionData } = await supabase.auth.getSession()
        const user = sessionData.session?.user
        if (!user) {
          setError("Keine gültige Session gefunden. Bitte erneut anmelden.")
          router.replace("/login")
          return
        }

        // Admin-Registrierung NUR bei echtem Registrierungs-Token (Firmen-Anlage-
        // Schritt). Ohne Token ist das ein normaler OAuth-Login eines bestehenden
        // Users — dann niemals register-admin aufrufen (das würde ohne Token 403en
        // und außerdem einen Cross-Tenant-Self-Join über eine geratene companyId
        // ermöglichen).
        if (companyId && registrationToken) {
          // Admin-Zuweisung + Profil via API-Route (autorisiert über den
          // Registrierungs-Token aus dem Firmen-Anlage-Schritt)
          const res = await fetch("/api/register-admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: user.id,
              companyId,
              registrationToken,
              email: user.email,
              fullName: user.user_metadata?.full_name || user.user_metadata?.name || null
            })
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            setError(`Fehler bei der Zuweisung der Admin-Rolle: ${d.error || res.statusText}`)
            return
          }
        }

        // MFA: Falls TOTP-Faktor aktiv ist, leite zur MFA-Seite
        try {
          const anySupabase: any = supabase as any
          if (anySupabase?.auth?.mfa?.listFactors) {
            const { data: factorsData } = await anySupabase.auth.mfa.listFactors()
            const factors = (factorsData?.factors || factorsData?.all || []) as any[]
            // Nur VERIFIZIERTE TOTP-Faktoren zählen — sonst schickt ein hängender,
            // unverifizierter Faktor den User auf /auth/mfa, das ihn sofort wieder
            // wegleitet (verwirrender Doppel-Redirect, wirkt wie "2FA spinnt").
            const hasTotp = factors?.some(
              (f: any) => (f?.factor_type || f?.factorType) === 'totp' && f?.status === 'verified'
            )
            if (hasTotp) {
              const mfaUrl = returnUrl
                ? `/auth/mfa?returnUrl=${encodeURIComponent(returnUrl)}`
                : '/auth/mfa'
              router.replace(mfaUrl)
              return
            }
          }
        } catch {}

        router.replace(returnUrl || "/dashboard")
      } catch (e: any) {
        setError(e?.message || "Unerwarteter Fehler nach OAuth-Registrierung.")
      }
    }
    run()
  }, [router, searchParams, supabase])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1e1e1e] p-4 sm:p-6 text-white">
      <div className="w-full max-w-sm text-center px-4">
        <h1 className="mb-4 text-xl sm:text-2xl font-semibold">Registrierung wird abgeschlossen…</h1>
        {!error ? (
          <p className="text-xs sm:text-sm text-gray-300">Einen Moment bitte.</p>
        ) : (
          <p className="text-xs sm:text-sm text-red-400">{error}</p>
        )}
      </div>
    </div>
  )
}


