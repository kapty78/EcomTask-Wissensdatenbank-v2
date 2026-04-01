import { NextResponse } from "next/server"
import { uploadStatusUtils } from "./utils"

// Mark this route as dynamic since it uses request.url
export const dynamic = 'force-dynamic'

// API-Route für Statusabfragen - Korrigierte Version
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const requestId = url.searchParams.get("requestId")

    if (!requestId) {
      return NextResponse.json(
        {
          error: "Request ID fehlt"
        },
        { status: 400 }
      )
    }

    console.log(`[STATUS API] Status abgerufen für Request ID: ${requestId}`)

    const status = uploadStatusUtils.getUploadStatus(requestId)

    if (!status) {
      console.log(
        `[STATUS API] Kein Status gefunden für Request ID: ${requestId}`
      )

      // Erstelle einen standardmäßigen "Warte"-Status, anstatt 404 zurückzugeben
      const waitingStatus = {
        status: true,
        completed: false,
        progress: {
          stage: "extraction" as const,
          percentComplete: 5,
          message: "Upload wird initialisiert..."
        },
        logs: ["Warten auf den Start der Verarbeitung"],
        lastLogIndex: 0
      }

      return NextResponse.json(waitingStatus)
    }

    // Bei der Rückgabe, speichere den aktuellen Log-Index für den nächsten Aufruf
    const currentLogCount = status.logs.length
    const lastLogIndex = status.lastLogIndex || 0

    // Nur neue Logs senden, die seit dem letzten Abruf hinzugekommen sind
    const newLogs = status.logs.slice(lastLogIndex)

    // Update lastLogIndex für nächsten Aufruf
    status.lastLogIndex = currentLogCount
    uploadStatusUtils.setUploadStatus(requestId, status)

    // Angepasste Statusantwort mit nur neuen Logs
    const responseStatus = {
      ...status,
      logs: newLogs
    }

    return NextResponse.json(responseStatus)
  } catch (error) {
    console.error("[STATUS API] Fehler beim Abrufen des Upload-Status:", error)
    return NextResponse.json(
      {
        status: false,
        error: "Interner Serverfehler beim Abrufen des Upload-Status"
      },
      { status: 500 }
    )
  }
}
