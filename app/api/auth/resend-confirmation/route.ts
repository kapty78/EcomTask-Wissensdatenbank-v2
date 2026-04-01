import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json(
        { error: 'E-Mail-Adresse ist erforderlich' },
        { status: 400 }
      )
    }

    const supabase = createRouteHandlerClient({ cookies })

    // Resend confirmation email
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
      options: {
        emailRedirectTo: `${request.nextUrl.origin}/auth/callback`
      }
    })

    if (error) {
      console.error('Error resending confirmation email:', error)
      return NextResponse.json(
        { error: 'Fehler beim Senden der Bestätigungs-E-Mail: ' + error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Bestätigungs-E-Mail wurde erneut gesendet!'
    })

  } catch (error) {
    console.error('Unexpected error in resend confirmation:', error)
    return NextResponse.json(
      { error: 'Unerwarteter Fehler beim Senden der Bestätigungs-E-Mail' },
      { status: 500 }
    )
  }
} 