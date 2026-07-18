import { NextRequest, NextResponse } from "next/server"
import { resolveSkillsAuth, forwardToSkillsApi } from "@/lib/skills-proxy"

// GET /api/standard-answers — Standardantworten der Firma (optional gefiltert
// nach Datenbank). Dünner Proxy auf den Support-Backend-Alias-Router
// (/api/standard-answers, kind wird dort serverseitig erzwungen).
//   ?knowledge_base_id=<uuid>  → nur Standardantworten dieser Datenbank
//   ?only_general=true         → nur firmenweite Standardantworten
export async function GET(request: NextRequest) {
  const auth = await resolveSkillsAuth(request)
  if (auth instanceof NextResponse) return auth
  const sp = request.nextUrl.searchParams
  return forwardToSkillsApi({
    auth,
    method: "GET",
    path: "/api/standard-answers",
    query: {
      knowledge_base_id: sp.get("knowledge_base_id"),
      only_general: sp.get("only_general"),
      limit: sp.get("limit"),
      cursor: sp.get("cursor"),
    },
  })
}

// POST /api/standard-answers — Standardantwort anlegen
// (Body inkl. optional knowledge_base_id + answer_mode).
export async function POST(request: NextRequest) {
  const auth = await resolveSkillsAuth(request)
  if (auth instanceof NextResponse) return auth
  const body = await request.json().catch(() => ({}))
  return forwardToSkillsApi({
    auth,
    method: "POST",
    path: "/api/standard-answers",
    body,
    includeUserId: true,
  })
}
