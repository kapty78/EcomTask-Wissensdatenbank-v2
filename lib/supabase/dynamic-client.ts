import { createClient } from "@supabase/supabase-js"
import { Database } from "@/supabase/types"
import { cookies } from "next/headers"

/**
 * Creates a Supabase client for use in Edge runtime environments
 * This is needed because the ssr client doesn't work in Edge runtimes
 */
export const createSupabaseDynamicClient = async () => {
  const cookieStore = cookies()

  // Get auth cookie if it exists
  const supabaseAuthCookie = cookieStore.get("sb-auth-token")?.value

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      },
      global: {
        headers: {
          // Include auth cookie in request headers if available
          ...(supabaseAuthCookie
            ? { Cookie: `sb-auth-token=${supabaseAuthCookie}` }
            : {})
        }
      }
    }
  )

  return supabase
}
