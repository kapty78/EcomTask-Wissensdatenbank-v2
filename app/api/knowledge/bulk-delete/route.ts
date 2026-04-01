import { createClient } from '@supabase/supabase-js'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(request: NextRequest) {
  try {
    // Auth check
    const cookieStore = cookies()
    const authClient = createRouteHandlerClient({ cookies: () => cookieStore })
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { itemIds } = await request.json()

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'Keine gültigen Item-IDs bereitgestellt' },
        { status: 400 }
      )
    }

    // Supabase Client mit Service Key für Admin-Operationen
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    console.log('🗑️ Bulk-Delete gestartet für:', itemIds.length, 'Items')

    // Knowledge Items löschen (mit Kaskadierung)
    const { error: deleteError } = await supabase
      .from('knowledge_items')
      .delete()
      .in('id', itemIds)

    if (deleteError) {
      console.error('❌ Fehler beim Bulk-Delete:', deleteError)
      return NextResponse.json(
        { error: 'Fehler beim Löschen der Wissenseinträge', details: deleteError.message },
        { status: 500 }
      )
    }

    console.log('✅ Bulk-Delete erfolgreich:', itemIds.length, 'Items gelöscht')

    return NextResponse.json({ 
      success: true, 
      deletedCount: itemIds.length,
      message: `${itemIds.length} Wissenseinträge erfolgreich gelöscht`
    })

  } catch (error) {
    console.error('💥 Unerwarteter Fehler beim Bulk-Delete:', error)
    return NextResponse.json(
      { 
        error: 'Interner Server-Fehler',
        details: error instanceof Error ? error.message : 'Unbekannter Fehler'
      },
      { status: 500 }
    )
  }
}
