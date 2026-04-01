import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { keepItemId, removeItemIds } = await request.json()

    if (!keepItemId || !removeItemIds || !Array.isArray(removeItemIds)) {
      return NextResponse.json(
        { error: 'Keep Item ID und Remove Item IDs sind erforderlich' },
        { status: 400 }
      )
    }

    const supabase = createRouteHandlerClient({ cookies })

    // Verify user has permission to modify these items
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Authentifizierung erforderlich' },
        { status: 401 }
      )
    }

    // Get the knowledge base ID from the kept item to verify access
    const { data: keepItem, error: keepItemError } = await supabase
      .from('knowledge_items')
      .select('knowledge_base_id')
      .eq('id', keepItemId)
      .single()

    if (keepItemError || !keepItem) {
      return NextResponse.json(
        { error: 'Zu behaltender Eintrag nicht gefunden' },
        { status: 404 }
      )
    }

    // Verify user has access to this knowledge base
    const { data: knowledgeBase, error: kbError } = await supabase
      .from('knowledge_bases')
      .select('user_id')
      .eq('id', keepItem.knowledge_base_id)
      .single()

    if (kbError || !knowledgeBase || knowledgeBase.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Keine Berechtigung für diese Wissensdatenbank' },
        { status: 403 }
      )
    }

    // Start transaction by deleting the conflicting items
    const { error: deleteError } = await supabase
      .from('knowledge_items')
      .delete()
      .in('id', removeItemIds)

    if (deleteError) {
      console.error('Error deleting conflicting items:', deleteError)
      return NextResponse.json(
        { error: 'Fehler beim Löschen der widersprüchlichen Einträge' },
        { status: 500 }
      )
    }

    // Log the conflict resolution for audit purposes (skip if table doesn't exist)
    try {
      // Check if table exists first
      const { error: checkTableError } = await supabase
        .from('conflict_resolutions')
        .select('id')
        .limit(1)

      if (!checkTableError) {
        const { error: logError } = await supabase
          .from('conflict_resolutions')
          .insert({
            knowledge_base_id: keepItem.knowledge_base_id,
            kept_item_id: keepItemId,
            removed_item_ids: removeItemIds,
            resolved_by: user.id,
            resolved_at: new Date().toISOString()
          })

        if (logError) {
          console.warn('Failed to log conflict resolution:', logError)
        }
      } else {
        console.log('Conflict resolutions table does not exist, skipping logging')
      }
    } catch (err) {
      // Table might not exist, that's okay
      console.warn('Could not log conflict resolution (table might not exist):', err)
    }

    return NextResponse.json({
      success: true,
      message: `Konflikt aufgelöst: 1 Eintrag behalten, ${removeItemIds.length} Einträge entfernt`,
      keptItemId: keepItemId,
      removedItemIds: removeItemIds
    })

  } catch (error) {
    console.error('Error in resolve-conflict:', error)
    return NextResponse.json(
      { error: 'Unerwarteter Fehler beim Auflösen des Konflikts' },
      { status: 500 }
    )
  }
} 