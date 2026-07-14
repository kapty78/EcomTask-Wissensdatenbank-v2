/**
 * Knowledge-Base-Autorisierung für API-Routes.
 * =====================================================================
 * Historie: Mehrere Knowledge-Routes nutzten den SERVICE_ROLE_KEY OHNE
 * jede Auth-/Ownership-Prüfung. Dadurch konnte ein beliebiger (auch
 * unauthentifizierter) Aufrufer mit einer bekannten `knowledge_base_id`
 * fremde Wissensbasen lesen bzw. verändern (IDOR / Broken Object Level
 * Authorization).
 *
 * Fix-Doktrin (defense in depth):
 *   1. `getRouteAuth` erzwingt einen gültigen User (401 sonst).
 *   2. Der Zugriff auf die betroffene(n) Knowledge Base(s) wird über den
 *      RLS-gescopten User-Client geprüft: Ein SELECT auf `knowledge_bases`
 *      liefert dank der company-isolierten RLS-Policy NUR KBs, die der User
 *      als Owner ODER via Company-Sharing sehen darf. Sieht er alle
 *      angefragten IDs → Zugriff ok, sonst 403.
 *
 * Die eigentliche Verarbeitung darf danach weiterhin mit dem Admin-Client
 * (SERVICE_ROLE) laufen — die Ownership ist an diesem Punkt bereits belegt.
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRouteAuth, type RouteAuth } from '@/lib/route-auth';

export type KbAuthz =
  | { ok: true; auth: RouteAuth | null }
  | { ok: false; response: NextResponse };

function toIds(kbIdOrIds: string | Array<string | null | undefined>): string[] {
  const list = Array.isArray(kbIdOrIds) ? kbIdOrIds : [kbIdOrIds];
  return [...new Set(list.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/**
 * Vertrauenswürdiger Server-zu-Server-Aufruf (z.B. der WDB-Agent, der diese
 * Routes als Tools nutzt). Der `API_SECRET_KEY` ist ausschließlich serverseitig
 * bekannt — ein externer Angreifer kann diesen Header nicht setzen. Der Agent
 * hat den Aufrufer bereits authentifiziert und die KB-ID gescopet.
 */
export function hasInternalApiSecret(request: Request): boolean {
  const provided = request.headers.get('x-internal-api-key');
  const expected = process.env.API_SECRET_KEY;
  return typeof expected === 'string' && expected.length > 0 && provided === expected;
}

/**
 * Prüft, ob der (RLS-gescopte) User Zugriff auf ALLE angegebenen Knowledge
 * Bases hat. Grundlage ist die company-isolierte RLS-SELECT-Policy auf
 * `knowledge_bases` — kein manueller Company-Abgleich nötig.
 */
export async function userCanAccessKbs(
  supabase: SupabaseClient,
  kbIdOrIds: string | Array<string | null | undefined>,
): Promise<boolean> {
  const ids = toIds(kbIdOrIds);
  if (ids.length === 0) return false;
  const { data, error } = await supabase
    .from('knowledge_bases')
    .select('id')
    .in('id', ids);
  if (error || !data) return false;
  return data.length === ids.length;
}

/**
 * One-Stop-Guard für KB-gebundene Routes: authentifiziert den Request und
 * verifiziert Zugriff auf die angegebene(n) KB-ID(s).
 *
 * Rückgabe:
 *   { ok: true, auth }  → weiterarbeiten (auth.user, auth.supabase verfügbar)
 *   { ok: false, response } → diese Response direkt zurückgeben (401/403)
 */
export async function authorizeKbRequest(
  request: Request,
  kbIdOrIds: string | Array<string | null | undefined>,
): Promise<KbAuthz> {
  // Vertrauenswürdiger interner Aufruf (Agent/Server-zu-Server) — kein User-Kontext.
  if (hasInternalApiSecret(request)) {
    return { ok: true, auth: null };
  }
  const auth = await getRouteAuth(request);
  if (!auth) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (toIds(kbIdOrIds).length === 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'knowledge_base_id ist erforderlich' }, { status: 400 }),
    };
  }
  const allowed = await userCanAccessKbs(auth.supabase, kbIdOrIds);
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, auth };
}

/**
 * Löst die knowledge_base_id(s) für Chunk-/Item-Referenzen auf. Wird für
 * Routes gebraucht, die nur `chunkId`/`itemIds` erhalten (kein KB-Feld).
 * Benötigt einen Admin-Client, weil zu diesem Zeitpunkt noch keine
 * Ownership feststeht — die eigentliche Zugriffsprüfung passiert danach
 * über {@link authorizeKbRequest}/{@link userCanAccessKbs}.
 */
export async function resolveKbIdsFromItems(
  admin: SupabaseClient,
  opts: { chunkId?: string | null; itemIds?: string[] | null },
): Promise<string[]> {
  const kbIds = new Set<string>();

  if (opts.chunkId) {
    const { data } = await admin
      .from('knowledge_items')
      .select('knowledge_base_id')
      .eq('source_chunk', opts.chunkId);
    data?.forEach((row: { knowledge_base_id: string | null }) => {
      if (row.knowledge_base_id) kbIds.add(row.knowledge_base_id);
    });
  }

  if (opts.itemIds && opts.itemIds.length > 0) {
    const { data } = await admin
      .from('knowledge_items')
      .select('knowledge_base_id')
      .in('id', opts.itemIds);
    data?.forEach((row: { knowledge_base_id: string | null }) => {
      if (row.knowledge_base_id) kbIds.add(row.knowledge_base_id);
    });
  }

  return [...kbIds];
}
