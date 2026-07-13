/**
 * WP-D2 — Cross-Agent-HMAC ueber Canonical Request (WDB-Seite: Verify)
 * =====================================================================
 * Eine reine Body-Signatur liesse Methoden-/Endpoint-Verwechslung und
 * Cross-Route-Replay offen. Deshalb Canonical Request:
 *
 *   canonical = METHOD \n PATH \n timestamp(unix-ms) \n requestId \n hex(sha256(body))
 *   X-Cross-Agent-Signature: hex(hmacSHA256(CROSS_AGENT_SECRET, canonical))
 *   X-Cross-Agent-Timestamp: <unix-ms>
 *   X-Cross-Agent-Request-Id: <uuid>
 *
 * Verworfen werden: Timestamp-Skew >5 min, falsche Signaturen
 * (Konstantzeit-Vergleich) und bereits gesehene requestIds (persistente
 * Dedup in agent_request_dedup — Replay-Schutz AUCH innerhalb des
 * Skew-Fensters; die Dedup-Pruefung macht die Route, nicht dieses Modul).
 *
 * SPIEGEL-DATEI: Support AI/src/lib/support-agent/shared/cross-agent-hmac.ts
 * (Sign-Seite + identische Helfer). Aenderungen immer beidseitig.
 */
import crypto from "crypto"

export const CROSS_AGENT_MAX_SKEW_MS = 5 * 60 * 1000

export function buildCanonicalRequest(
  method: string,
  path: string,
  timestamp: string,
  requestId: string,
  rawBody: string
): string {
  const bodyHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex")
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${requestId}\n${bodyHash}`
}

export function signCanonicalRequest(secret: string, canonical: string): string {
  return crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex")
}

/** Konstantzeit-Vergleich; Laengen-Mismatch faellt nicht auf Frueh-Exit zurueck. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) {
    // Gleichlange Dummy-Operation, damit der Laengen-Pfad nicht messbar schneller ist.
    crypto.timingSafeEqual(bufA, bufA)
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

export type HmacVerifyResult = { ok: true; requestId: string } | { ok: false; reason: string }

export function verifyCrossAgentHmac(params: {
  secret: string
  method: string
  path: string
  signature: string | null
  timestamp: string | null
  requestId: string | null
  rawBody: string
  nowMs?: number
}): HmacVerifyResult {
  const { secret, method, path, signature, timestamp, requestId, rawBody } = params
  const nowMs = params.nowMs ?? Date.now()

  if (!signature || !timestamp || !requestId) {
    return { ok: false, reason: "HMAC-Header unvollstaendig (Signature/Timestamp/Request-Id)" }
  }
  const tsMs = Number(timestamp)
  if (!Number.isFinite(tsMs)) {
    return { ok: false, reason: "Timestamp ist keine Unix-ms-Zahl" }
  }
  if (Math.abs(nowMs - tsMs) > CROSS_AGENT_MAX_SKEW_MS) {
    return { ok: false, reason: "Timestamp ausserhalb des 5-Minuten-Fensters" }
  }
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return { ok: false, reason: "Request-Id ist keine UUID" }
  }

  const canonical = buildCanonicalRequest(method, path, timestamp, requestId, rawBody)
  const expected = signCanonicalRequest(secret, canonical)
  if (!timingSafeEqualStrings(expected, signature)) {
    return { ok: false, reason: "Signatur ungueltig" }
  }
  return { ok: true, requestId }
}
