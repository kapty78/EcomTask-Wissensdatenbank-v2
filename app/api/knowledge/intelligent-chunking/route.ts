import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

// OpenAI Client initialisieren
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Interface für die API-Antwort
interface AIChunk {
  title: string
  content: string
  summary: string
}

interface ChunkingResponse {
  chunks: AIChunk[]
}

// Robustes JSON-Parsing (entfernt Codeblöcke / Text vor/nach JSON)
function parseJsonLoose(content: string): any {
  if (!content) return null;
  let text = content.trim();
  // Versuche Codeblock zu extrahieren
  const fenceMatch = text.match(/```(?:json)?\n([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }
  // Try direct JSON
  try {
    return JSON.parse(text);
  } catch {}
  // Schneide auf äußerstes JSON-Objekt zu
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const sliced = text.slice(first, last + 1);
    try {
      return JSON.parse(sliced);
    } catch {}
  }
  return null;
}

// Token-Schätzung (grob: 1 Token ≈ 4 Zeichen für Deutsch)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

// Prompt für verschiedene Dokumenttypen erstellen
function buildChunkingPrompt(text: string, language: string, documentType?: string): string {
  const documentSpecificInstructions = {
    manual: "Achte besonders auf Anleitungsschritte, Verfahren und Arbeitsabläufe. Halte zusammengehörige Schritte in einem Chunk.",
    contract: "Berücksichtige juristische Abschnitte, Klauseln und Vertragsteile. Trenne logische Vertragsabschnitte sinnvoll.",
    report: "Teile nach Analysebereichen, Befunden und Schlussfolgerungen. Halte Datenanalysen zusammen.",
    email: "Trenne nach Gesprächsthemen, Entscheidungen und Aktionspunkten.",
    default: "Teile nach thematischem Zusammenhang und logischen Sinneinheiten."
  }

  const specificInstruction = documentSpecificInstructions[documentType as keyof typeof documentSpecificInstructions] 
    || documentSpecificInstructions.default

  return `Du bist ein Experte für die semantische Segmentierung von deutschen Geschäftsdokumenten.

AUFGABE: Teile den folgenden Text in logische, thematisch zusammengehörige Abschnitte auf.

WICHTIGE REGELN:
1. Behalte den Originaltext EXAKT bei - keine Umformulierungen, keine Korrekturen
2. Teile nach thematischem Zusammenhang, nicht nach Länge
3. Ein Thema/Konzept soll in EINEM Chunk bleiben
4. Zusammengehörige Anleitungen/Schritte nicht trennen
5. Chunks sollten idealerweise 500-3000 Zeichen haben, aber Sinneinheit ist wichtiger als Länge
6. ${specificInstruction}
7. Gib für jeden Chunk einen prägnanten, beschreibenden Titel an
8. Erstelle eine kurze Zusammenfassung für jeden Chunk

OUTPUT-FORMAT (JSON):
{
  "chunks": [
    {
      "title": "Kurzer, beschreibender Titel des Abschnitts",
      "content": "Der exakte Originaltext dieses Abschnitts - keine Änderungen!",
      "summary": "Ein-Satz-Zusammenfassung des Inhalts"
    }
  ]
}

WICHTIG: Der gesamte Originaltext muss in den Chunks enthalten sein, ohne Verluste oder Änderungen.

ZU SEGMENTIERENDER TEXT:
${text}`
}

// Validierung der KI-Antwort
function validateAIChunks(originalText: string, chunks: AIChunk[]): { isValid: boolean; error?: string } {
  // 1. Prüfe ob chunks existieren
  if (!chunks || chunks.length === 0) {
    return { isValid: false, error: "Keine Chunks erhalten" }
  }

  // 2. Prüfe ob alle erforderlichen Felder vorhanden sind
  for (const chunk of chunks) {
    if (!chunk.title || !chunk.content || !chunk.summary) {
      return { isValid: false, error: "Chunk fehlt erforderliche Felder (title, content, summary)" }
    }
  }

  // 3. Prüfe ob die Gesamtlänge ungefähr stimmt (Toleranz für Whitespace)
  const totalChunkLength = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0)
  const lengthDifference = Math.abs(totalChunkLength - originalText.length)
  const tolerancePercentage = 0.05 // 5% Toleranz

  if (lengthDifference > originalText.length * tolerancePercentage) {
    return { 
      isValid: false, 
      error: `Textlänge stimmt nicht überein. Original: ${originalText.length}, Chunks: ${totalChunkLength}` 
    }
  }

  // 4. Zusätzliche inhaltliche Validierungen
  // 4a. Jedes Chunk-Content muss im Originaltext vorkommen (in Reihenfolge)
  let cursor = 0
  for (const chunk of chunks) {
    const content = chunk.content.trim()
    if (content.length < 50) {
      return { isValid: false, error: "Ein Chunk ist zu kurz (<50 Zeichen)" }
    }
    const idx = originalText.indexOf(content, cursor)
    if (idx === -1) {
      return { isValid: false, error: "Chunk-Content nicht im Originaltext gefunden" }
    }
    cursor = idx + content.length
  }

  // 4b. Minimale/Maximale Chunklänge (weich, aber plausibel)
  const tooLong = chunks.find(c => c.content.length > 10000)
  if (tooLong) {
    return { isValid: false, error: "Ein Chunk ist ungewöhnlich lang (>10k Zeichen)" }
  }

  return { isValid: true }
}

// Rate Limiting (einfache In-Memory-Implementierung)
const rateLimitMap = new Map<string, { count: number; lastReset: number }>()
const DAILY_LIMIT = 50 // Chunks pro Tag pro User
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000 // 24 Stunden

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const userLimit = rateLimitMap.get(userId)

  if (!userLimit || now - userLimit.lastReset > RATE_LIMIT_WINDOW) {
    // Reset oder neuer User
    rateLimitMap.set(userId, { count: 0, lastReset: now })
    return { allowed: true, remaining: DAILY_LIMIT }
  }

  if (userLimit.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 }
  }

  return { allowed: true, remaining: DAILY_LIMIT - userLimit.count }
}

function incrementRateLimit(userId: string): void {
  const userLimit = rateLimitMap.get(userId)
  if (userLimit) {
    userLimit.count++
  }
}

export async function POST(req: NextRequest) {
  try {
    // Request-Body parsen
    const { text, language = "de", documentType, userId } = await req.json()

    // Validierung der Eingabe
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ 
        success: false, 
        error: "Text ist erforderlich und muss ein String sein" 
      }, { status: 400 })
    }

    // Mindestlänge prüfen
    if (text.length < 500) {
      return NextResponse.json({ 
        success: false, 
        error: "Text ist zu kurz für KI-Chunking (Minimum: 500 Zeichen)" 
      }, { status: 400 })
    }

    // Rate Limiting prüfen (falls userId vorhanden)
    if (userId) {
      const rateLimit = checkRateLimit(userId)
      if (!rateLimit.allowed) {
        return NextResponse.json({
          success: false,
          error: "Tägliches Limit für KI-Chunking erreicht",
          rateLimitRemaining: 0
        }, { status: 429 })
      }
    }

    // Token-Schätzung und Limit prüfen
    const estimatedTokens = estimateTokens(text)
    console.log(`[AI Chunking] Geschätzte Tokens: ${estimatedTokens}`)

    if (estimatedTokens > 900000) { // Sicherheitspuffer für GPT-4.1
      return NextResponse.json({ 
        success: false, 
        error: "Text ist zu lang für KI-Chunking (Maximum: ~900k Tokens)" 
      }, { status: 400 })
    }

    // OpenAI API Key prüfen
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ 
        success: false, 
        error: "OpenAI API Key nicht konfiguriert" 
      }, { status: 500 })
    }

    // Prompt erstellen
    const prompt = buildChunkingPrompt(text, language, documentType)
    
    console.log(`[AI Chunking] Starting chunking for ${text.length} characters...`)
    const startTime = Date.now()

    // OpenAI API Call
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini-2025-04-14", // Einheitliches Modell
      messages: [{ 
        role: "user", 
        content: prompt 
      }],
      response_format: { type: "json_object" },
      temperature: 0.1, // Niedrige Temperatur für konsistente Ergebnisse
      max_tokens: 4000 // Ausreichend für die JSON-Antwort
    })

    const processingTime = Date.now() - startTime
    console.log(`[AI Chunking] Completed in ${processingTime}ms`)

    // Response parsen
    const aiResponse = response.choices[0].message.content
    if (!aiResponse) {
      throw new Error("Keine Antwort von OpenAI erhalten")
    }

    let parsedResponse: ChunkingResponse | null = null
    parsedResponse = parseJsonLoose(aiResponse)
    if (!parsedResponse) {
      console.error("[AI Chunking] JSON Parse Error (loose parser)")
      throw new Error("Ungültige JSON-Antwort von OpenAI")
    }

    // Validierung der Chunks
    const validation = validateAIChunks(text, parsedResponse.chunks)
    if (!validation.isValid) {
      console.error("[AI Chunking] Validation failed:", validation.error)
      throw new Error(`Chunk-Validierung fehlgeschlagen: ${validation.error}`)
    }

    // Rate Limit aktualisieren
    if (userId) {
      incrementRateLimit(userId)
    }

    // Erfolgreiche Antwort
    return NextResponse.json({
      success: true,
      chunks: parsedResponse.chunks,
      metadata: {
        originalLength: text.length,
        chunkCount: parsedResponse.chunks.length,
        processingTimeMs: processingTime,
        tokensUsed: response.usage?.total_tokens || estimatedTokens,
        rateLimitRemaining: userId ? checkRateLimit(userId).remaining : null
      }
    })

  } catch (error: any) {
    console.error("[AI Chunking] Error:", error)

    // Spezifische OpenAI Fehler behandeln
    if (error.code === 'insufficient_quota') {
      return NextResponse.json({
        success: false,
        error: "OpenAI API Quota überschritten"
      }, { status: 503 })
    }

    if (error.code === 'rate_limit_exceeded') {
      return NextResponse.json({
        success: false,
        error: "OpenAI Rate Limit erreicht, bitte versuchen Sie es später erneut"
      }, { status: 429 })
    }

    // Allgemeine Fehler
    return NextResponse.json({ 
      success: false, 
      error: error.message || "Unbekannter Fehler beim KI-Chunking" 
    }, { status: 500 })
  }
} 