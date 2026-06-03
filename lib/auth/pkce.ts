const RECOVERY_KEY = "ecomtask:pkce:recovery"

function isBrowser() {
  return typeof window !== "undefined" && typeof window.crypto !== "undefined"
}

function dec2hex(dec: number) {
  return ("0" + dec.toString(16)).slice(-2)
}

function generateRandomString(length = 56) {
  if (!isBrowser()) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    let result = ""
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  const array = new Uint8Array(length)
  window.crypto.getRandomValues(array)
  return Array.from(array, dec2hex).join("")
}

async function sha256(input: string) {
  if (!isBrowser()) {
    return input
  }
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hash = await window.crypto.subtle.digest("SHA-256", data)
  const bytes = new Uint8Array(hash)
  let binary = ""
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export async function createPkcePair() {
  const verifier = generateRandomString()
  const challenge = await sha256(verifier)
  const method = verifier === challenge ? "plain" : "s256"
  return { verifier, challenge, method }
}

type RecoveryEntry = {
  verifier: string
  createdAt: number
}

type SafeStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function storage(): SafeStorage | null {
  if (!isBrowser()) return null
  try {
    const ls = window.localStorage
    // test write access
    const testKey = "__pkce_test__"
    ls.setItem(testKey, "1")
    ls.removeItem(testKey)
    return ls
  } catch {
    return null
  }
}

const RECOVERY_VERIFIER_KEY = "supabase-recovery-verifier"

export function storeRecoveryVerifier(verifier: string) {
  try {
    localStorage.setItem(RECOVERY_VERIFIER_KEY, JSON.stringify({ verifier, ts: Date.now() }))
  } catch (e) {
    // ignore
  }
}

export function readRecoveryVerifier(): { verifier: string; ts: number } | null {
  try {
    const data = localStorage.getItem(RECOVERY_VERIFIER_KEY)
    if (!data) return null

    const parsed = JSON.parse(data)
    if (typeof parsed?.verifier !== "string" || typeof parsed?.ts !== "number") {
      localStorage.removeItem(RECOVERY_VERIFIER_KEY)
      return null
    }

    const age = Date.now() - parsed.ts
    if (age > RECOVERY_MAX_AGE_MS) {
      localStorage.removeItem(RECOVERY_VERIFIER_KEY)
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function clearRecoveryVerifier() {
  try {
    localStorage.removeItem(RECOVERY_VERIFIER_KEY)
  } catch (e) {
    // ignore
  }
}
