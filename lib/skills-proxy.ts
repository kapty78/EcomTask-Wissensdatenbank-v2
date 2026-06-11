/**
 * Thin proxy from the Wissensdatenbank UI to the Support-Backend Skills API.
 *
 * The Support-Backend (app/routers/skills.py) is the single source of truth for
 * skill CRUD. These Next.js routes only resolve the logged-in user's company via
 * Supabase SSR and forward with company_id + user_id and the shared X-API-Key.
 * Never reimplement skill validation here.
 */
import { NextResponse } from "next/server"

import { env } from "@/lib/env"
import { getRouteAuth } from "@/lib/route-auth"

const SUPPORT_BACKEND_URL = env.SUPPORT_BACKEND_URL
const SUPPORT_BACKEND_API_KEY = env.SUPPORT_BACKEND_API_KEY

export interface SkillsAuth {
  userId: string
  companyId: string
}

export async function resolveSkillsAuth(request: Request): Promise<SkillsAuth | NextResponse> {
  // Bearer im Embedded-Modus, sonst Cookies
  const auth = await getRouteAuth(request)
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  const { user, supabase: authClient } = auth
  const { data: profile } = await authClient
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle()
  const companyId = (profile as { company_id?: string } | null)?.company_id
  if (!companyId) {
    return NextResponse.json({ error: "Keine Firma im Profil." }, { status: 400 })
  }
  return { userId: user.id, companyId }
}

export async function forwardToSkillsApi(opts: {
  auth: SkillsAuth
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
  query?: Record<string, string | null | undefined>
  body?: unknown
  includeUserId?: boolean
}): Promise<NextResponse> {
  const url = new URL(`${SUPPORT_BACKEND_URL}${opts.path}`)
  url.searchParams.set("company_id", opts.auth.companyId)
  if (opts.includeUserId) url.searchParams.set("user_id", opts.auth.userId)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v != null) url.searchParams.set(k, v)
  }
  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: opts.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": SUPPORT_BACKEND_API_KEY,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Skills-Backend nicht erreichbar: ${String(err)}` },
      { status: 502 },
    )
  }
  if (res.status === 204) return new NextResponse(null, { status: 204 })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { detail: text }
  }
  return NextResponse.json(data, { status: res.status })
}
