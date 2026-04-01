import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Hilfsfunktion zur Konfliktprüfung
async function checkForActualConflicts(items: any[]): Promise<boolean> {
  if (items.length < 2) return false

  // Prüfe auf widersprüchliche Werte
  const patterns = [
    /\b(\d+(?:\.\d+)?)\s*(€|euro|eur)\b/gi, // Preise
    /\b(\d{1,2}\.\d{1,2}\.\d{4})\b/g, // Datumsangaben
    /\b(\d+(?:\.\d+)?)\s*(prozent|%)\b/gi, // Prozentangaben
    /\b(ja|nein|wahr|falsch|richtig|falsch|möglich|unmöglich)\b/gi // Boolesche/absolute Werte
  ]

  for (const pattern of patterns) {
    const values = new Set<string>()
    
    for (const item of items) {
      const matches = Array.from(item.content.matchAll(pattern))
      matches.forEach(match => {
        values.add(match[1]?.toLowerCase() || match[0]?.toLowerCase())
      })
    }
    
    // Wenn verschiedene Werte für dasselbe Muster gefunden werden, ist es ein Konflikt
    if (values.size > 1) {
      return true
    }
  }

  return false
}

export async function POST(request: NextRequest) {
  try {
    const { knowledgeBaseId } = await request.json()

    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: 'Knowledge Base ID ist erforderlich' },
        { status: 400 }
      )
    }

    const supabase = createRouteHandlerClient({ cookies })

    // Verify user has permission to access this knowledge base
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Authentifizierung erforderlich' },
        { status: 401 }
      )
    }

    // Verify user has access to this knowledge base
    const { data: knowledgeBase, error: kbError } = await supabase
      .from('knowledge_bases')
      .select('user_id')
      .eq('id', knowledgeBaseId)
      .single()

    if (kbError || !knowledgeBase || knowledgeBase.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Keine Berechtigung für diese Wissensdatenbank' },
        { status: 403 }
      )
    }

    // Berechne neue Datenqualität
    // 1. Hole alle Knowledge Items für diese Knowledge Base
    const { data: knowledgeItems, error: itemsError } = await supabase
      .from('knowledge_items')
      .select('id, content')
      .eq('knowledge_base_id', knowledgeBaseId)

    if (itemsError) {
      return NextResponse.json(
        { error: 'Fehler beim Laden der Wissenselemente' },
        { status: 500 }
      )
    }

    const totalEntries = knowledgeItems?.length || 0

    // 2. Führe eine aktualisierte Konfliktanalyse durch
    // Nutze dieselbe Logik wie der MismatchFinder für konsistente Ergebnisse
    let conflictsFound = 0

    if (totalEntries > 1) {
      // Gruppiere ähnliche Inhalte für Konfliktserkennung
      const conflictGroups = new Map<string, any[]>()
      
      for (const item of knowledgeItems || []) {
        // Normalisiere den Inhalt für den Vergleich
        const normalizedContent = item.content
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim()

        // Extrahiere Schlüsselwörter für die Gruppierung
        const words = normalizedContent.split(' ').filter(word => word.length > 3)
        const keyWords = words.slice(0, 5).join(' ') // Verwende die ersten 5 Wörter als Gruppierungsschlüssel
        
        if (!conflictGroups.has(keyWords)) {
          conflictGroups.set(keyWords, [])
        }
        conflictGroups.get(keyWords)?.push(item)
      }

      // Zähle Gruppen mit mehr als einem Element als Konflikte
      for (const group of conflictGroups.values()) {
        if (group.length > 1) {
          // Prüfe auf tatsächliche Konflikte innerhalb der Gruppe
          const hasConflict = await checkForActualConflicts(group)
          if (hasConflict) {
            conflictsFound++
          }
        }
      }
    }

    // 3. Berechne Datenqualität
    const dataQuality = totalEntries > 0 
      ? Math.round(((totalEntries - conflictsFound) / totalEntries) * 100)
      : 0

    // 4. Gebe die aktualisierten Statistiken zurück
    const analysis = {
      totalEntries,
      conflictsFound,
      dataQuality,
      lastAnalysis: new Date()
    }

    return NextResponse.json({
      success: true,
      analysis
    })

  } catch (error) {
    return NextResponse.json(
      { error: 'Fehler bei der Neuberechnung der Datenqualität' },
      { status: 500 }
    )
  }
}
