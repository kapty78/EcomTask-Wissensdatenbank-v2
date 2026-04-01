"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseClient } from "@/lib/supabase-browser"
import Image from "next/image"

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [needsMfa, setNeedsMfa] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null)
  const [step, setStep] = useState<"password" | "otp">("password")

  // Versuche beim Laden evtl. vorhandene TOTP-Faktoren zu ermitteln
  useEffect(() => {
    const detectFactors = async () => {
      try {
        const anySupabase: any = supabase as any
        if (!anySupabase?.auth?.mfa?.listFactors) return
        const { data } = await anySupabase.auth.mfa.listFactors()
        const factors = (data?.factors || data?.all || []) as any[]
        const totp = factors?.find((f: any) => (f?.factor_type || f?.factorType) === 'totp')
        if (totp) {
          setMfaFactorId(totp.id)
        }
      } catch {
        // ignore
      }
    }
    detectFactors()
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.")
      return
    }
    if (password !== confirmPassword) {
      setError("Die Passwörter stimmen nicht überein.")
      return
    }

    // Wenn MFA-Faktor vorhanden ist, führen wir zuerst eine Challenge aus und springen in Schritt 2,
    // statt erst ein Fehler anzuzeigen.
    setLoading(true)
    try {
      const anySupabase: any = supabase as any
      let factorId = mfaFactorId
      if (!factorId && anySupabase?.auth?.mfa?.listFactors) {
        const { data } = await anySupabase.auth.mfa.listFactors()
        const factors = (data?.factors || data?.all || []) as any[]
        const totp = factors?.find((f: any) => (f?.factor_type || f?.factorType) === 'totp')
        if (totp) factorId = totp.id
        if (factorId) setMfaFactorId(factorId)
      }

      if (factorId && anySupabase?.auth?.mfa?.challenge) {
        const { data: challenge } = await anySupabase.auth.mfa.challenge({ factorId })
        const challengeId = (challenge?.id || challenge?.challenge_id) as string
        setMfaChallengeId(challengeId)
        setNeedsMfa(true)
        setStep("otp")
        setLoading(false)
        return
      }

      // Kein MFA erforderlich → direkt Passwort setzen
      const { error: updateError } = await supabase.auth.updateUser({ password })
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

  const handleVerifyMfaAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      const anySupabase: any = supabase as any
      if (!mfaFactorId || !mfaChallengeId) {
        setError("MFA-Kontext fehlt. Bitte fordere den Link erneut an.")
        setLoading(false)
        return
      }
      const { error: verifyError } = await anySupabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: otpCode
      })
      if (verifyError) {
        setError(verifyError.message || "Code ungültig. Bitte erneut versuchen.")
        setLoading(false)
        return
      }

      // Nach erfolgreicher AAL2-Erhöhung Passwort setzen
      const { error: updateError } = await supabase.auth.updateUser({ password })
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#1e1e1e] text-white p-4">
      <div className="mb-3 sm:mb-4">
        <Image src="/EcomTask.svg" alt="EcomTask Logo" width={180} height={45} priority className="w-[140px] h-auto sm:w-[180px]" />
      </div>
      <div className="w-full max-w-sm px-2 sm:px-4">
        <h1 className="mb-2 text-center text-2xl sm:text-3xl font-semibold">Neues Passwort setzen</h1>
        <p className="mb-4 sm:mb-6 text-center text-xs sm:text-sm text-gray-300">Bitte geben Sie Ihr neues Passwort ein.</p>
        <form onSubmit={needsMfa ? handleVerifyMfaAndSubmit : handleSubmit} className="space-y-3">
          <input
            id="password"
            type="password"
            placeholder="Neues Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="block w-full h-12 sm:h-14 rounded-[12px] border bg-[#2a2a2a] px-4 text-sm sm:text-[14px] text-white placeholder:text-gray-400 focus:outline-none focus:ring-0 border-[#3a3a3a] focus:border-[#777777]"
          />
          <input
            id="confirmPassword"
            type="password"
            placeholder="Passwort bestätigen"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="block w-full h-12 sm:h-14 rounded-[12px] border bg-[#2a2a2a] px-4 text-sm sm:text-[14px] text-white placeholder:text-gray-400 focus:outline-none focus:ring-0 border-[#3a3a3a] focus:border-[#777777]"
          />
          {step === 'otp' && (
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="6-stelliger Authenticator‑Code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              required
              className="block w-full h-12 sm:h-14 rounded-[12px] border bg-[#2a2a2a] px-4 text-sm sm:text-[14px] text-white placeholder:text-gray-400 focus:outline-none focus:ring-0 border-[#3a3a3a] focus:border-[#777777]"
            />
          )}
          {error && <p className="text-xs sm:text-sm text-red-400">{error}</p>}
          {success && <p className="text-xs sm:text-sm text-green-400">{success}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-white px-4 py-3 sm:py-3.5 text-sm sm:text-base font-semibold text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e] disabled:opacity-50"
          >
            {loading ? "Speichere…" : step === 'otp' ? "Code prüfen & Passwort setzen" : "Passwort setzen"}
          </button>
      </form>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-[#1e1e1e] border-t border-[#333333] z-10">
        <div className="flex justify-center items-center py-1.5 sm:py-2 px-4">
          <p className="text-[10px] sm:text-xs text-gray-500 text-center">powered by <span className="text-white font-medium">EcomTask</span></p>
        </div>
      </div>
    </div>
  )
}


