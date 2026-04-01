import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Team-Management API
 * Ermöglicht Admins das Erstellen neuer Team-Mitglieder
 */

// Service Role Client für Admin-Operationen
const getServiceClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET: Liste aller Team-Mitglieder der Company
 */
export async function GET(request: NextRequest) {
  try {
    // Auth-Header extrahieren
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json(
        { error: 'Keine Authentifizierung' },
        { status: 401 }
      )
    }

    // User Client für Auth
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    )

    const { data: { user }, error: userError } = await userClient.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Ungültige Authentifizierung' },
        { status: 401 }
      )
    }

    // Hole Benutzer-Profil mit company_id
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.company_id) {
      return NextResponse.json(
        { error: 'Kein Unternehmen gefunden' },
        { status: 404 }
      )
    }

    // Prüfe ob Benutzer Admin ist
    const { data: adminData, error: adminError } = await userClient
      .from('company_admins')
      .select('*')
      .eq('user_id', user.id)
      .eq('company_id', profile.company_id)
      .single()

    if (adminError || !adminData) {
      return NextResponse.json(
        { error: 'Keine Berechtigung. Nur Administratoren können Team-Mitglieder verwalten.' },
        { status: 403 }
      )
    }

    // Lade alle Team-Mitglieder der Company
    const { data: teamMembers, error: teamError } = await userClient
      .from('profiles')
      .select('id, email, full_name, role, created_at, updated_at')
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })

    if (teamError) {
      return NextResponse.json(
        { error: `Fehler beim Laden der Team-Mitglieder: ${teamError.message}` },
        { status: 500 }
      )
    }

    // Markiere Admins
    const { data: admins } = await userClient
      .from('company_admins')
      .select('user_id')
      .eq('company_id', profile.company_id)

    const adminIds = new Set(admins?.map(a => a.user_id) || [])

    const membersWithRole = teamMembers?.map(member => ({
      ...member,
      is_admin: adminIds.has(member.id)
    }))

    return NextResponse.json({
      success: true,
      members: membersWithRole
    })

  } catch (error: any) {
    console.error('Team-Management GET Error:', error)
    return NextResponse.json(
      { error: `Unerwarteter Fehler: ${error.message}` },
      { status: 500 }
    )
  }
}

/**
 * POST: Erstelle neues Team-Mitglied
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, full_name } = body

    // Validierung
    if (!email || !password || !full_name) {
      return NextResponse.json(
        { error: 'E-Mail, Passwort und vollständiger Name sind erforderlich' },
        { status: 400 }
      )
    }

    // Email-Format validieren
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Ungültige E-Mail-Adresse' },
        { status: 400 }
      )
    }

    // Passwort-Validierung (mindestens 8 Zeichen)
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Passwort muss mindestens 8 Zeichen lang sein' },
        { status: 400 }
      )
    }

    // Auth-Header extrahieren
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json(
        { error: 'Keine Authentifizierung' },
        { status: 401 }
      )
    }

    // User Client für Auth
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    )

    const { data: { user }, error: userError } = await userClient.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Ungültige Authentifizierung' },
        { status: 401 }
      )
    }

    // Hole Admin-Profil mit company_id
    const { data: adminProfile, error: adminProfileError } = await userClient
      .from('profiles')
      .select('company_id, email')
      .eq('id', user.id)
      .single()

    if (adminProfileError || !adminProfile?.company_id) {
      return NextResponse.json(
        { error: 'Kein Unternehmen gefunden' },
        { status: 404 }
      )
    }

    // Prüfe ob Benutzer Admin ist
    const { data: adminData, error: adminError } = await userClient
      .from('company_admins')
      .select('*')
      .eq('user_id', user.id)
      .eq('company_id', adminProfile.company_id)
      .single()

    if (adminError || !adminData) {
      return NextResponse.json(
        { error: 'Keine Berechtigung. Nur Administratoren können Team-Mitglieder erstellen.' },
        { status: 403 }
      )
    }

    // Domain-Validierung: Neue E-Mail muss dieselbe Domain haben wie Admin
    const adminDomain = adminProfile.email?.split('@')[1]
    const newUserDomain = email.split('@')[1]

    if (adminDomain !== newUserDomain) {
      return NextResponse.json(
        { error: `E-Mail-Domain muss ${adminDomain} sein` },
        { status: 400 }
      )
    }

    // Hole Company-Informationen
    const { data: company, error: companyError } = await userClient
      .from('companies')
      .select('id, name, domain')
      .eq('id', adminProfile.company_id)
      .single()

    if (companyError || !company) {
      return NextResponse.json(
        { error: 'Unternehmen nicht gefunden' },
        { status: 404 }
      )
    }

    // Service Client für User-Erstellung
    const serviceClient = getServiceClient()

    // 1. Erstelle Auth-User
    const { data: newUser, error: createUserError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-bestätigt (oder setze auf false für E-Mail-Bestätigung)
      user_metadata: {
        full_name,
        company_id: company.id,
        company_name: company.name
      }
    })

    if (createUserError) {
      console.error('Fehler beim Erstellen des Users:', createUserError)
      return NextResponse.json(
        { error: `Fehler beim Erstellen des Benutzers: ${createUserError.message}` },
        { status: 500 }
      )
    }

    if (!newUser.user) {
      return NextResponse.json(
        { error: 'Benutzer wurde nicht erstellt' },
        { status: 500 }
      )
    }

    // 2. Erstelle oder aktualisiere Profil mit Service Client
    const { error: profileError } = await serviceClient
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        email,
        full_name,
        company_id: company.id,
        company_name: company.name,
        role: 'User', // Normale Benutzer sind keine Admins
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' })

    if (profileError) {
      console.error('Fehler beim Erstellen des Profils:', profileError)
      
      // Versuche User zu löschen wenn Profil-Erstellung fehlschlägt
      await serviceClient.auth.admin.deleteUser(newUser.user.id)
      
      return NextResponse.json(
        { error: `Fehler beim Erstellen des Profils: ${profileError.message}` },
        { status: 500 }
      )
    }

    // Optional: Sende Bestätigungs-E-Mail
    // await serviceClient.auth.admin.generateLink({
    //   type: 'signup',
    //   email,
    // })

    return NextResponse.json({
      success: true,
      message: 'Team-Mitglied erfolgreich erstellt',
      user: {
        id: newUser.user.id,
        email,
        full_name,
        company_id: company.id
      }
    })

  } catch (error: any) {
    console.error('Team-Management POST Error:', error)
    return NextResponse.json(
      { error: `Unerwarteter Fehler: ${error.message}` },
      { status: 500 }
    )
  }
}

/**
 * DELETE: Lösche Team-Mitglied (nur für Admins)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userIdToDelete = searchParams.get('userId')

    if (!userIdToDelete) {
      return NextResponse.json(
        { error: 'Benutzer-ID erforderlich' },
        { status: 400 }
      )
    }

    // Auth-Header extrahieren
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json(
        { error: 'Keine Authentifizierung' },
        { status: 401 }
      )
    }

    // User Client für Auth
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    )

    const { data: { user }, error: userError } = await userClient.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Ungültige Authentifizierung' },
        { status: 401 }
      )
    }

    // Verhindere Selbst-Löschung
    if (user.id === userIdToDelete) {
      return NextResponse.json(
        { error: 'Sie können sich nicht selbst löschen' },
        { status: 400 }
      )
    }

    // Hole Admin-Profil
    const { data: adminProfile, error: adminProfileError } = await userClient
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (adminProfileError || !adminProfile?.company_id) {
      return NextResponse.json(
        { error: 'Kein Unternehmen gefunden' },
        { status: 404 }
      )
    }

    // Prüfe ob Benutzer Admin ist
    const { data: adminData, error: adminError } = await userClient
      .from('company_admins')
      .select('*')
      .eq('user_id', user.id)
      .eq('company_id', adminProfile.company_id)
      .single()

    if (adminError || !adminData) {
      return NextResponse.json(
        { error: 'Keine Berechtigung. Nur Administratoren können Team-Mitglieder löschen.' },
        { status: 403 }
      )
    }

    // Prüfe ob zu löschender Benutzer zur selben Company gehört
    const { data: targetProfile, error: targetProfileError } = await userClient
      .from('profiles')
      .select('company_id')
      .eq('id', userIdToDelete)
      .single()

    if (targetProfileError || !targetProfile) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden' },
        { status: 404 }
      )
    }

    if (targetProfile.company_id !== adminProfile.company_id) {
      return NextResponse.json(
        { error: 'Benutzer gehört nicht zu Ihrem Unternehmen' },
        { status: 403 }
      )
    }

    // Service Client für Löschung
    const serviceClient = getServiceClient()

    // Lösche User aus Auth
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(userIdToDelete)

    if (deleteError) {
      return NextResponse.json(
        { error: `Fehler beim Löschen: ${deleteError.message}` },
        { status: 500 }
      )
    }

    // Profil wird automatisch durch CASCADE gelöscht

    return NextResponse.json({
      success: true,
      message: 'Team-Mitglied erfolgreich gelöscht'
    })

  } catch (error: any) {
    console.error('Team-Management DELETE Error:', error)
    return NextResponse.json(
      { error: `Unerwarteter Fehler: ${error.message}` },
      { status: 500 }
    )
  }
}




