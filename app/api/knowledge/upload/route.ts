import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { extractTextFromFile } from "@/lib/knowledge-base/extraction"
import { generateEmbeddings } from "@/lib/knowledge-base/embedding"
import { extractFactsFromText } from "@/lib/knowledge-base/llm-processing"
import { chunkTextForKnowledgeBase } from "@/lib/knowledge-base/chunking"
import OpenAI from "openai"
import { uploadStatusUtils } from "../upload-status/utils"

const { initUploadStatus, addUploadLog, updateUploadProgress, completeUpload } =
  uploadStatusUtils

// SERVERLESS-OPTIMIERTE Konfiguration für Knowledge Base Upload
const SERVERLESS_KNOWLEDGE_CONFIG = {
  MAX_PROCESSING_TIME_MS: 45000, // 45 Sekunden für Knowledge Upload
  TIMEOUT_WARNING_MS: 35000, // Warnung bei 35 Sekunden
  MAX_CHUNKS_PER_REQUEST: 10, // Maximale Chunks pro Request
  MIN_TEXT_LENGTH_FOR_EXTRACTION: 50, // Mindestlänge für Faktenextraktion
  MAX_FACTS_PER_CHUNK: 20, // Maximale Fakten pro Chunk
  DEBUG_MODE: true // Debug-Modus aktivieren
};

// Serverless-optimierte Timeout-Überwachung
const createTimeoutGuard = (timeoutMs: number) => {
  let isTimedOut = false;
  const timer = setTimeout(() => {
    isTimedOut = true;
    console.log(`[KNOWLEDGE-UPLOAD] Process nähert sich Timeout-Limit (${timeoutMs}ms)`);
  }, timeoutMs);

  return {
    isTimedOut: () => isTimedOut,
    clear: () => clearTimeout(timer)
  };
};

// Debug-Hilfsfunktion
function debugLog(requestId: string, message: string) {
  if (SERVERLESS_KNOWLEDGE_CONFIG.DEBUG_MODE) {
    console.log(`[DEBUG][KNOWLEDGE][${requestId}] ${message}`);
    if (requestId) {
      addUploadLog(requestId, `DEBUG: ${message}`);
    }
  }
}

export async function POST(request: NextRequest) {
  console.log("🔍 RUNNING SERVERLESS-OPTIMIZED KNOWLEDGE UPLOAD ROUTE");
  
  const startTime = Date.now();
  const timeoutGuard = createTimeoutGuard(SERVERLESS_KNOWLEDGE_CONFIG.TIMEOUT_WARNING_MS);
  
  // Support both cookie auth (web) and Bearer token auth (mobile)
  const authHeader = request.headers.get("authorization")
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null

  let supabase: any
  if (bearerToken) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: `Bearer ${bearerToken}` }
        }
      }
    )
  } else {
    const cookieStore = cookies()
    supabase = createRouteHandlerClient({
      cookies: () => cookieStore
    })
  }

  // Extrahiere Request-ID für Status-Tracking
  let requestId = ""

  try {
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      console.error("[Upload API] User not found in session.")
      return NextResponse.json(
        { error: "Unauthorized - Session Invalid" },
        { status: 401 }
      )
    }
    console.log(`[Upload API] User authenticated: ${user.id}`)

    // Check if user has upload permission
    const { data: profile, error: permissionError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (permissionError) {
      console.error('[Upload API] Error checking user permissions:', permissionError);
      return NextResponse.json(
        { error: 'Failed to verify user permissions' },
        { status: 500 }
      );
    }

    // Type assertion to access can_upload and company_id fields
    const userProfile = profile as any;
    if (!userProfile?.can_upload) {
      console.log(`[Upload API] User ${user.id} does not have upload permission`);
      return NextResponse.json(
        { error: 'Forbidden - No upload permission' },
        { status: 403 }
      );
    }

    // ✅ COMPANY SHARING: Prüfe ob company_id vorhanden
    const userCompanyId = userProfile?.company_id;
    if (!userCompanyId) {
      console.log(`[Upload API] User ${user.id} has no company_id assigned`);
      return NextResponse.json(
        { error: 'Keine Company zugewiesen. Bitte Administrator kontaktieren.' },
        { status: 403 }
      );
    }

    console.log(`[Upload API] User ${user.id} has upload permission and company_id: ${userCompanyId}`);

    const formData = await request.formData()
    const knowledgeBaseId = formData.get("knowledgeBaseId") as string
    const sourceType = formData.get("sourceType") as "file" | "text"
    const sourceName = formData.get("sourceName") as string
    const file = formData.get("file") as File | null
    const content = formData.get("content") as string | null
    const embeddingsProvider = formData.get("embeddingsProvider") as
      | "openai"
      | "local"

    // Hole die Request-ID für Status-Tracking
    requestId = (formData.get("requestId") as string) || `upload-${Date.now()}`

    // Initialisiere Status-Tracking
    initUploadStatus(requestId)
    addUploadLog(
      requestId,
      `Upload für ${sourceType === "file" ? file?.name : "Text"} initialisiert`
    )

    console.log(
      `[Upload API] Received request: KB ID=${knowledgeBaseId}, Type=${sourceType}, Provider=${embeddingsProvider}, File=${file?.name}, Text=${!!content}`
    )
    addUploadLog(
      requestId,
      `Request empfangen: KB=${knowledgeBaseId}, Type=${sourceType}, Provider=${embeddingsProvider}`
    )

    if (
      !knowledgeBaseId ||
      !sourceType ||
      !embeddingsProvider ||
      (!file && !content)
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required form fields (knowledgeBaseId, sourceType, embeddingsProvider, and file or content)"
        },
        { status: 400 }
      )
    }

    let processingContent: string = ""
    let processingSourceName: string = sourceName

    // Timeout-Check nach Parameter-Validierung
    if (timeoutGuard.isTimedOut()) {
      return NextResponse.json(
        { error: "Processing timeout during validation" },
        { status: 408 }
      );
    }

    if (sourceType === "file" && file) {
      processingSourceName = sourceName || file.name
      console.log(`Processing file: ${processingSourceName}`)
      addUploadLog(requestId, `Verarbeite Datei: ${processingSourceName}`)

      updateUploadProgress(
        requestId,
        "extraction",
        10,
        `Extrahiere Text aus Datei: ${processingSourceName}...`
      )

      try {
        const extractedContent = await extractTextFromFile(file, progress => {
          if (progress) {
            updateUploadProgress(
              requestId,
              "extraction",
              Math.min(20, 10 + (progress.percentComplete / 100) * 10),
              `Extrahiere Seite ${progress.currentPage}/${progress.totalPages}...`,
              progress.currentPage,
              progress.totalPages
            )
            addUploadLog(
              requestId,
              `Extrahierte Seite ${progress.currentPage}/${progress.totalPages}`
            )
          }
        })

        // Konvertiere das Ergebnis zu einem String, unabhängig davon, ob es ein String oder Array ist
        if (Array.isArray(extractedContent)) {
          processingContent = extractedContent.join("\n\n");
        } else {
          processingContent = extractedContent;
        }

        addUploadLog(
          requestId,
          `Text erfolgreich extrahiert: ${processingContent.length} Zeichen`
        )
      } catch (extractError: any) {
        console.error("File extraction failed:", extractError)
        addUploadLog(
          requestId,
          `Fehler bei Textextraktion: ${extractError.message}`
        )
        return NextResponse.json(
          { error: `File extraction failed: ${extractError.message}` },
          { status: 500 }
        )
      }
    } else if (sourceType === "text" && content) {
      if (!sourceName) {
        return NextResponse.json(
          { error: "Source name (title) is required for text input." },
          { status: 400 }
        )
      }
      processingSourceName = sourceName
      processingContent = content
      console.log(`Processing text input: ${processingSourceName}`)
      addUploadLog(requestId, `Verarbeite Texteingabe: ${processingSourceName}`)
    } else {
      return NextResponse.json(
        { error: "Missing file or content for the specified source type" },
        { status: 400 }
      )
    }

    // Timeout-Check nach Content-Extraktion
    if (timeoutGuard.isTimedOut()) {
      return NextResponse.json(
        { error: "Processing timeout after content extraction" },
        { status: 408 }
      );
    }

    // Nach der Extraktion und Prüfung des Inhalts
    if (!processingContent || processingContent.trim().length === 0) {
      console.log(
        "[Upload API] Kein Text konnte extrahiert werden, verwende Fallback-Inhalt"
      )
      addUploadLog(
        requestId,
        "Warnung: Kein Inhalt konnte extrahiert werden, verwende Standard-Inhalt"
      )

      processingContent = `Dokument: ${processingSourceName}. Inhalt konnte nicht extrahiert werden, aber die Verarbeitung wird fortgesetzt.`
    }

    console.log(
      `[Upload API] Content extracted, length: ${processingContent.length}, trimmed length: ${processingContent.trim().length}`
    )
    
    // *** SERVERLESS-OPTIMIERTE Text-Längen-Prüfung ***
    const textLength = processingContent.trim().length;
    debugLog(requestId, `Text-Längen-Prüfung: "${processingContent.substring(0, 30)}..." hat Länge ${textLength}`);
    debugLog(requestId, `Prüfung: ${textLength} < ${SERVERLESS_KNOWLEDGE_CONFIG.MIN_TEXT_LENGTH_FOR_EXTRACTION} = ${textLength < SERVERLESS_KNOWLEDGE_CONFIG.MIN_TEXT_LENGTH_FOR_EXTRACTION}`);
    
    // Entfernt: Früher wurde bei sehr kurzen Texten die Faktenextraktion übersprungen
    // und der Text direkt gespeichert. Jetzt wird IMMER extrahiert.

    // *** NEUE SERVERLESS-OPTIMIERTE CHUNKING-LOGIK ***
    updateUploadProgress(
      requestId,
      "chunking",
      25,
      "Verwende intelligentes Chunking für optimale Verarbeitung..."
    )

    console.log(`[Upload API] Starte intelligentes Chunking für ${textLength} Zeichen...`);
    debugLog(requestId, "Text lang genug für intelligentes Chunking, verwende verbesserte Strategie");
    
    // Verwende die verbesserte Chunking-Funktion mit Dateinamen
    const chunks = await chunkTextForKnowledgeBase(processingContent, processingSourceName);
    
    console.log(`[Upload API] Intelligentes Chunking abgeschlossen: ${chunks.length} Chunks erstellt.`);
    addUploadLog(requestId, `Intelligentes Chunking: ${chunks.length} optimierte Chunks erstellt`);

    // Begrenze Chunks für serverless Performance
    const limitedChunks = chunks.slice(0, SERVERLESS_KNOWLEDGE_CONFIG.MAX_CHUNKS_PER_REQUEST);
    if (limitedChunks.length < chunks.length) {
      addUploadLog(requestId, `Chunks für serverless begrenzt: ${limitedChunks.length}/${chunks.length}`);
    }

    // Timeout-Check nach Chunking
    if (timeoutGuard.isTimedOut()) {
      return NextResponse.json(
        { error: "Processing timeout after chunking" },
        { status: 408 }
      );
    }

    // Fortschritt aktualisieren für Faktenextraktion
    updateUploadProgress(
      requestId,
      "facts",
      30,
      `Extrahiere Fakten aus ${limitedChunks.length} intelligenten Chunks...`,
      0,
      limitedChunks.length
    );

    // Erkenne Projektkontext aus Dateinamen (vereinfacht für serverless)
    let projectName = "Allgemein"
    if (
      processingSourceName.includes("Deutscher Bauservi") ||
      processingSourceName.includes("Bauservice")
    ) {
      projectName = "Deutscher Bauservice"
    } else if (processingSourceName.includes("EcomTask")) {
      projectName = "EcomTask"
    }

    try {
      // Fakten aus Chunks parallel in kleinen Batches extrahieren (serverless-kompatibel)
      let allFacts: string[] = [];
      const concurrency = 3; // Klein halten für Vercel Serverless

      for (let start = 0; start < limitedChunks.length; start += concurrency) {
        if (timeoutGuard.isTimedOut()) {
          console.log(`[Upload API] Timeout-Warnung erreicht bei Batch ab Index ${start}`);
          addUploadLog(requestId, `Timeout-Warnung: Stoppe vor Batch ab ${start}`);
          break;
        }

        const batch = limitedChunks.slice(start, start + concurrency);
        const batchIndex = Math.floor(start / concurrency) + 1;
        console.log(`[Upload API] Starte Batch ${batchIndex} mit ${batch.length} Chunks`);
        addUploadLog(requestId, `Starte Batch ${batchIndex} (${batch.length} Chunks) für Faktenextraktion`);

        // Fortschritt grob vor dem Batch
        updateUploadProgress(
          requestId,
          "facts",
          30 + Math.floor((start / limitedChunks.length) * 40),
          `Extrahiere Fakten (Batch ${batchIndex})...`,
          Math.min(start + 1, limitedChunks.length),
          limitedChunks.length
        );

        const results = await Promise.all(
          batch.map((chunk, offset) =>
            extractFactsFromText(
              chunk.content,
              processingSourceName,
              start + offset + 1,
              limitedChunks.length
            ).then(facts => facts.slice(0, SERVERLESS_KNOWLEDGE_CONFIG.MAX_FACTS_PER_CHUNK))
            .catch(err => {
              console.error(`[Upload API] Fehler bei Faktenextraktion (Chunk ${start + offset + 1}):`, err);
              addUploadLog(requestId, `Fehler bei Faktenextraktion in Chunk ${start + offset + 1}`);
              return [] as string[];
            })
          )
        );

        // Fortschritt nach dem Batch
        updateUploadProgress(
          requestId,
          "facts",
          30 + Math.floor(((start + batch.length) / limitedChunks.length) * 40),
          `Batch ${batchIndex} abgeschlossen`,
          Math.min(start + batch.length, limitedChunks.length),
          limitedChunks.length
        );

        for (let i = 0; i < results.length; i++) {
          const chunkNumber = start + i + 1;
          const facts = results[i];
          console.log(`[Upload API] ${facts.length} Fakten aus Chunk ${chunkNumber} extrahiert.`);
          addUploadLog(requestId, `${facts.length} Fakten aus Chunk ${chunkNumber} extrahiert`);
          allFacts.push(...facts);
        }
      }

      console.log(
        `[Upload API] Gesamtergebnis: ${allFacts.length} Fakten extrahiert.`
      )
      addUploadLog(
        requestId,
        `Insgesamt wurden ${allFacts.length} Fakten extrahiert`
      )

      if (allFacts.length === 0) {
        addUploadLog(
          requestId,
          "Fehler: Es konnten keine Fakten aus dem Dokument extrahiert werden"
        )
        return NextResponse.json(
          {
            error: "Es konnten keine Fakten aus dem Dokument extrahiert werden."
          },
          { status: 400 }
        )
      }

      // Duplikate entfernen (vereinfacht für serverless)
      const uniqueFacts = [...new Set(allFacts)]
      console.log(
        `[Upload API] ${uniqueFacts.length} einzigartige Fakten nach Duplikatsentfernung.`
      )
      addUploadLog(
        requestId,
        `${uniqueFacts.length} einzigartige Fakten nach Duplikatsentfernung`
      )

      // Timeout-Check vor Embeddings
      if (timeoutGuard.isTimedOut()) {
        return NextResponse.json(
          { error: "Processing timeout before embeddings" },
          { status: 408 }
        );
      }

      // Fortschritt aktualisieren für Embedding-Phase
      updateUploadProgress(
        requestId,
        "embedding",
        70,
        `Erzeuge Embeddings für ${uniqueFacts.length} Fakten...`,
        0,
        uniqueFacts.length
      )

      // Embeddings für jeden Fakt generieren und speichern (serverless-optimiert)
      const savedItems = []
      let failedCount = 0

      for (let i = 0; i < uniqueFacts.length; i++) {
        const fact = uniqueFacts[i]
        try {
          // Timeout-Check
          if (timeoutGuard.isTimedOut()) {
            console.log(`[Upload API] Timeout-Warnung bei Embedding ${i + 1}/${uniqueFacts.length}`);
            break;
          }

          // Fortschritt für Embeddings
          updateUploadProgress(
            requestId,
            "embedding",
            70 + Math.floor((i / uniqueFacts.length) * 20),
            `Erzeuge Embedding für Fakt ${i + 1}/${uniqueFacts.length}...`,
            i + 1,
            uniqueFacts.length
          )

          // Embedding generieren
          const embedding = await generateEmbeddings(
            [{ content: fact, tokens: 0 }],
            embeddingsProvider
          )

          if (!embedding || !embedding[0]) {
            console.error(
              `Failed to generate embedding for fact: ${fact.substring(0, 50)}...`
            )
            addUploadLog(
              requestId,
              `Fehler beim Generieren von Embedding für Fakt: ${fact.substring(0, 50)}...`
            )
            failedCount++
            continue
          }

          // Embedding formatieren
          const embeddingString = `[${embedding[0].join(",")}]`

          // In DB speichern
          // ✅ COMPANY SHARING: company_id wird bei INSERT mitgegeben
          const { data, error } = await supabase
            .from("knowledge_items")
            .insert({
              content: fact,
              knowledge_base_id: knowledgeBaseId,
              user_id: user.id,
              company_id: userCompanyId, // ✅ COMPANY SHARING: company_id hinzugefügt
              source_type: sourceType,
              source_name: processingSourceName,
              openai_embedding:
                embeddingsProvider === "openai" ? embeddingString : null,
              local_embedding:
                embeddingsProvider === "local" ? embeddingString : null,
              tokens: Math.ceil(fact.length / 4),
              fact_type: null
            })
            .select()

          if (error) {
            console.error(`Error saving fact: ${error.message}`)
            addUploadLog(
              requestId,
              `Fehler beim Speichern eines Fakts: ${error.message}`
            )
            failedCount++
          } else {
            savedItems.push(data[0])
          }
        } catch (error) {
          console.error("Error processing fact:", error)
          addUploadLog(
            requestId,
            `Fehler bei der Verarbeitung eines Fakts: ${error}`
          )
          failedCount++
        }
      }

      console.log(
        `[Upload API] Successfully saved ${savedItems.length} facts, ${failedCount} failed`
      )
      addUploadLog(
        requestId,
        `Erfolgreich ${savedItems.length} Fakten gespeichert, ${failedCount} fehlgeschlagen`
      )

      // Cleanup
      timeoutGuard.clear();

      // Finales Ergebnis
      const result = {
        message: `Successfully processed and added ${savedItems.length} facts to knowledge base ${knowledgeBaseId}`,
        factsCount: uniqueFacts.length,
        savedCount: savedItems.length,
        failedCount: failedCount,
        facts: savedItems.map(item => item.content),
        processingDuration: Date.now() - startTime
      }

      // Abschließen des Status-Trackings
      completeUpload(requestId, result)

      return NextResponse.json(result, { status: 201 })
    } catch (error: any) {
      console.error("[Upload API] Facts extraction failed:", error)
      addUploadLog(
        requestId,
        `Fehler bei der Faktenextraktion: ${error.message}`
      )
      return NextResponse.json(
        {
          error: `Failed to extract facts: ${error.message}`
        },
        { status: 500 }
      )
    }
  } catch (error: any) {
    timeoutGuard.clear();
    console.error("[Upload API] Unhandled error in POST handler:", error)
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred."

    if (requestId) {
      addUploadLog(requestId, `Unbehandelter Fehler: ${message}`)
    }

    return NextResponse.json(
      { error: `An unexpected error occurred: ${message}` },
      { status: 500 }
    )
  }
}
