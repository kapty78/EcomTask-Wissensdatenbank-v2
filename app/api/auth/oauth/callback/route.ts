import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const error_description = url.searchParams.get('error_description')

  if (error) {
    return NextResponse.redirect(
      `${url.origin}/login?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}`
    )
  }

  if (!code) {
    // Kein Code: zurück zum Login
    return NextResponse.redirect(`${url.origin}/login?error=auth_error&error_description=${encodeURIComponent('Kein Auth-Code übergeben')}`)
  }

  const supabase = createRouteHandlerClient({ cookies })
  try {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      return NextResponse.redirect(
        `${url.origin}/login?error=auth_error&error_description=${encodeURIComponent(exchangeError.message)}`
      )
    }
    return NextResponse.redirect(`${url.origin}/dashboard`)
  } catch (e: any) {
    return NextResponse.redirect(
      `${url.origin}/login?error=auth_error&error_description=${encodeURIComponent(e?.message || 'Unerwarteter Fehler')}`
    )
  }
}


