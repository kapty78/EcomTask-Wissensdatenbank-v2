import { encode } from "gpt-tokenizer"
import {
  RecursiveCharacterTextSplitter,
  MarkdownTextSplitter,
} from "langchain/text_splitter"
import { Document } from "@langchain/core/documents"
import { KnowledgeItemChunk } from "@/types/knowledge" // Assuming a similar type definition

// Interface für AI-Chunking Response
interface AIChunkResponse {
  title: string;
  content: string;
  summary: string;
}

// OPTIMIERTE Konfiguration für deutsche Geschäftsdokumente
const CHUNK_SIZE = 2500 // Optimale Größe für KI-Kontext und Faktenextraktion
const CHUNK_OVERLAP = 300 // Mehr Überlappung für besseren Kontext-Erhalt
const MIN_CHUNK_SIZE = 150 // Höhere Mindestgröße für sinnvolle Inhalte
const FORCE_SINGLE_CHUNK_THRESHOLD = 200; // Erhöht für bessere Einzeldokument-Behandlung

// ERWEITERTE Dokumenttyp-spezifische Konfiguration
const DOCUMENT_TYPE_CONFIGS = {
  contract: { chunkSize: 2000, overlap: 400, minSize: 100 }, // Kleinere Chunks für präzise Klauseln
  manual: { chunkSize: 3500, overlap: 250, minSize: 200 }, // Größere Chunks für zusammenhängende Prozesse
  specification: { chunkSize: 2200, overlap: 350, minSize: 150 }, // Mittlere Chunks für technische Details
  report: { chunkSize: 2800, overlap: 300, minSize: 180 }, // Ausgewogene Chunks für Berichte
  email: { chunkSize: 1500, overlap: 200, minSize: 80 }, // Kleinere Chunks für E-Mails
  table: { chunkSize: 1800, overlap: 100, minSize: 50 }, // Spezielle Behandlung für Tabellendaten
  default: { chunkSize: 2500, overlap: 300, minSize: 150 }
};

// INTELLIGENTE Dokumenttyp-Erkennung
const detectDocumentType = (textContent: string, fileName?: string): keyof typeof DOCUMENT_TYPE_CONFIGS => {
  const text = textContent.toLowerCase();
  const name = fileName?.toLowerCase() || '';
  
  // Vertrags-Indikatoren
  if (/\b(vertrag|vereinbarung|kontrakt|bedingungen|agb|klausel)\b/i.test(text) ||
      name.includes('vertrag') || name.includes('contract')) {
    return 'contract';
  }
  
  // Handbuch-Indikatoren
  if (/\b(handbuch|anleitung|prozess|verfahren|workflow|schritt)\b/i.test(text) ||
      name.includes('handbuch') || name.includes('manual') || name.includes('anleitung')) {
    return 'manual';
  }
  
  // Spezifikations-Indikatoren
  if (/\b(spezifikation|anforderung|technisch|parameter|api|interface)\b/i.test(text) ||
      name.includes('spec') || name.includes('requirements') || name.includes('technical')) {
    return 'specification';
  }
  
  // Berichts-Indikatoren
  if (/\b(bericht|analyse|auswertung|protokoll|report|summary)\b/i.test(text) ||
      name.includes('bericht') || name.includes('report') || name.includes('analyse')) {
    return 'report';
  }
  
  // E-Mail-Indikatoren
  if (/\b(von:|to:|betreff:|subject:|gesendet)\b/i.test(text) ||
      name.includes('mail') || name.includes('email')) {
    return 'email';
  }
  
  // Tabellen-Indikatoren
  if (text.includes('|') && text.split('|').length > 10 ||
      /\b(tabelle|table|spalte|zeile|column|row)\b/i.test(text) ||
      name.includes('table') || name.includes('xlsx') || name.includes('csv')) {
    return 'table';
  }
  
  return 'default';
};

// VERBESSERTE Chunk-Qualitätsbewertung
const assessChunkQuality = (content: string, documentType: string): { 
  score: number, 
  issues: string[], 
  improvements: string[] 
} => {
  const issues: string[] = [];
  const improvements: string[] = [];
  let score = 100;
  
  // Längen-Analyse
  const length = content.length;
  const wordCount = content.split(/\s+/).length;
  const sentenceCount = (content.match(/[.!?]+\s+[A-ZÜÄÖ]/g) || []).length;
  
  // Zu kurz
  if (length < 50) {
    score -= 40;
    issues.push('Chunk zu kurz für sinnvolle Analyse');
  } else if (length < 100) {
    score -= 20;
    issues.push('Chunk sehr kurz');
    improvements.push('Könnte mit benachbarten Chunks kombiniert werden');
  }
  
  // Zu lang
  if (length > 5000) {
    score -= 30;
    issues.push('Chunk zu lang für optimale Verarbeitung');
    improvements.push('Sollte weiter aufgeteilt werden');
  }
  
  // Satzstruktur-Analyse
  if (sentenceCount === 0) {
    score -= 25;
    issues.push('Keine vollständigen Sätze erkannt');
  } else if (wordCount / sentenceCount > 50) {
    score -= 15;
    issues.push('Übermäßig lange Sätze');
    improvements.push('Text könnte strukturiert werden');
  }
  
  // Dokumenttyp-spezifische Bewertung
  switch (documentType) {
    case 'contract':
      if (!/\b(soll|muss|kann|wird|paragraph|§)\b/i.test(content)) {
        score -= 10;
        improvements.push('Könnte rechtliche Sprache verbessert werden');
      }
      break;
    case 'technical':
      if (!/\b(parameter|wert|funktion|system|prozess)\b/i.test(content)) {
        score -= 10;
        improvements.push('Technische Begriffe könnten präziser sein');
      }
      break;
  }
  
  // Deutsche Sprach-Qualität
  const germanWords = (content.match(/\b(der|die|das|und|oder|mit|von|zu|in|auf|für|ist|sind|hat|haben|wird|werden)\b/gi) || []).length;
  const germanRatio = germanWords / wordCount;
  
  if (germanRatio < 0.05) {
    score -= 20;
    issues.push('Wenig deutsche Sprachemuster erkannt');
  }
  
  // Informationsdichte-Bewertung
  const uppercaseRatio = (content.match(/[A-Z]/g) || []).length / length;
  const numberRatio = (content.match(/\d/g) || []).length / length;
  const specialCharRatio = (content.match(/[€$%&@#]/g) || []).length / length;
  
  if (uppercaseRatio > 0.3) {
    score -= 15;
    issues.push('Zu viele Großbuchstaben (mögl. OCR-Fehler)');
  }
  
  if (numberRatio > 0.2) {
    improvements.push('Zahlen-lastig - könnte strukturiert werden');
  }
  
  return { score: Math.max(0, score), issues, improvements };
};

// OPTIMIERTE Separator-Muster für deutsche Geschäftsdokumente
const GERMAN_BUSINESS_SEPARATORS = [
  // Deutsche Dokumentstruktur-Trennzeichen
  "\n\n## ", // Hauptkapitel
  "\n\n### ", // Unterkapitel  
  "\n\n#### ", // Abschnitte
  "\n\n**", // Fettgedruckte Überschriften
  "\n\nKapitel ", // Explizite Kapitel
  "\n\nAbschnitt ", // Explizite Abschnitte
  "\n\nAnlage ", // Anlagen und Anhänge
  "\n\nTabelle ", // Tabellen-Anfänge
  "\n\n", // Doppelte Zeilenumbrüche (Absätze)
  
  // Deutsche Geschäftsdokument-Trennzeichen
  "\n- ", // Listen mit Bindestrichen
  "\n• ", // Listen mit Bullet Points
  "\n1. ", // Nummerierte Listen
  "\n2. ", // Fortsetzung nummerierter Listen
  "\na) ", // Alphabetische Listen
  "\nI. ", // Römische Nummerierung
  
  // Satzbasierte Trennung für fließende Texte
  ". \n", // Satzende mit Zeilenumbruch
  "; ", // Stichpunkt-Trennung
  ", ", // Komma-Trennung
  " " // Wort-Trennung als letzter Ausweg
]

// KI-CHUNKING FUNKTIONEN

/**
 * Prüft ob Text für KI-basiertes Chunking geeignet ist
 */
function shouldUseAIChunking(textContent: string, fileName?: string): boolean {
  // Mindestlänge für sinnvolles KI-Chunking
  if (textContent.length < 1000) {
    return false;
  }

  // Maximallänge für OpenAI API (ca. 900k Tokens ≈ 3.15M Zeichen)
  if (textContent.length > 3000000) {
    return false;
  }

  // Erkenne strukturierte Daten, die nicht für KI-Chunking geeignet sind
  if (isStructuredData(textContent)) {
    return false;
  }

  // Dateityp-basierte Entscheidung
  const extension = fileName?.toLowerCase().split('.').pop();
  const unsuitableExtensions = ['csv', 'json', 'xml', 'sql'];
  if (extension && unsuitableExtensions.includes(extension)) {
    return false;
  }

  // Prüfe ob Text hauptsächlich aus Zahlen/Tabellen besteht
  const numberLines = textContent.split('\n').filter(line => {
    const numbers = line.match(/\d/g);
    return numbers && numbers.length > line.length * 0.3;
  });
  
  if (numberLines.length > textContent.split('\n').length * 0.5) {
    return false; // Hauptsächlich numerische Daten
  }

  return true;
}

/**
 * Erkennt strukturierte Daten, die nicht für KI-Chunking geeignet sind
 */
function isStructuredData(text: string): boolean {
  // JSON-Struktur
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      JSON.parse(text);
      return true;
    } catch {
      // Nicht valides JSON, trotzdem strukturiert aussehend
      if (text.includes('":"') || text.includes('": "')) {
        return true;
      }
    }
  }

  // CSV-ähnliche Struktur
  const lines = text.split('\n');
  if (lines.length > 3) {
    const separatorCount = lines[0].split(/[,;\t]/).length;
    if (separatorCount > 3) {
      const consistentLines = lines.slice(0, 5).filter(line => 
        Math.abs(line.split(/[,;\t]/).length - separatorCount) <= 1
      );
      if (consistentLines.length >= 3) {
        return true; // CSV-ähnlich
      }
    }
  }

  // XML-ähnliche Struktur
  if (text.includes('</') && text.includes('<?xml')) {
    return true;
  }

  return false;
}

/**
 * Führt KI-basiertes semantisches Chunking durch
 */
async function performAIChunking(
  textContent: string, 
  fileName?: string, 
  userId?: string
): Promise<KnowledgeItemChunk[]> {
  try {
    console.log(`[AI Chunking] Starting AI-based chunking for ${textContent.length} characters...`);
    
    // Dokumenttyp für besseres Prompting erkennen
    const documentType = detectDocumentType(textContent, fileName);
    
    // API Call zur intelligenten Chunking-Route
    const response = await fetch('/api/knowledge/intelligent-chunking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: textContent,
        language: 'de',
        documentType,
        userId
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'AI Chunking failed');
    }

    console.log(`[AI Chunking] Successfully created ${data.chunks.length} semantic chunks`);
    console.log(`[AI Chunking] Tokens used: ${data.metadata.tokensUsed}, Processing time: ${data.metadata.processingTimeMs}ms`);

    // Konvertiere AI-Response zu KnowledgeItemChunk Format
    const chunks: KnowledgeItemChunk[] = data.chunks.map((chunk: AIChunkResponse, index: number) => ({
      content: chunk.content,
      tokens: encode(chunk.content).length,
      metadata: {
        title: chunk.title,
        summary: chunk.summary,
        chunkIndex: index,
        chunkingMethod: 'ai_semantic',
        documentType
      }
    }));

    return chunks;

  } catch (error: any) {
    console.error('[AI Chunking] Error:', error);
    
    // Bei Fehlern: Fallback zu traditionellem Chunking
    console.log('[AI Chunking] Falling back to traditional chunking method...');
    throw error; // Rethrow um Fallback in der Hauptfunktion zu triggern
  }
}

/**
 * Fallback: Traditionelles Chunking (bisherige Logik)
 */
async function performTraditionalChunking(
  textContent: string,
  fileName?: string
): Promise<KnowledgeItemChunk[]> {
  console.log('[Traditional Chunking] Using traditional chunking method...');
  
  // Dokumenttyp-Erkennung
  const documentType = detectDocumentType(textContent, fileName);
  const config = DOCUMENT_TYPE_CONFIGS[documentType];
  
  // Einzelchunk für kurze Dokumente
  if (textContent.length < config.chunkSize * 0.8) {
    const tokens = encode(textContent).length;
    return [{
      content: textContent.trim(),
      tokens: tokens,
      metadata: {
        chunkingMethod: 'single_chunk',
        documentType
      }
    }];
  }

  // RecursiveCharacterTextSplitter für längere Dokumente
  const splitter = new RecursiveCharacterTextSplitter({
    separators: GERMAN_BUSINESS_SEPARATORS,
    chunkSize: config.chunkSize,
    chunkOverlap: config.overlap,
    lengthFunction: text => encode(text).length,
    keepSeparator: true
  });

  const documents = await splitter.createDocuments([textContent]);
  
  return documents.map((doc: Document, index: number) => ({
    content: doc.pageContent,
    tokens: encode(doc.pageContent).length,
    metadata: {
      chunkIndex: index,
      chunkingMethod: 'traditional_recursive' as const,
      documentType
    }
  }));
}

/**
 * OPTIMIERTE Chunking-Funktion für deutsche Geschäftsdokumente.
 * Berücksichtigt deutsche Dokumentstrukturen, Geschäftsterminologie und 
 * optimiert für nachgelagerte Faktenextraktion.
 *
 * @param textContent Der zu segmentierende deutsche Textinhalt
 * @param fileName Optional: Dateiname für Dokumenttyp-Erkennung
 * @returns Array von optimierten Chunks für Faktenextraktion
 */
export const chunkTextForKnowledgeBase = async (
  textContent: string,
  fileName?: string
): Promise<KnowledgeItemChunk[]> => {
  if (!textContent || textContent.trim().length === 0) {
    console.log("Keine Inhalte zum Chunking gefunden.")
    return []
  }

  // Intelligente Dokumenttyp-Erkennung
  const documentType = detectDocumentType(textContent, fileName);
  const config = DOCUMENT_TYPE_CONFIGS[documentType];
  
  console.log(`Erkannter Dokumenttyp: ${documentType} (Chunk-Größe: ${config.chunkSize}, Überlappung: ${config.overlap})`);

  // 🚀 NEUE LOGIK: Prüfe ob KI-basiertes Chunking verwendet werden soll
  if (shouldUseAIChunking(textContent, fileName)) {
    try {
      console.log(`[AI Chunking] Text ist geeignet für KI-Chunking (${textContent.length} Zeichen)`);
      return await performAIChunking(textContent, fileName);
    } catch (error: any) {
      console.warn('[AI Chunking] Fallback zu traditionellem Chunking:', error.message);
      // Fallback zu traditionellem Chunking bei Fehlern
    }
  } else {
    console.log(`[Traditional Chunking] Text nicht geeignet für KI-Chunking, verwende traditionelle Methode`);
  }

  // Intelligente Einzelchunk-Erkennung für kurze Dokumente
  if (textContent.length < config.chunkSize * 0.8) {
    console.log(`Text ist kurz (${textContent.length} Zeichen), erstelle optimierten Einzelchunk...`);
    const tokens = encode(textContent).length;
    const quality = assessChunkQuality(textContent, documentType);
    
    console.log(`Chunk-Qualität: ${quality.score}/100${quality.issues.length > 0 ? `, Probleme: ${quality.issues.join(', ')}` : ''}`);
    
    return [{
      content: textContent.trim(),
      tokens: tokens,
      metadata: {
        chunkingMethod: 'single_chunk',
        documentType
      }
    }];
  }

  // ✅ FALLBACK: Verwende traditionelles Chunking
  console.log('[Traditional Chunking] Fallback zu traditionellem Chunking...');
  return await performTraditionalChunking(textContent, fileName);
}
