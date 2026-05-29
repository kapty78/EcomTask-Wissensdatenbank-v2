import { NextRequest, NextResponse } from "next/server"
import { resolveSkillsAuth, forwardToSkillsApi } from "@/lib/skills-proxy"

// GET /api/skills — Skills der Firma (optional gefiltert nach Datenbank).
//   ?knowledge_base_id=<uuid>  → nur Skills dieser Datenbank
//   ?only_general=true         → nur firmenweite Skills
export async function GET(request: NextRequest) {
  const auth = await resolveSkillsAuth()
  if (auth instanceof NextResponse) return auth
  const sp = request.nextUrl.searchParams
  return forwardToSkillsApi({
    auth,
    method: "GET",
    path: "/api/skills",
    query: {
      knowledge_base_id: sp.get("knowledge_base_id"),
      only_general: sp.get("only_general"),
      limit: sp.get("limit"),
      cursor: sp.get("cursor"),
    },
  })
}

// POST /api/skills — Skill anlegen (Body inkl. optional knowledge_base_id).
export async function POST(request: NextRequest) {
  const auth = await resolveSkillsAuth()
  if (auth instanceof NextResponse) return auth
  const body = await request.json().catch(() => ({}))
  return forwardToSkillsApi({
    auth,
    method: "POST",
    path: "/api/skills",
    body,
    includeUserId: true,
  })
}
