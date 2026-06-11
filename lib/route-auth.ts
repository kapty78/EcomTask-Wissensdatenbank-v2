/**
 * Einheitliche User-Auth für API-Routes: Bearer-Token zuerst, Cookie-Fallback.
 * =====================================================================
 * Im Embedded-Modus (Support-AI-iframe) gibt es keine Auth-Cookies
 * (Third-Party-Cookies, persistSession:false im Browser-Client). Der
 * Client schickt deshalb den Supabase-Access-Token als
 * `Authorization: Bearer` (siehe lib/api-fetch.ts). Standalone bleibt
 * der bisherige Cookie-Flow unverändert als Fallback erhalten.
 *
 * Der zurückgegebene Supabase-Client ist in BEIDEN Fällen RLS-gescoped
 * auf den User (Anon-Key + Token bzw. Cookie-Session) — Routes verhalten
 * sich identisch zum bisherigen createRouteHandlerClient-Muster.
 */
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export interface RouteAuth {
  user: User;
  supabase: SupabaseClient;
}

function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Liefert User + RLS-gescopten Supabase-Client oder null (=401 senden).
 * Ein mitgeschickter, aber ungültiger Bearer-Token fällt NICHT auf
 * Cookies zurück (kein stilles Downgrade der Identität).
 */
export async function getRouteAuth(request: Request): Promise<RouteAuth | null> {
  const token = bearerTokenFrom(request);

  if (token) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    );
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return { user, supabase };
  }

  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { user, supabase };
}
