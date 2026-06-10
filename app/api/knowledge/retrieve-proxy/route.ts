import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

import { env } from '@/lib/env'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Server-seitiger Proxy fuer die Wissenssuche (WP-A5, Key-Leak-Fix).
 *
 * Vorher rief ChatInterface.tsx das Support-Backend DIREKT aus dem Browser
 * mit hardcodiertem X-API-Key auf (Key im Client-Bundle geleakt). Dieser
 * Proxy validiert die Supabase-Session (Bearer-Token-Muster wie
 * app/api/knowledge/sources/route.ts), prueft den KB-Zugriff per RLS und
 * reicht die Anfrage mit dem serverseitigen Key weiter.
 */
export async function POST(req: NextRequest) {
  try {
    // Extract auth token from request (same pattern as sources route)
    const authHeader = req.headers.get('authorization')
    const authToken = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null

    if (!authToken) {
      logger.warn('retrieve-proxy: No authentication token provided')
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Initialize Supabase client with auth token (RLS-scoped)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        },
        global: {
          headers: {
            Authorization: `Bearer ${authToken}`
          }
        }
      }
    )

    // Verify user authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      logger.warn('retrieve-proxy: Authentication failed', userError?.message)
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const kbId = typeof body?.kb_id === 'string' ? body.kb_id : null
    if (!body || !kbId) {
      return NextResponse.json({ error: 'kb_id ist erforderlich' }, { status: 400 })
    }

    // Check KB access via RLS (company-wide access handled by policies)
    const { data: kbAccess, error: accessError } = await supabase
      .from('knowledge_bases')
      .select('id, company_id')
      .eq('id', kbId)
      .single()

    if (accessError || !kbAccess) {
      logger.warn('retrieve-proxy: Knowledge base not found or access denied', {
        error: accessError?.message,
        kb_id: kbId
      })
      return NextResponse.json({ error: 'Knowledge base not found or access denied' }, { status: 403 })
    }

    // Mandantensicherheit: company_id kommt AUSSCHLIESSLICH aus der per RLS
    // verifizierten KB-Zeile — nie aus dem Client-Body. KBs ohne company_id
    // werden abgelehnt statt auf Client-Angaben zurueckzufallen.
    if (!kbAccess.company_id) {
      logger.warn('retrieve-proxy: Knowledge base has no company_id, refusing', { kb_id: kbId })
      return NextResponse.json(
        { error: 'Knowledge base ist keiner Firma zugeordnet' },
        { status: 403 }
      )
    }

    const upstreamResponse = await fetch(env.KNOWLEDGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.KNOWLEDGE_API_KEY
      },
      body: JSON.stringify({
        ...body,
        company_id: kbAccess.company_id,
        kb_id: kbId
      }),
      cache: 'no-store'
    })

    const text = await upstreamResponse.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { detail: text }
    }
    return NextResponse.json(data, { status: upstreamResponse.status })
  } catch (error: any) {
    logger.error('retrieve-proxy: Unexpected error', error)
    return NextResponse.json(
      { error: `Retrieve-Proxy Fehler: ${error.message}` },
      { status: 502 }
    )
  }
}
