import { createHmac, timingSafeEqual } from "crypto"

// Bindet eine frisch angelegte Firma kryptografisch an den Registrierungs-Flow:
// Nur wer die Firma über /api/register-company angelegt hat, besitzt den Token
// und kann über /api/register-admin den ersten Admin eintragen — ganz ohne
// Session (nach signUp mit E-Mail-Bestätigung existiert noch keine).
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function sign(payload: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY ist nicht konfiguriert")
  return createHmac("sha256", `register-token-v1:${secret}`).update(payload).digest("hex")
}

export function createRegisterToken(companyId: string): string {
  const exp = Date.now() + TOKEN_TTL_MS
  return `${exp}.${sign(`${companyId}.${exp}`)}`
}

export function verifyRegisterToken(companyId: string, token: unknown): boolean {
  if (typeof token !== "string" || !companyId) return false
  const [expStr, signature] = token.split(".")
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || !signature || Date.now() > exp) return false
  const expected = sign(`${companyId}.${exp}`)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
