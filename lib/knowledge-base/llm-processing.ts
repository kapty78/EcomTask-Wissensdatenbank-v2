import OpenAI from 'openai';

// Initialize OpenAI client (consider moving to a shared config if used elsewhere)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Optimiertes Logging-System
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // 'debug', 'info', 'warn', 'error'
const PROD_MODE = process.env.NODE_ENV === 'production';

const logger = {
  debug: (message: string, ...data: any[]) => {
    if (LOG_LEVEL === 'debug' && !PROD_MODE) {
      console.debug(`[DEBUG] ${message}`, ...data);
    }
  },
  info: (message: string, ...data: any[]) => {
    if (['debug', 'info'].includes(LOG_LEVEL)) {
      console.log(`[INFO] ${message}`, ...data);
    }
  },
  warn: (message: string, ...data: any[]) => {
    if (['debug', 'info', 'warn'].includes(LOG_LEVEL)) {
      console.warn(`[WARN] ${message}`, ...data);
    }
  },
  error: (message: string, ...data: any[]) => {
    console.error(`[ERROR] ${message}`, ...data);
  }
};

/**
 * Extrahiert Fakten aus einem Textabschnitt und gibt sie als Array zurück.
 * Verwendet einen optimierten Prompt für die Generierung präziser, sachlicher Fakten.
 * 
 * @param chunk Der Textabschnitt, aus dem Fakten extrahiert werden sollen
 * @param sourceName Optional: Name der Quelle/des Dokuments (für kontextualisierte Faktenformatierung)
 * @param chunkNumber Optional: Nummer des aktuellen Chunks (für Kontext bei Multi-Chunk-Dokumenten)
 * @param totalChunks Optional: Gesamtzahl der Chunks im Dokument
 * @returns Ein Array von extrahierten Fakten als Strings
 */
/**
 * Bereinigt Text für LLM-Verarbeitung und Datenbank-Kompatibilität
 * @param text Der zu bereinigende Text
 * @returns Bereinigter Text
 */
const cleanTextForProcessing = (text: string): string => {
  if (!text) return '';
  
  return text
    // Entferne NULL-Zeichen und andere problematische Control-Zeichen
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // Normalisiere Unicode
    .normalize('NFC')
    .trim();
};

export async function extractFactsFromText(
  chunk: string, 
  sourceName?: string,
  chunkNumber?: number,
  totalChunks?: number
): Promise<string[]> {
  // Grundlegende Validierung
  if (!chunk || chunk.trim().length === 0) {
    logger.info(`Leerer Text - keine Fakten werden extrahiert.`);
    return [];
  }

  // Bereinige den Text vor der Verarbeitung
  const trimmedChunk = cleanTextForProcessing(chunk.trim());
  
  // Entfernt: Früher wurde bei kurzen Texten eine Heuristik genutzt und das LLM übersprungen.
  // Jetzt läuft die LLM-Extraktion IMMER, unabhängig von der Textlänge.

  try {
    // OPTIMIERTES SYSTEM-PROMPT: Fakten-Experte für Wissensdatenbanken
    const systemContent = `Du agierst als strenger Fakten-Extraktor für eine deutschsprachige Wissensdatenbank.
Ziel: Aus Textabschnitten KURZE, ATOMARE, SELBSTERKLÄRENDE Fakten gewinnen, die direkt vektorisiert werden können.

VERHALTEN & QUALITÄT:
- NUR Inhalte verwenden, die EXPLIZIT im Text stehen (keine Schlussfolgerungen, keine Halluzinationen)
- Ein Fakt = genau EINE Information (maximal 1 kurzer Satz, 15–22 Wörter)
- Vollständige deutsche Sätze, ohne Aufzählungszeichen und ohne Anführungszeichen
- Keine Meta-Aussagen über „Text“, „Dokument“, „Abschnitt“
- Ohne Kontext verständlich
- Präzise, neutral, faktenbasiert

AUSGABESTRUKTUR (streng): JSON mit einem Array aus Objekten { text, type }
Zulässige type-Werte:
  "date", "amount", "person", "role", "step", "rule", "spec",
  "contact", "condition", "feature", "organization", "location", "definition", "other"
`;

    // Dynamische Mindestanzahl an Fakten
    const minFacts = trimmedChunk.length <= 150 ? 4 : trimmedChunk.length <= 600 ? 12 : 24;

    // OPTIMIERTES USER-PROMPT mit Schema und Regeln
    let userContent = `AUFGABE: Extrahiere aus dem folgenden Textabschnitt so viele KURZE, ATOMARE Fakten wie sinnvoll ist.

EXTRAKTIONS-BEISPIELE (jeweils als separater Fakt):
• Konkrete Zahlen/Einheiten/Preise/Fristen/Datumsangaben (type: amount|date)
• Zuständigkeiten/Rollen/Ansprechpartner (type: role|person|contact)
• Prozessschritte/Arbeitsanweisungen (type: step)
• Regeln/Policies/Compliance (type: rule)
• Technische Spezifikationen/Parameter (type: spec)
• Vertragsbedingungen/Konditionen (type: condition)
• Eigenschaften/Features/Leistungsmerkmale (type: feature)
• Organisationen/Standorte (type: organization|location)
• Begriffsdefinitionen (type: definition)

PRÄZISIONS- und STIL-REGELN:
1) 1 Fakt = 1 Information, 15–22 Wörter, vollständiger deutscher Satz
2) Keine Zusammenfassungen, keine Meta-Sätze, keine Duplikate
3) Zahlen/Einheiten exakt übernehmen; Namen/Begriffe korrekt wiedergeben
4) Nur explizite Inhalte – keine Interpretationen

SCHEMA (strikt als JSON, KEIN Fließtext):
{
  "facts": [
    { "text": "kurzer, atomarer Fakt.", "type": "rule" },
    { "text": "weiterer kurzer, atomarer Fakt.", "type": "amount" }
  ]
}

MINDESTANFORDERUNG: mind. ${minFacts} valide Objekte in facts (falls inhaltlich vorhanden).
`;

    // Kontext-Information hinzufügen
    if (sourceName) {
      if (chunkNumber && totalChunks) {
        userContent += `\nKONTEXT: Abschnitt ${chunkNumber} von ${totalChunks} aus "${sourceName}".`;
      } else {
        userContent += `\nKONTEXT: Quelle "${sourceName}".`;
      }
    }

    userContent += `\n\nTEXTABSCHNITT:\n---\n${trimmedChunk}\n---`;

    // LLM-Aufruf mit JSON-Ausgabe
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini-2025-04-14",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
      ],
      temperature: 0.0,
      max_tokens: 2200,
      top_p: 0.1,
      frequency_penalty: 0.5,
      presence_penalty: 0.2,
      response_format: { type: "json_object" }
    });

    const output = response.choices[0].message.content || "";

    // JSON-basiertes Parsing der Fakten mit Schema-Unterstützung
    let extractedFacts: string[] = [];
    try {
      const parsed = JSON.parse(output || '{}');
      if (parsed && Array.isArray(parsed.facts)) {
        // Erwartet: { text: string, type: string }
        extractedFacts = (parsed.facts as any[])
          .map(o => (typeof o?.text === 'string' ? String(o.text) : ''))
          .map(line => line.trim())
          .filter(Boolean);
      }
    } catch {}

    // Fallback 1: nummerierte Liste parsen (Kompatibilität)
    if (extractedFacts.length === 0) {
      extractedFacts = output
        .split("\n")
        .map(line => line.trim())
        .filter(line => /^\d+\./.test(line))
        .map(line => line.replace(/^\d+\.\s*/, "").trim());
    }

    // Fallback 2: satzbasierte Auftrennung
    if (extractedFacts.length === 0) {
      extractedFacts = trimmedChunk
        .split(/(?<=[.!?;])\s+(?=[A-ZÄÖÜ0-9])/g)
        .map(s => s.trim())
        .filter(Boolean);
    }

    // Normalisierung, Bereinigung, Qualitätsfilter, Duplikatentfernung
    const seen = new Set<string>();
    extractedFacts = extractedFacts
      .map(line => {
        let fact = line;
        fact = fact.replace(/^["'\-•\s]+|["']+$/g, "");
        fact = cleanTextForProcessing(fact);
        if (!/[.!?]$/.test(fact)) fact += '.';
        return fact;
      })
      .filter(fact => {
        const key = fact.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        // Längen-/Stoppwörterfilter
        if (fact.length < 10 || fact.length > 160) return false;
        const lower = fact.toLowerCase();
        if (/(dokument|text|abschnitt)\b/.test(lower)) return false;
        return true;
      })
      .slice(0, 30);

    // FALLBACK: Falls keine Fakten extrahiert wurden, aber der Text sinnvoll ist
    if (extractedFacts.length === 0 && trimmedChunk.length >= 10) {
      logger.warn(`LLM extrahierte 0 Fakten aus "${trimmedChunk.substring(0, 50)}..." - verwende Originaltext als Fallback.`);
      
      // Originaltext als Fakt verwenden
      let fallbackFact = cleanTextForProcessing(trimmedChunk);
      if (!fallbackFact.endsWith('.') && !fallbackFact.endsWith('!') && !fallbackFact.endsWith('?')) {
        fallbackFact += '.';
      }
      return [fallbackFact];
    }

    logger.info(`Optimierte Faktenextraktion: ${extractedFacts.length} hochwertige Fakten extrahiert (${trimmedChunk.length} Zeichen Input).`);
    
    return extractedFacts;

  } catch (error: any) {
    logger.error('Fehler bei der optimierten Faktenextraktion:', error);
    
    // NOTFALL-FALLBACK: Bei LLM-Fehlern den Originaltext als Fakt verwenden
    if (trimmedChunk.length >= 5) {
      logger.warn('LLM-Fehler - verwende Originaltext als Notfall-Fakt.');
      let emergencyFact = cleanTextForProcessing(trimmedChunk);
      if (!emergencyFact.endsWith('.') && !emergencyFact.endsWith('!') && !emergencyFact.endsWith('?')) {
        emergencyFact += '.';
      }
      return [emergencyFact];
    }
    
    throw new Error(`Faktenextraktion fehlgeschlagen: ${error.message}`);
  }
}

export async function extractFactsWithTypes(
  chunk: string,
  sourceName?: string,
  chunkNumber?: number,
  totalChunks?: number
): Promise<{ texts: string[]; types: (string | null)[] }> {
  // Grundvalidierung
  if (!chunk || chunk.trim().length === 0) {
    return { texts: [], types: [] };
  }

  const trimmedChunk = cleanTextForProcessing(chunk.trim());

  // Systemprompt (identisch zur Extraktion oben, zusammengefasst)
  const systemContent = `Du agierst als strenger Fakten-Extraktor für eine deutschsprachige Wissensdatenbank.
Ziel: Aus Textabschnitten KURZE, ATOMARE, SELBSTERKLÄRENDE Fakten gewinnen, die direkt vektorisiert werden können.

VERHALTEN & QUALITÄT:
- NUR Inhalte verwenden, die EXPLIZIT im Text stehen (keine Schlussfolgerungen, keine Halluzinationen)
- Ein Fakt = genau EINE Information (maximal 1–2 kurze Sätze, 15–22 Wörter)
- Vollständige deutsche Sätze, ohne Aufzählungszeichen und ohne Anführungszeichen
- Keine Meta-Aussagen über „Text“, „Dokument“, „Abschnitt“
- Ohne Kontext verständlich
- Präzise, neutral, faktenbasiert

AUSGABESTRUKTUR (streng): JSON mit einem Array aus Objekten { text, type }
Zulässige type-Werte:
  "date", "amount", "person", "role", "step", "rule", "spec",
  "contact", "condition", "feature", "organization", "location", "definition"
`;

  const minFacts = trimmedChunk.length <= 150 ? 4 : trimmedChunk.length <= 600 ? 12 : 24;

  let userContent = `AUFGABE: Extrahiere aus dem folgenden Textabschnitt so viele KURZE, ATOMARE Fakten wie sinnvoll ist.

EXTRAKTIONS-FOKUS (jeweils als separater Fakt):
• Konkrete Zahlen/Einheiten/Preise/Fristen/Datumsangaben (type: amount|date)
• Zuständigkeiten/Rollen/Ansprechpartner (type: role|person|contact)
• Prozessschritte/Arbeitsanweisungen (type: step)
• Regeln/Policies/Compliance (type: rule)
• Technische Spezifikationen/Parameter (type: spec)
• Vertragsbedingungen/Konditionen (type: condition)
• Eigenschaften/Features/Leistungsmerkmale (type: feature)
• Organisationen/Standorte (type: organization|location)
• Begriffsdefinitionen (type: definition)

PRÄZISIONS- und STIL-REGELN:
1) 1 Fakt = 1 Information, 15–22 Wörter, vollständiger deutscher Satz
2) Keine Zusammenfassungen, keine Meta-Sätze, keine Duplikate
3) Zahlen/Einheiten exakt übernehmen; Namen/Begriffe korrekt wiedergeben
4) Nur explizite Inhalte – keine Interpretationen

SCHEMA (strikt als JSON, KEIN Fließtext):
{
  "facts": [
    { "text": "kurzer, atomarer Fakt.", "type": "rule" },
    { "text": "weiterer kurzer, atomarer Fakt.", "type": "amount" }
  ]
}

MINDESTANFORDERUNG: mind. ${minFacts} valide Objekte in facts (falls inhaltlich vorhanden).
`;

  if (sourceName) {
    if (chunkNumber && totalChunks) {
      userContent += `\nKONTEXT: Abschnitt ${chunkNumber} von ${totalChunks} aus "${sourceName}".`;
    } else {
      userContent += `\nKONTEXT: Quelle "${sourceName}".`;
    }
  }

  userContent += `\n\nTEXTABSCHNITT:\n---\n${trimmedChunk}\n---`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini-2025-04-14",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
      ],
      temperature: 0.0,
      max_tokens: 2200,
      top_p: 0.1,
      frequency_penalty: 0.5,
      presence_penalty: 0.2,
      response_format: { type: "json_object" }
    });

    const output = response.choices[0].message.content || "";

    let texts: string[] = [];
    let types: (string | null)[] = [];

    try {
      const parsed = JSON.parse(output || '{}');
      if (parsed && Array.isArray(parsed.facts)) {
        const pairs = (parsed.facts as any[])
          .map(o => ({
            text: (typeof o?.text === 'string' ? String(o.text).trim() : ''),
            type: (typeof o?.type === 'string' ? String(o.type).trim() : null)
          }))
          .filter(p => p.text);
        texts = pairs.map(p => p.text);
        types = pairs.map(p => p.type);
      }
    } catch {}

    // Fallbacks ohne Typen
    if (texts.length === 0) {
      texts = output
        .split("\n")
        .map(line => line.trim())
        .filter(line => /^\d+\./.test(line))
        .map(line => line.replace(/^\d+\.\s*/, "").trim());
      types = new Array(texts.length).fill(null);
    }

    if (texts.length === 0) {
      texts = trimmedChunk
        .split(/(?<=[.!?;])\s+(?=[A-ZÄÖÜ0-9])/g)
        .map(s => s.trim())
        .filter(Boolean);
      types = new Array(texts.length).fill(null);
    }

    // Normalisierung / Filter / Dedupe – Typen mitziehen
    const seen = new Set<string>();
    const normalized: { text: string; type: string | null }[] = texts.map((t, i) => ({ text: t, type: types[i] || null }))
      .map(pair => {
        let fact = pair.text;
        fact = fact.replace(/^["'\-•\s]+|["']+$/g, "");
        fact = cleanTextForProcessing(fact);
        if (!/[.!?]$/.test(fact)) fact += '.';
        return { text: fact, type: pair.type };
      })
      .filter(obj => {
        const key = obj.text.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        if (obj.text.length < 10 || obj.text.length > 160) return false;
        const lower = obj.text.toLowerCase();
        if (/(dokument|text|abschnitt)\b/.test(lower)) return false;
        return true;
      })
      .slice(0, 30);

    return { texts: normalized.map(n => n.text), types: normalized.map(n => n.type) };
  } catch (error: any) {
    // Notfall-Fallback (ohne Typen)
    if (trimmedChunk.length >= 5) {
      let emergencyFact = cleanTextForProcessing(trimmedChunk);
      if (!/[.!?]$/.test(emergencyFact)) emergencyFact += '.';
      return { texts: [emergencyFact], types: [null] };
    }
    return { texts: [], types: [] };
  }
}

/**
 * Bereitet einen Textabschnitt für die AI-Verarbeitung vor, indem unstrukturierter Text
 * in einen besser lesbaren Fließtext umgewandelt wird.
 * 
 * @param chunk Der aufzubereitende Textabschnitt
 * @param fileName Name der Datei/Quelle für Referenz
 * @param pageNumber Optional: Seitennummer (wenn zutreffend)
 * @param skipPreprocessing Optional: Wenn true, wird keine Aufbereitung durchgeführt (Standard: false)
 * @returns Aufbereiteter Textabschnitt als String
 */
export async function preprocessTextChunk(
  chunk: string,
  fileName: string,
  pageNumber?: number,
  skipPreprocessing: boolean = false
): Promise<string> {
  if (!chunk || chunk.trim().length === 0) return '';
  
  // Wenn Vorverarbeitung übersprungen werden soll, Original zurückgeben
  if (skipPreprocessing) {
    return chunk;
  }
  
  // SEITEN-BASIERTE AUFBEREITUNG: Jede Seite wird aufbereitet (keine Skip-Logik)
  // WICHTIG: Für seiten-basiertes Chunking wollen wir JEDE Seite durch GPT aufbereiten
  logger.info(`Bereite Seite mit ${chunk.trim().length} Zeichen durch GPT-4.1-nano auf (ohne Informationsverlust)`);
  
  // Entferne alte Skip-Logik - wir bearbeiten ALLE Seiten für maximale Qualität
  
  try {
    // OPTIMIERTES SYSTEM-PROMPT: Spezialist für deutsche Dokument-Aufbereitung
    const systemContent = `Du bist ein Experte für die Aufbereitung deutscher Geschäftsdokumente. Deine Aufgabe: Rohe Textdaten in strukturierte, gut lesbare Fließtexte umwandeln – OHNE Informationsverlust.

STRIKTE VORGABEN:
- KEINE neuen Inhalte hinzufügen, KEINE Interpretationen
- Reihenfolge und inhaltliche Bezüge erhalten
- Überschriften/Abschnitte beibehalten (falls im Text erkennbar)
- Tabellen und Listen in vollständige Sätze übertragen (alle Werte erhalten)
- Zahlen, Maße, Datumsangaben EXAKT übernehmen (keine Rundungen)
- Namen/Adressen/Kontakte vollständig übernehmen
`;

    const userContent = `AUFGABE: Bereite den folgenden Rohtext für optimale Faktenextraktion auf (Null‑Verlust‑Prinzip).
Quelle: ${fileName}${pageNumber ? ` (Seite ${pageNumber})` : ''}

AUFBEREITUNGS-FOCUS:
• Tabellen → Sätze je Zeile/Spalte mit EXAKTEN Werten
• Listen → Jeden Punkt in einen vollständigen deutschen Satz
• Fragmente → vorsichtig vervollständigen, ohne neue Inhalte
• Fachbegriffe/Abkürzungen → ggf. ausschreiben, aber Bedeutung NICHT ändern
• Zahlen/Daten → exakt übernehmen; Einheiten beibehalten

QUALITÄTSPRÜFUNG (implizit): Ergebnis darf keine Inhalte auslassen oder hinzufügen.

ROHTEXT:
---
${chunk}
---

AUFBEREITETER TEXT:`;

    // Verwende GPT-4.1-nano für die deutsche Textaufbereitung
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini-2025-04-14", // Spezifisches nano-Modell für Textaufbereitung
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
      ],
      temperature: 0.1, // Leichte Kreativität für bessere Lesbarkeit
      max_tokens: Math.min(2000, chunk.length * 3), // Begrenzt auf max. 3x Input-Länge
      top_p: 0.2, // Fokussierte aber flexible Antworten
    });
    
    const processedText = response.choices[0].message.content || chunk;
    
    // Qualitätsprüfung des aufbereiteten Texts
    const originalLength = chunk.length;
    const processedLength = processedText.length;
    const sentenceCount = (processedText.match(/[.!?]+\s+[A-ZÜÄÖ]/g) || []).length;
    
    // KRITISCHE QUALITÄTSPRÜFUNG: Schutz vor Informationsverlust
    if (processedLength > originalLength * 5) {
      logger.warn(`⚠️ PREPROCESSING ZU LANG: ${originalLength} → ${processedLength} Zeichen. Prüfe auf Halluzinationen!`);
      // Bei extremer Verlängerung könnte GPT halluzinieren - trotzdem verwenden aber warnen
    }
    
    // WICHTIGER INFORMATIONSVERLUST-SCHUTZ
    if (processedLength < originalLength * 0.5) {
      logger.error(`🚫 KRITISCHER INFORMATIONSVERLUST: Text um ${Math.round((1 - processedLength/originalLength) * 100)}% verkürzt!`);
      logger.error(`Original: ${originalLength} Zeichen → Processed: ${processedLength} Zeichen`);
      logger.error(`Das deutet auf Informationsverlust hin. Verwende Originaltext als Sicherheit.`);
      return chunk.trim(); // Bei verdächtigem Informationsverlust Original verwenden
    }
    
    logger.info(`Text erfolgreich aufbereitet: ${originalLength} → ${processedLength} Zeichen, ${sentenceCount} vollständige Sätze`);
    return processedText;
    
  } catch (error) {
    logger.error('Fehler bei der optimierten Textaufbereitung:', error);
    // Bei Fehlern verwenden wir den Original-Text
    return chunk;
  }
}

// Behalte die alte Funktion für Abwärtskompatibilität, aber markiere sie als veraltet
/**
 * @deprecated Verwende stattdessen extractFactsFromText() für eine verbesserte Implementierung
 */
export async function generateDetailedSegmentExtract(pageText: string): Promise<string> {
  logger.warn('[DEPRECATED] generateDetailedSegmentExtract wird bald entfernt. Bitte verwende extractFactsFromText()');
  
  try {
    const facts = await extractFactsFromText(pageText);
    // Formatiere als Bindestrich-Liste für Abwärtskompatibilität
    return facts.map(fact => `- ${fact}`).join('\n');
  } catch (error) {
    logger.error('Fehler in veralteter Funktion generateDetailedSegmentExtract:', error);
    return '';
  }
} 