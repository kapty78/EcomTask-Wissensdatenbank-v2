import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, email, companyId, companyName, fullName } = body

    // Validate required fields
    if (!userId || !email) {
      return NextResponse.json({ 
        error: 'userId and email are required' 
      }, { status: 400 })
    }

    console.log('create-profile-direct called with:', {
      userId,
      email,
      companyId,
      companyName,
      fullName
    })

    // Use Service Role to directly create profile (bypasses RLS)
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Create profile directly with service role
    const { error } = await admin
      .from('profiles')
      .upsert({
        id: userId,
        email: email,
        full_name: fullName,
        company_id: companyId,
        company_name: companyName,
        can_upload: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    if (error) {
      console.error('create-profile-direct: Database error:', error)
      return NextResponse.json({ 
        error: `Database error: ${error.message}` 
      }, { status: 500 })
    }

    console.log('create-profile-direct: Success for user:', email)
    return NextResponse.json({ 
      success: true,
      message: 'Profile created successfully'
    })

  } catch (e: any) {
    console.error('create-profile-direct: Unexpected error:', e)
    return NextResponse.json({ 
      error: `Unexpected error: ${e?.message || 'Failed to create profile'}` 
    }, { status: 500 })
  }
}
