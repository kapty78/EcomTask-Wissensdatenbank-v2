"use client";

import { getSupabaseClient } from "@/lib/supabase-browser";

/**
 * fetch() für same-origin /api-Routes, das in BEIDEN Modi funktioniert:
 * - Standalone: Cookie-Auth wie bisher (Header schadet nicht, Cookies laufen mit)
 * - Embedded (Support-AI-iframe): keine Third-Party-Cookies — der aktuelle
 *   Supabase-Access-Token wird als `Authorization: Bearer` mitgeschickt,
 *   Routes prüfen ihn über lib/route-auth.ts.
 *
 * Ein bereits explizit gesetzter Authorization-Header wird nie überschrieben.
 */
export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) {
    try {
      const {
        data: { session },
      } = await getSupabaseClient().auth.getSession();
      if (session?.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
      }
    } catch {
      // Kein Token verfügbar → Request läuft wie bisher über Cookies.
    }
  }
  return fetch(input, { ...init, headers });
}
