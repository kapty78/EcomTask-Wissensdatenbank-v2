import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  try {
    const { content, chunkId } = await request.json()

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content ist erforderlich und muss ein String sein' },
        { status: 400 }
      )
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API Key nicht konfiguriert' },
        { status: 500 }
      )
    }

    // GPT-4o mini für effiziente Verkürzung verwenden
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Du bist ein Experte für Textverkürzung. Verkürze den gegebenen Text so, dass:
1. Alle wichtigen Informationen erhalten bleiben
2. Der Text auf etwa 50-70% der ursprünglichen Länge reduziert wird
3. Die Kernbotschaft und wichtige Details vollständig intakt bleiben
4. Der Text weiterhin gut lesbar und kohärent ist
5. Keine wichtigen Fakten oder Zahlen verloren gehen

Antworte NUR mit dem verkürzten Text, ohne zusätzliche Kommentare oder Erklärungen.`
        },
        {
          role: "user",
          content: `Verkürze bitte folgenden Text ohne Informationsverlust:\n\n${content}`
        }
      ],
      max_tokens: Math.min(Math.ceil(content.length * 0.8), 4000), // Maximal 80% der ursprünglichen Länge
      temperature: 0.3, // Niedrige Temperatur für konsistente Ergebnisse
    })

    const summary = completion.choices[0]?.message?.content

    if (!summary) {
      return NextResponse.json(
        { error: 'Keine Antwort von OpenAI erhalten' },
        { status: 500 }
      )
    }

    // Optionale Speicherung der Verkürzung in der Datenbank
    console.log(`Chunk ${chunkId} verkürzt von ${content.length} auf ${summary.length} Zeichen`)

    return NextResponse.json({
      summary: summary.trim(),
      originalLength: content.length,
      summaryLength: summary.length,
      compressionRatio: Math.round((1 - summary.length / content.length) * 100)
    })

  } catch (error) {
    console.error('Fehler bei Chunk-Verkürzung:', error)
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: `OpenAI Fehler: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: 'Unbekannter Fehler bei der Verkürzung' },
      { status: 500 }
    )
  }
} 