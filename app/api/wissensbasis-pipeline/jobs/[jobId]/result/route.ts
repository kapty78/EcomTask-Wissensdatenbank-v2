import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getPipelineBaseUrl(): string {
  const raw =
    process.env.WISSENSBASIS_PIPELINE_URL ||
    process.env.NEXT_PUBLIC_WISSENSBASIS_PIPELINE_URL ||
    'https://wissensbasis-pipeline.onrender.com'
  return raw.replace(/\/+$/, '')
}

function getPipelineApiKey(): string {
  return process.env.WISSENSBASIS_API_KEY || process.env.NEXT_PUBLIC_WISSENSBASIS_API_KEY || ''
}

async function requireAuth(): Promise<NextResponse | null> {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const authError = await requireAuth()
    if (authError) return authError

    const apiKey = getPipelineApiKey()
    if (!apiKey) {
      return NextResponse.json(
        { error: 'WISSENSBASIS_API_KEY ist nicht gesetzt' },
        { status: 500 }
      )
    }

    const jobId = encodeURIComponent(params.jobId)
    const upstreamResponse = await fetch(`${getPipelineBaseUrl()}/v1/jobs/${jobId}/result`, {
      headers: {
        'X-API-Key': apiKey
      }
    })

    if (!upstreamResponse.ok) {
      const contentType = upstreamResponse.headers.get('content-type') || 'application/json'
      const payload = await upstreamResponse.text()
      return new NextResponse(payload, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store'
        }
      })
    }

    const pdfData = await upstreamResponse.arrayBuffer()

    return new NextResponse(pdfData, {
      status: 200,
      headers: {
        'Content-Type': upstreamResponse.headers.get('content-type') || 'application/pdf',
        'Content-Disposition':
          upstreamResponse.headers.get('content-disposition') ||
          'attachment; filename="Wissenstext.pdf"',
        'Cache-Control': 'no-store'
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: `Pipeline-Result Proxy Fehler: ${error.message}` },
      { status: 502 }
    )
  }
}
