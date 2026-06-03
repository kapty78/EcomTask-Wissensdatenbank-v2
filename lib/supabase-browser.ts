"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Database } from "@/supabase/types";

/**
 * Central Supabase browser client factory.
 *
 * In normal mode: delegates to createClientComponentClient (cookie-based, SSR-compatible).
 * In embedded/iframe mode: uses createClient with persistSession:false (in-memory only)
 * to avoid third-party cookie issues in cross-origin iframes.
 *
 * All pages/components should import { getSupabaseClient } from '@/lib/supabase-browser'
 * instead of calling createClientComponentClient() directly.
 */

let _embedded: boolean | null = null;
let _embeddedClient: SupabaseClient<Database> | null = null;

function isInIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isEmbedded(): boolean {
  if (_embedded !== null) return _embedded;
  _embedded = isInIframe();
  return _embedded;
}

/**
 * Get the Supabase client appropriate for the current context.
 * Safe to call multiple times - returns the same instance.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (isEmbedded()) {
    if (!_embeddedClient) {
      _embeddedClient = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      );
    }
    return _embeddedClient;
  }
  // Normal mode: cookie-based singleton from auth-helpers
  return createClientComponentClient<Database>();
}

/**
 * Get the raw embedded client (for use by SupabaseProvider during initialization).
 * Returns null in normal mode.
 */
export function getEmbeddedClient(): SupabaseClient<Database> | null {
  if (!isEmbedded()) return null;
  return getSupabaseClient(); // ensures creation
}
