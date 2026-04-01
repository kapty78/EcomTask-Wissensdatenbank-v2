import {
  KnowledgeUploadProgress,
  UploadProgressStage,
  UploadStatus
} from "@/types"

// In-Memory-Speicher für laufende Upload-Status
// In einer produktiven Anwendung würde man dies besser in einer Datenbank oder Redis speichern
const uploadStatus = new Map<
  string,
  {
    status: boolean
    completed: boolean
    progress: {
      stage:
        | "extraction"
        | "chunking"
        | "facts"
        | "embedding"
        | "saving"
        | "complete"
      currentItem?: number
      totalItems?: number
      percentComplete?: number
      message: string
    }
    logs: string[]
    lastLogIndex: number // Index des letzten abgerufenen Logs
    result?: any
  }
>()

// Typen für den auftragsbasierten Upload-Status
export type RequestId = string

// Statusupdate für einen laufenden Upload setzen
export function setUploadStatus(requestId: string, status: any) {
  const existingStatus = uploadStatus.get(requestId)

  // Behalte vorhandene Logs, wenn bereits ein Status existiert
  const updatedStatus = {
    ...status,
    logs: existingStatus ? existingStatus.logs : status.logs || [],
    lastLogIndex: existingStatus ? existingStatus.lastLogIndex : 0
  }

  // Stellen wir sicher, dass der Fortschritt nicht zurückgeht
  if (existingStatus && existingStatus.progress && updatedStatus.progress) {
    // Behalte den höheren Prozentsatz, es sei denn, die Phase ist fortgeschritten
    if (
      existingStatus.progress.percentComplete &&
      updatedStatus.progress.percentComplete &&
      updatedStatus.progress.percentComplete <
        existingStatus.progress.percentComplete
    ) {
      // Definiere die Reihenfolge der Phasen
      const stageOrder = [
        "extraction",
        "chunking",
        "facts",
        "embedding",
        "saving",
        "complete"
      ]
      const existingStageIndex = stageOrder.indexOf(
        existingStatus.progress.stage
      )
      const newStageIndex = stageOrder.indexOf(updatedStatus.progress.stage)

      // Wenn die Phase gleich ist oder fortgeschritten ist, aber der Prozentsatz niedriger,
      // behalten wir den höheren Prozentsatz bei
      if (newStageIndex >= existingStageIndex) {
        updatedStatus.progress.percentComplete =
          existingStatus.progress.percentComplete
      }
    }
  }

  uploadStatus.set(requestId, updatedStatus)

  // Alte Einträge nach 30 Minuten entfernen
  setTimeout(
    () => {
      uploadStatus.delete(requestId)
    },
    30 * 60 * 1000
  )
}

// Aktuellen Status abrufen
export function getUploadStatus(requestId: string) {
  return uploadStatus.get(requestId)
}

// Neuen Log-Eintrag hinzufügen
export function addUploadLog(requestId: string, log: string) {
  const status = uploadStatus.get(requestId)
  if (status) {
    // Vermeide Duplikate im Log
    if (!status.logs.includes(log)) {
      status.logs.push(log)
    }
    uploadStatus.set(requestId, status)
  }
}

// Upload als abgeschlossen markieren mit Ergebnis
export function completeUpload(requestId: string, result: any) {
  const status = uploadStatus.get(requestId)
  if (status) {
    status.completed = true
    status.result = result
    status.progress.stage = "complete"
    status.progress.percentComplete = 100
    addUploadLog(
      requestId,
      `Verarbeitung abgeschlossen! ${result.factsCount || 0} Fakten extrahiert und ${result.savedCount || 0} gespeichert.`
    )
    uploadStatus.set(requestId, status)
  }
}

// Update für den Fortschritt
export function updateUploadProgress(
  requestId: string,
  stage:
    | "extraction"
    | "chunking"
    | "facts"
    | "embedding"
    | "saving"
    | "complete",
  percentComplete: number,
  message: string,
  currentItem?: number,
  totalItems?: number
) {
  const status = uploadStatus.get(requestId)
  if (status) {
    // Verhindern, dass der Fortschritt zurückgeht
    let adjustedPercentComplete = percentComplete

    if (status.progress && status.progress.percentComplete) {
      // Nur Fortschritt aktualisieren, wenn er höher ist oder die Phase fortgeschritten ist
      const stageOrder = [
        "extraction",
        "chunking",
        "facts",
        "embedding",
        "saving",
        "complete"
      ]
      const currentStageIndex = stageOrder.indexOf(status.progress.stage)
      const newStageIndex = stageOrder.indexOf(stage)

      if (newStageIndex > currentStageIndex) {
        // Wenn wir zu einer neuen Phase übergehen, stellen wir sicher, dass wir mindestens
        // einen bestimmten Mindestprozentsatz haben:
        if (stage === "chunking" && adjustedPercentComplete < 20)
          adjustedPercentComplete = 20
        if (stage === "facts" && adjustedPercentComplete < 30)
          adjustedPercentComplete = 30
        if (stage === "embedding" && adjustedPercentComplete < 70)
          adjustedPercentComplete = 70
        if (stage === "saving" && adjustedPercentComplete < 90)
          adjustedPercentComplete = 90
        if (stage === "complete") adjustedPercentComplete = 100
      } else if (
        newStageIndex === currentStageIndex &&
        adjustedPercentComplete < status.progress.percentComplete
      ) {
        // Innerhalb der gleichen Phase, niemals zurückgehen
        adjustedPercentComplete = status.progress.percentComplete
      }
    }

    status.progress = {
      stage,
      percentComplete: adjustedPercentComplete,
      message,
      currentItem,
      totalItems
    }

    // Bei Embedding-Phase, setze auf mindestens 70%
    if (stage === "embedding" && adjustedPercentComplete < 70) {
      status.progress.percentComplete = 70
    }

    // Bei Speicher-Phase, setze auf mindestens 90%
    if (stage === "saving" && adjustedPercentComplete < 90) {
      status.progress.percentComplete = 90
    }

    // Bei Complete-Phase, setze immer auf 100%
    if (stage === "complete") {
      status.progress.percentComplete = 100
    }

    uploadStatus.set(requestId, status)
  }
}

// Initialisiert einen neuen Upload-Status
export function initUploadStatus(requestId: string) {
  const initialStatus = {
    status: true,
    completed: false,
    progress: {
      stage: "extraction" as const,
      percentComplete: 5,
      message: "Initialisiere Verarbeitung..."
    },
    logs: ["Upload initialisiert"],
    lastLogIndex: 0
  }

  uploadStatus.set(requestId, initialStatus)
  return initialStatus
}

// Falls wir getUploadStatus mit direktem RequestId-Wert aufrufen müssen
// ohne URL-Parameter (z.B. für interne Aufrufe)
export function getStatusByRequestId(requestId: string) {
  const status = uploadStatus.get(requestId)
  if (!status) {
    return {
      status: false,
      message: "Kein Upload-Status für diese Request ID gefunden"
    }
  }

  return status
}

// Export the utility functions for use in other files
export const uploadStatusUtils = {
  setUploadStatus,
  getUploadStatus,
  addUploadLog,
  completeUpload,
  updateUploadProgress,
  initUploadStatus,
  getStatusByRequestId
}
