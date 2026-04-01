import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    let userId: string | undefined
    let userEmail: string | undefined
    let userMetadata: Record<string, any> = {}

    // Try Bearer token auth first (for embedded iframe context where cookies don't work)
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const supabaseWithToken = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      const { data: { user }, error } = await supabaseWithToken.auth.getUser(token)
      if (!error && user) {
        userId = user.id
        userEmail = user.email
        userMetadata = user.user_metadata || {}
      }
    }

    // Fallback to cookie-based auth
    if (!userId) {
      const cookieStore = cookies()
      const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError || !user) {
        return NextResponse.json(
          { error: 'Not authenticated' },
          { status: 401 }
        )
      }
      userId = user.id
      userEmail = user.email
      userMetadata = user.user_metadata || {}
    }

    const body = await request.json().catch(() => ({}))
    const { companyId, companyName, fullName } = body

    // Use Service Role to upsert profile (bypasses RLS)
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Check if profile already exists
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, company_id')
      .eq('id', userId)
      .single()

    if (existingProfile) {
      // Profile already exists - update only missing fields
      const updates: Record<string, string> = {}
      if (!existingProfile.company_id && companyId) {
        updates.company_id = companyId
      }
      if (fullName) {
        updates.full_name = fullName
      }
      if (companyName) {
        updates.company_name = companyName
      }

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString()
        await admin
          .from('profiles')
          .update(updates)
          .eq('id', userId)
      }

      return NextResponse.json({ success: true, message: 'Profile already exists' })
    }

    // Create new profile
    const { error: insertError } = await admin
      .from('profiles')
      .insert({
        id: userId,
        email: userEmail,
        full_name: fullName || userMetadata?.full_name || null,
        company_id: companyId || userMetadata?.company_id || null,
        company_name: companyName || userMetadata?.company_name || null,
        can_upload: true,
        updated_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error('ensure-profile: Insert error:', insertError)
      if (insertError.code === '23505') {
        return NextResponse.json({ success: true, message: 'Profile already exists (concurrent creation)' })
      }
      return NextResponse.json(
        { error: `Database error: ${insertError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: 'Profile created' })
  } catch (e: any) {
    console.error('ensure-profile: Unexpected error:', e)
    return NextResponse.json(
      { error: `Unexpected error: ${e?.message || 'Unknown'}` },
      { status: 500 }
    )
  }
}
