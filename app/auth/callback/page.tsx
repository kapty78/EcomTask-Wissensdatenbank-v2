"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getSupabaseClient } from "@/lib/supabase-browser"
import { readRecoveryVerifier, clearRecoveryVerifier } from "@/lib/auth/pkce"

function parseHashParams(hash: string): Record<string, string> {
  const params: Record<string, string> = {}
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash
  for (const part of trimmed.split("&")) {
    if (!part) continue
    const [key, value] = part.split("=")
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "")
  }
  return params
}

export default function AuthCallbackUniversal() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = getSupabaseClient()
  const [error, setError] = useState<string | null>(null)
  const navigationHandled = useRef(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session || navigationHandled.current) return
      if (event === "PASSWORD_RECOVERY") {
        navigationHandled.current = true
        router.replace("/auth/reset-password")
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        // Prüfen, ob wir im Recovery-Flow sind
        const isRecovery = searchParams.get("type") === "recovery"
        
        navigationHandled.current = true
        
        if (isRecovery) {
          router.replace("/auth/reset-password")
        } else {
          router.replace("/dashboard")
        }
      }
    })

    const run = async () => {
      try {
        // 0) Fehlerbehandlung: Prüfen auf Fehler im Hash oder Query (von Supabase Redirects)
        const hashParams = parseHashParams(window.location.hash)
        const errorDescription = 
          searchParams.get("error_description") || 
          hashParams["error_description"] || 
          searchParams.get("error") || 
          hashParams["error"]

        if (errorDescription) {
          // Spezielle Behandlung für "Code Verifier" Fehler (PKCE Mismatch)
          const msg = decodeURIComponent(errorDescription).toLowerCase()
          if (msg.includes("code verifier") || msg.includes("pkce")) {
            setError("Der Link ist ungültig geworden (Sicherheitsüberprüfung fehlgeschlagen). Bitte fordern Sie einen neuen Link im selben Browser an.")
          } else if (msg.includes("expired") || msg.includes("abgelaufen")) {
            setError("Der Link ist abgelaufen. Bitte fordern Sie einen neuen Link an.")
          } else {
            setError(`Fehler bei der Anmeldung: ${decodeURIComponent(errorDescription)}`)
          }
          return
        }

        // 1) Recovery-Flow über Hash-Parameter (client-only)
        const type = hashParams["type"]
        const accessToken = hashParams["access_token"]
        const refreshToken = hashParams["refresh_token"]
        if (type === "recovery" && accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })
          if (error) {
            setError(error.message || "Fehler beim Setzen der Session.")
            return
          }
          // Die Navigation wird jetzt vom onAuthStateChange-Listener übernommen
          // router.replace("/auth/reset-password")
          return
        }

        // 1a) Signup-Flow über Hash-Parameter (manche Templates liefern Tokens im Hash)
        if (type === "signup" && accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })
          if (error) {
            // Kein harter Fehler, leite sauber zum Login weiter
            router.replace("/login")
            return
          }
          // Profil wird bereits bei der Registrierung erstellt
          router.replace("/dashboard")
          return
        }

        // 1b) Recovery-Flow über Query-Parameter (Fallback, manche Umgebungen entfernen Hash)
        const qAccess = searchParams.get("access_token")
        const qRefresh = searchParams.get("refresh_token")
        const qType = searchParams.get("type")
        if (qType === "recovery" && qAccess && qRefresh) {
          const { error } = await supabase.auth.setSession({
            access_token: qAccess,
            refresh_token: qRefresh
          })
          if (error) {
            setError(error.message || "Fehler beim Setzen der Session.")
            return
          }
          router.replace("/auth/reset-password")
          return
        }

        // 2) ZUERST: Signup-Bestätigung via token_hash (häufigster Supabase-Mail-Link)
        const typeQuery = searchParams.get("type")
        const flowQuery = searchParams.get("flow")
        const rawTokenParam = searchParams.get("token")
        const isPkceToken = rawTokenParam?.startsWith("pkce_") ?? false
        const tokenHash = searchParams.get("token_hash") || (!isPkceToken ? rawTokenParam : null)
        if (typeQuery === "signup" && tokenHash) {
          try {
            const { error } = await supabase.auth.verifyOtp({ type: "signup", token_hash: tokenHash } as any)
            // Erfolgreich bestätigt → Profil sichern und zum Login (ohne Fehlermeldung)
            try {
              const { data: userData } = await supabase.auth.getUser()
              const meta: any = userData?.user?.user_metadata || {}
              await fetch('/api/auth/ensure-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: meta.company_id, companyName: meta.company_name, fullName: meta.full_name })
              })
            } catch {}
            router.replace("/login")
            return
          } catch (_) {
            router.replace("/login")
            return
          }
        }

        // 2a) Magic-Link/OTP Code-Exchange via query param "code" (nur wenn kein signup-Hash-Fall)
        const code = searchParams.get("code") || (isPkceToken ? rawTokenParam : null)
        if (code && typeQuery !== 'signup') {
          const storedRecovery = readRecoveryVerifier()
          // Nur wenn wir einen Verifier haben, nutzen wir den manuellen PKCE Flow
          const useManualPkce = Boolean(storedRecovery?.verifier)

          if (useManualPkce && storedRecovery?.verifier) {
            try {
              const response = await fetch(
                `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=pkce`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    apikey: `${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
                    Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
                  },
                  body: JSON.stringify({
                    auth_code: code,
                    code_verifier: storedRecovery.verifier
                  })
                }
              )

              const payload = await response
                .json()
                .catch(() => ({ code: response.status, message: "Unbekannte Antwort vom Auth-Server." }))

              if (!response.ok) {
                clearRecoveryVerifier()
                const message =
                  payload?.message ||
                  payload?.error_description ||
                  payload?.error ||
                  "Fehler beim Bestätigen des Links."
                setError(message)
                return
              }

              const sessionData = payload?.session ?? payload
              const accessToken = sessionData?.access_token
              const refreshToken = sessionData?.refresh_token

              if (!accessToken || !refreshToken) {
                clearRecoveryVerifier()
                setError("Antwort des Auth-Servers unvollständig. Bitte fordere einen neuen Link an.")
                return
              }

              await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
              })
              clearRecoveryVerifier()

              if (!navigationHandled.current) {
                navigationHandled.current = true
                router.replace("/auth/reset-password")
              }
              return
            } catch (err: any) {
              setError(err?.message || "Fehler beim Bestätigen des Links.")
              return
            }
          } else {
            // Fallback: Standard exchangeCodeForSession (auch für Recovery ohne PKCE)
            try {
              const { error } = await supabase.auth.exchangeCodeForSession(code)
              if (error) {
                const msg = (error.message || '').toLowerCase()
                if (msg.includes('code verifier') || msg.includes('pkce')) {
                  setError("Authentifizierungslink ungültig. Bitte öffne ihn im selben Browser oder fordere einen neuen Link an.")
                  return
                }
                setError(error.message || "Fehler beim Bestätigen des Links.")
                return
              }
              
              // Bei erfolgreichem Exchange: Checken ob wir im Recovery Mode sind
              if (typeQuery === 'recovery') {
                router.replace("/auth/reset-password")
                return
              }

              if (!navigationHandled.current) {
                navigationHandled.current = true
                router.replace("/dashboard")
              }
              return
            } catch (err: any) {
              setError(err?.message || "Fehler beim Bestätigen des Links.")
              return
            }
          }
        }

        // 2b) Recovery-Flow über token/token_hash + type=recovery (Fallback)
        if (typeQuery === "recovery" && tokenHash) {
          try {
            // Manche Provider liefern nur token_hash zurück – Supabase kann damit verifizieren
            const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash } as any)
            if (!error) {
              router.replace("/auth/reset-password")
              return
            }
          } catch (_) {
            // ignorieren, wir fallen auf Login zurück
          }
        }

        // 3) Fallback
        router.replace("/login")
      } catch (e: any) {
        setError(e?.message || "Unerwarteter Fehler im Auth-Callback.")
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#1e1e1e] p-4 sm:p-6 text-white">
      <div className="w-full max-w-sm text-center px-4">
        <h1 className="mb-4 text-xl sm:text-2xl font-semibold">Authentifiziere…</h1>
        {!error ? (
          <p className="text-xs sm:text-sm text-gray-300">Einen Moment bitte.</p>
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
