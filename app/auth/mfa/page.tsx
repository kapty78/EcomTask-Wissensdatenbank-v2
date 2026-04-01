"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseClient } from "@/lib/supabase-browser"
import Image from "next/image"

export default function MfaPage() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [otp, setOtp] = useState("")
  const [factorId, setFactorId] = useState<string | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const hasInitialized = useRef(false)

  useEffect(() => {
    // Verhindere doppelte Ausführung
    if (hasInitialized.current) {
      return
    }
    hasInitialized.current = true
    const prepare = async () => {
      setLoading(true)
      setError(null)
      try {
        // Prüfen, ob ein TOTP-Faktor existiert
        const anySupabase: any = supabase as any
        if (!anySupabase?.auth?.mfa?.listFactors) {
          router.replace("/dashboard")
          return
        }

        const { data, error: listError } = await anySupabase.auth.mfa.listFactors()

        if (listError) {
          // Bei Fehler (z.B. MFA deaktiviert), leite zum Dashboard weiter
          router.replace("/dashboard")
          return
        }

        const factors = (data?.factors || data?.all || []) as any[]

        // Prüfe auf aktive (nicht abgelaufene) TOTP-Faktoren
        const currentTime = Math.floor(Date.now() / 1000) // Aktuelle Zeit in Sekunden
        const activeTotpFactors = factors?.filter((f: any) => {
          const factorType = f?.factor_type || f?.factorType
          const expiresAt = f?.expires_at || f?.expiresAt

          // Prüfe Typ
          if (factorType !== 'totp') return false

          // Prüfe ob abgelaufen
          if (expiresAt && expiresAt < currentTime) {
            return false
          }

          return true
        }) || []

        if (activeTotpFactors.length === 0) {
          // Keine aktive MFA → direkt weiter
          router.replace("/dashboard")
          return
        }

        const totp = activeTotpFactors[0] // Verwende den ersten aktiven Faktor

        // Prüfe ob der Faktor verifiziert ist
        if (totp.status !== 'verified') {
          setError("Der MFA-Faktor ist nicht verifiziert. Bitte richten Sie die Zwei-Faktor-Authentifizierung erneut ein.")
          router.replace("/dashboard")
          return
        }
        setFactorId(totp.id)

        // Prüfe aktuelle Session vor Challenge-Anforderung
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) {
          setError("Sitzung ist ungültig. Bitte erneut anmelden.")
          router.replace("/login")
          return
        }

        if (!sessionData.session?.user) {
          setError("Keine gültige Sitzung gefunden. Bitte erneut anmelden.")
          router.replace("/login")
          return
        }

        // Challenge anfordern
        const { data: challenge, error: challengeError } = await anySupabase.auth.mfa.challenge({
          factorId: totp.id
        })

        if (challengeError) {
          setError("MFA-Challenge konnte nicht angefordert werden.")
          return
        }

        const cId = (challenge?.id || challenge?.challenge_id) as string

        if (!cId) {
          setError("MFA-Challenge konnte nicht erstellt werden.")
          return
        }

        setChallengeId(cId)
      } catch (e: any) {
        setError(e?.message || "MFA konnte nicht gestartet werden.")
        // Bei unerwarteten Fehlern, leite trotzdem zum Dashboard weiter
        setTimeout(() => router.replace("/dashboard"), 3000)
      } finally {
        setLoading(false)
      }
    }
    prepare()
  }, [router, supabase])

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!otp || otp.length !== 6) {
      setError("Bitte geben Sie einen gültigen 6-stelligen Code ein.")
      return
    }

    try {
      const anySupabase: any = supabase as any
      if (!factorId || !challengeId) {
        setError("MFA-Kontext fehlt. Bitte erneut anmelden.")
        router.replace("/login")
        return
      }

      const { error: verifyError } = await anySupabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: otp
      })

      if (verifyError) {
        setError(verifyError.message || "Code ungültig. Bitte erneut versuchen.")
        return
      }

      router.replace("/dashboard")
    } catch (e: any) {
      setError(e?.message || "Unerwarteter Fehler bei der MFA.")
      // Bei unerwarteten Fehlern, leite nach kurzer Zeit trotzdem weiter
      setTimeout(() => router.replace("/dashboard"), 3000)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#1e1e1e] text-white p-4">
      <div className="mb-3 sm:mb-4">
        <Image src="/EcomTask.svg" alt="EcomTask Logo" width={180} height={45} priority className="w-[140px] h-auto sm:w-[180px]" />
      </div>
      <div className="w-full max-w-sm px-2 sm:px-4">
        <h1 className="mb-2 text-center text-2xl sm:text-3xl font-semibold">Zwei‑Faktor‑Bestätigung</h1>
        <p className="mb-4 sm:mb-6 text-center text-xs sm:text-sm text-gray-300">Bitte geben Sie den 6‑stelligen Code Ihrer Authenticator‑App ein.</p>
        {loading ? (
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-gray-300">MFA wird vorbereitet…</p>
          </div>
        ) : error && !factorId ? (
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <p className="text-sm text-gray-400 mb-4">Sie werden in wenigen Sekunden weitergeleitet...</p>
            <button
              onClick={() => router.replace("/dashboard")}
              className="w-full rounded-full bg-white px-4 py-3 font-semibold text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e]"
            >
              Sofort weiter
            </button>
          </div>
        ) : (
          <form onSubmit={handleVerify} className="space-y-3">
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              pattern="[0-9]*"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="6‑stelliger Code aus Authenticator‑App"
              required
              className="block w-full h-12 sm:h-14 rounded-[12px] border bg-[#2a2a2a] px-4 text-sm sm:text-[14px] text-white placeholder:text-gray-400 focus:outline-none focus:ring-0 border-[#3a3a3a] focus:border-[#777777]"
            />
            {error && <p className="text-xs sm:text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              className="w-full rounded-full bg-white px-4 py-3 sm:py-3.5 text-sm sm:text-base font-semibold text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e]"
            >
              Bestätigen
            </button>
          </form>
        )}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-[#1e1e1e] border-t border-[#333333] z-10">
        <div className="flex justify-center items-center py-1.5 sm:py-2 px-4">
          <p className="text-[10px] sm:text-xs text-gray-500 text-center">powered by <span className="text-white font-medium">EcomTask</span></p>
        </div>
      </div>
    </div>
  )
}


