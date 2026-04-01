"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseClient } from "@/lib/supabase-browser"

function parseHashParams(hash: string): Record<string, string> {
  const params: Record<string, string> = {}
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash
  for (const part of trimmed.split("&")) {
    const [key, value] = part.split("=")
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "")
  }
  return params
}

export default function RecoveryCallbackPage() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleRecovery = async () => {
      try {
        const { hash } = window.location
        const params = parseHashParams(hash)
        const type = params["type"]
        const accessToken = params["access_token"]
        const refreshToken = params["refresh_token"]

        if (type === "recovery" && accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })
          if (setSessionError) {
            setError("Fehler beim Setzen der Session. Bitte erneut versuchen.")
            return
          }
          router.replace("/auth/reset-password")
        } else {
          setError("Ungültiger Wiederherstellungslink. Bitte fordere einen neuen Link an.")
        }
      } catch (e: any) {
        setError(e?.message || "Unerwarteter Fehler beim Wiederherstellen der Sitzung.")
      }
    }

    handleRecovery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#1e1e1e] p-4 sm:p-6 text-white">
      <div className="w-full max-w-sm text-center px-4">
        <h1 className="mb-4 text-xl sm:text-2xl font-semibold">Passwort-Wiederherstellung</h1>
        {!error ? (
          <p className="text-xs sm:text-sm text-gray-300">Einen Moment bitte, wir bereiten alles vor…</p>
        ) : (
          <>
            <p className="mb-4 text-xs sm:text-sm text-red-400">{error}</p>
            <button
              onClick={() => router.replace("/login")}
              className="w-full rounded-md bg-white px-4 py-2.5 sm:py-2 text-sm sm:text-base font-medium text-[#1e1e1e] transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1e1e1e]"
            >
              Zurück zum Login
            </button>
          </>
        )}
      </div>
    </div>
  )
}


