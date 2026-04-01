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
        const companyName = searchParams.get("companyName")

        const { data: sessionData } = await supabase.auth.getSession()
        const user = sessionData.session?.user
        if (!user) {
          setError("Keine gültige Session gefunden. Bitte erneut anmelden.")
          router.replace("/login")
          return
        }

        // Profil für OAuth wird direkt bei der Registrierung über create-profile-direct erstellt
        // (OAuth flow kommt erst nach der Registrierung)

        if (companyId) {
          try {
            // Admin-Zuweisung via API-Route
            await fetch("/api/register-admin", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: user.id, companyId })
            })
          } catch {}
        }

        // MFA: Falls TOTP-Faktor aktiv ist, leite zur MFA-Seite
        try {
          const anySupabase: any = supabase as any
          if (anySupabase?.auth?.mfa?.listFactors) {
            const { data: factorsData } = await anySupabase.auth.mfa.listFactors()
            const factors = (factorsData?.factors || factorsData?.all || []) as any[]
            const hasTotp = factors?.some((f: any) => (f?.factor_type || f?.factorType) === 'totp')
            if (hasTotp) {
              router.replace('/auth/mfa')
              return
            }
          }
        } catch {}

        router.replace("/dashboard")
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


