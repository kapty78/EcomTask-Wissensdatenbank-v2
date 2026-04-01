import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function POST(req: NextRequest) {
  try {
    const { textBeforeCursor } = await req.json()

    if (!textBeforeCursor || textBeforeCursor.trim().length < 5) {
      return NextResponse.json({ suggestion: '' })
    }

    // Only send last ~1500 chars for context
    const contextText = textBeforeCursor.slice(-1500)
    const lastChar = textBeforeCursor[textBeforeCursor.length - 1] || ''
    const endsWithSpace = /\s$/.test(lastChar)

    // Extract the last word/partial word for dedup
    const lastWordMatch = textBeforeCursor.match(/(\S+)\s*$/)
    const lastWord = lastWordMatch ? lastWordMatch[1] : ''

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.4-nano',
      messages: [
        {
          role: 'system',
          content: `Du bist ein Schreibassistent. Setze den Text des Benutzers fort.

REGELN:
- Gib NUR die Fortsetzung aus. Keine Erklärungen, keine Anführungszeichen.
- Dein Output wird DIREKT an den bestehenden Text angehängt.
- WIEDERHOLE NIEMALS Wörter, die der Benutzer bereits geschrieben hat. Der Text endet mit "${lastWord}" — wiederhole dieses Wort NICHT.
- ${endsWithSpace ? 'Der Text endet mit Leerzeichen. Beginne direkt mit dem nächsten Wort.' : 'Der Text endet OHNE Leerzeichen. Beginne mit einem Leerzeichen, es sei denn du vervollständigst ein angefangenes Wort.'}
- Maximal 1 Satz.
- Gleicher Stil wie der bestehende Text.`
        },
        {
          role: 'user',
          content: contextText
        }
      ],
      max_completion_tokens: 80,
      temperature: 0.3,
    })

    let suggestion = completion.choices[0]?.message?.content || ''

    if (!suggestion || !textBeforeCursor) {
      return NextResponse.json({ suggestion: '' })
    }

    // --- Post-processing: fix spacing and dedup ---

    const lastCharOfText = textBeforeCursor[textBeforeCursor.length - 1]
    const firstCharOfSuggestion = suggestion[0]

    // 1. Fix missing space between words
    if (lastCharOfText && firstCharOfSuggestion &&
        /\w/.test(lastCharOfText) && /\w/.test(firstCharOfSuggestion)) {
      suggestion = ' ' + suggestion
    }

    // 2. Fix duplicate space
    if (/\s$/.test(lastCharOfText) && /^\s/.test(firstCharOfSuggestion)) {
      suggestion = suggestion.trimStart()
    }

    // 3. Remove duplicate word at start of suggestion
    // e.g. text ends with "Wir" and suggestion starts with " Wir nehmen" → " nehmen"
    if (lastWord) {
      const trimmed = suggestion.trimStart()
      // Check if suggestion starts with the last word (case-insensitive)
      const lastWordLower = lastWord.toLowerCase()
      const suggestionStartLower = trimmed.slice(0, lastWord.length).toLowerCase()

      if (lastWordLower === suggestionStartLower) {
        // Remove the duplicated word
        const afterDup = trimmed.slice(lastWord.length)
        // Keep the leading space if the original suggestion had one
        suggestion = suggestion.startsWith(' ') && !afterDup.startsWith(' ')
          ? ' ' + afterDup.trimStart()
          : afterDup
      }

      // Also check for partial overlap at the boundary
      // e.g. text ends with "Wir " and suggestion is "Wir nehmen"
      if (endsWithSpace) {
        const wordAtStart = trimmed.match(/^(\S+)/)?.[1]
        if (wordAtStart && wordAtStart.toLowerCase() === lastWordLower) {
          suggestion = trimmed.slice(wordAtStart.length)
        }
      }
    }

    // Final cleanup: ensure no empty/whitespace-only suggestion
    if (!suggestion.trim()) {
      return NextResponse.json({ suggestion: '' })
    }

    return NextResponse.json({ suggestion })
  } catch (error) {
    console.error('[Autocomplete] Error:', error)
    return NextResponse.json({ suggestion: '' })
  }
}
