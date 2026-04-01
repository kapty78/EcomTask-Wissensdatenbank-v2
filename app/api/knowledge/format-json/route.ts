import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function POST(req: NextRequest) {
  try {
    const { content, chunkId } = await req.json()

    if (!content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      )
    }

    console.log(`[JSON Format] Converting chunk ${chunkId} to JSON format`)

    // Erstelle einen JSON-Formatierungs-Prompt
    const prompt = `Du bist ein Experte für Datenstrukturierung. Konvertiere den folgenden Text in ein strukturiertes JSON-Format.

Anforderungen:
1. Extrahiere alle wichtigen Informationen aus dem Text
2. Strukturiere diese in logische Kategorien
3. Verwende deutsche Feldnamen
4. Erstelle eine klare, hierarchische JSON-Struktur
5. Behalte alle wichtigen Details bei
6. Füge Metadaten hinzu wenn sinnvoll

Eingabetext:
"""
${content}
"""

Ausgabe nur das JSON-Objekt ohne weitere Erklärungen. Das JSON sollte valide und gut strukturiert sein.`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Du bist ein Experte für Datenstrukturierung und JSON-Formatierung. Antworte nur mit validem JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 16000
    })

    const rawJson = completion.choices[0]?.message?.content?.trim()
    
    if (!rawJson) {
      throw new Error('Keine Antwort von OpenAI erhalten')
    }

    // Versuche das JSON zu parsen und zu formatieren
    let formattedJson: string
    try {
      const parsedJson = JSON.parse(rawJson)
      formattedJson = JSON.stringify(parsedJson, null, 2)
    } catch (parseError) {
      // Falls JSON nicht valide ist, versuche es zu bereinigen
      console.warn('JSON parsing failed, trying to clean:', parseError)
      const cleanedJson = rawJson
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim()
      
      try {
        const parsedJson = JSON.parse(cleanedJson)
        formattedJson = JSON.stringify(parsedJson, null, 2)
      } catch (secondParseError) {
        // Als Fallback: den ursprünglichen Text in eine einfache JSON-Struktur einbetten
        const fallbackJson = {
          "typ": "dokument_abschnitt",
          "inhalt": content,
          "metadaten": {
            "erstellt_am": new Date().toISOString(),
            "quelle": "manuell_konvertiert",
            "format": "json_fallback"
          },
          "notizen": "Automatische JSON-Konvertierung fehlgeschlagen, Fallback-Struktur verwendet"
        }
        formattedJson = JSON.stringify(fallbackJson, null, 2)
      }
    }

    // Berechne Statistiken
    const originalLength = content.length
    const jsonLength = formattedJson.length
    const compressionRatio = Math.round((1 - jsonLength / originalLength) * 100)

    console.log(`[JSON Format] Conversion completed: ${originalLength} → ${jsonLength} chars (${compressionRatio}% ${compressionRatio > 0 ? 'komprimiert' : 'erweitert'})`)

    return NextResponse.json({
      success: true,
      formattedJson,
      originalLength,
      jsonLength,
      compressionRatio,
      message: `Text erfolgreich in JSON-Format konvertiert (${compressionRatio}% ${compressionRatio > 0 ? 'komprimiert' : 'erweitert'})`
    })

  } catch (error: any) {
    console.error('[JSON Format] Error:', error)
    
    return NextResponse.json(
      { 
        error: `JSON-Formatierung fehlgeschlagen: ${error.message}`,
        success: false 
      },
      { status: 500 }
    )
  }
}
