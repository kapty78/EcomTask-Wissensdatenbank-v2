import { NextRequest, NextResponse } from 'next/server'

import { env } from '@/lib/env'
import { getRouteAuth } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PIPELINE_BASE_URL = env.WISSENSBASIS_PIPELINE_URL.replace(/\/+$/, '')
const PIPELINE_API_KEY = env.WISSENSBASIS_API_KEY

async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  // Bearer im Embedded-Modus, sonst Cookies
  const auth = await getRouteAuth(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const authError = await requireAuth(req)
    if (authError) return authError

    const body = await req.json().catch(() => null)
    const fileUrls = body?.file_urls

    if (!Array.isArray(fileUrls) || fileUrls.length === 0) {
      return NextResponse.json(
        { error: 'file_urls (Liste von URLs) erforderlich' },
        { status: 400 }
      )
    }

    const upstreamResponse = await fetch(`${PIPELINE_BASE_URL}/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': PIPELINE_API_KEY
      },
      body: JSON.stringify({ file_urls: fileUrls })
    })

    const contentType = upstreamResponse.headers.get('content-type') || 'application/json'
    const payload = await upstreamResponse.text()

    return new NextResponse(payload, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: `Pipeline-Proxy Fehler: ${error.message}` },
      { status: 502 }
    )
  }
}
