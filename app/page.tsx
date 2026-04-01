"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSupabaseClient } from "@supabase/auth-helpers-react"

export default function HomePage() {
  const router = useRouter()
  const supabase = useSupabaseClient()

  useEffect(() => {
    const checkSessionAndRedirect = async () => {
      const hash = window.location.hash
      const search = window.location.search

      // Zuerst prüfen: Haben wir Auth-Fragmente oder Query-Parameter in der URL?
      // (Embedded-Mode hash wird bereits vom SupabaseProvider verarbeitet und bereinigt)
      const hasAuthParams =
        hash.includes('type=recovery') ||
        (hash.includes('access_token') && !hash.includes('type=embedded')) ||
        hash.includes('error=') ||
        hash.includes('error_code=') ||
        search.includes('code=') ||
        search.includes('type=recovery') ||
        search.includes('error=')

      if (hasAuthParams) {
        let target = '/auth/callback'
        if (search) target += search
        if (hash) target += hash
        router.replace(target)
        return
      }

      // Session prüfen (im embedded mode wurde sie bereits vom SupabaseProvider gesetzt)
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        router.push('/dashboard')
      } else {
        router.push('/login')
      }
    }

    checkSessionAndRedirect()
  }, [router, supabase])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1e1e1e] text-white p-4">
      <div className="animate-pulse flex flex-col items-center">
        <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full border-4 border-t-pink-500 border-r-transparent border-b-pink-500 border-l-transparent animate-spin mb-4"></div>
        <p className="text-white font-medium tracking-wider text-sm sm:text-base">Weiterleitung...</p>
      </div>
    </div>
  )
}
