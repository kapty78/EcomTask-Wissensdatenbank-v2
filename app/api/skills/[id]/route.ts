import { NextRequest, NextResponse } from "next/server"
import { resolveSkillsAuth, forwardToSkillsApi } from "@/lib/skills-proxy"

// GET /api/skills/:id — einzelne Skill inkl. Body
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveSkillsAuth(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  return forwardToSkillsApi({ auth, method: "GET", path: `/api/skills/${id}` })
}

// PATCH /api/skills/:id — Skill bearbeiten (Versions-Snapshot serverseitig)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveSkillsAuth(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  return forwardToSkillsApi({
    auth,
    method: "PATCH",
    path: `/api/skills/${id}`,
    body,
    includeUserId: true,
  })
}

// DELETE /api/skills/:id
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveSkillsAuth(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const force = request.nextUrl.searchParams.get("force")
  return forwardToSkillsApi({
    auth,
    method: "DELETE",
    path: `/api/skills/${id}`,
    query: { force },
  })
}
