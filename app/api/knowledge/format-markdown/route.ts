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

    console.log(`[Markdown Format] Converting chunk ${chunkId} to Markdown format`)

    // Neuer Prompt: keine "Markdown-Produktion" mit Metadaten, sondern klar strukturierter Fließtext
    const prompt = `Deine Aufgabe ist es, den folgenden Text so aufzubereiten, dass alle Informationen vollständig erhalten bleiben und gleichzeitig klar, knapp und gut lesbar strukturiert sind.

Richtlinien:
- Gliedere sinnvoll mit Überschriften und Abschnitten.
- Nutze Aufzählungen nur dort, wo sie die Lesbarkeit wirklich verbessern.
- Verwende einfache Hervorhebungen sparsam (fett/kursiv), KEINE Tabellen, KEINE Codeblöcke.
- Füge KEINE zusätzlichen Metadaten, Erklärungen oder Einleitungen hinzu.
- Entferne Redundanzen, ohne Inhalte zu verlieren.

Ausgabeformat:
"{nur der aufbereitete Text, keine Erklärung, oder Metadaten}"

Text:
"""
${content}
"""`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini-2025-04-14',
      messages: [
        {
          role: 'system',
          content: 'Du bereitest Texte zu gut lesbaren, klar strukturierten Abschnitten auf, ohne Metadaten oder Erklärungen hinzuzufügen. Keine Tabellen, keine Codeblöcke, keine JSON-Ausgaben. Antworte ausschließlich mit dem aufbereiteten Text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 16000
    })

    let formattedMarkdown = completion.choices[0]?.message?.content?.trim()
    
    if (!formattedMarkdown) {
      throw new Error('Keine Antwort von OpenAI erhalten')
    }

    // Bereinige unerwünschte Code-Blöcke und JSON-Reste
    formattedMarkdown = formattedMarkdown
      // Entferne explizite JSON-Codeblöcke vollständig
      .replace(/```json[\s\S]*?```/gi, '')
      // Entferne generische Dreifach-Backticks (öffnend/schließend)
      .replace(/```markdown\n/gi, '')
      .replace(/```[a-zA-Z]*\n/gi, '')
      .replace(/```/g, '')
      .trim()

    // Falls die Formatierung fehlschlägt, erstelle eine Fallback-Struktur
    if (!formattedMarkdown || formattedMarkdown.length < 10) {
      formattedMarkdown = `# Dokument-Abschnitt

${content}

---
*Automatisch konvertiert zu Markdown*`
    }

    // Berechne Statistiken
    const originalLength = content.length
    const markdownLength = formattedMarkdown.length
    const expansionRatio = Math.round((markdownLength / originalLength - 1) * 100)

    console.log(`[Markdown Format] Conversion completed: ${originalLength} → ${markdownLength} chars (${expansionRatio}% ${expansionRatio > 0 ? 'erweitert' : 'komprimiert'})`)

    return NextResponse.json({
      success: true,
      formattedMarkdown,
      originalLength,
      markdownLength,
      expansionRatio,
      message: `Text erfolgreich in Markdown-Format konvertiert (${expansionRatio}% ${expansionRatio > 0 ? 'erweitert' : 'komprimiert'})`
    })

  } catch (error: any) {
    console.error('[Markdown Format] Error:', error)
    
    return NextResponse.json(
      { 
        error: `Markdown-Formatierung fehlgeschlagen: ${error.message}`,
        success: false 
      },
      { status: 500 }
    )
  }
}
