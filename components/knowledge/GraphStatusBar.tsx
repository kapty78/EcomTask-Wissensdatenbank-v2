"use client"

/**
 * Statuszeile über dem Knowledge Graph.
 * =====================================================================
 * Beantwortet die Frage, die man bisher nur per SQL beantworten konnte:
 * "Steht in meinem Graphen das, was in meiner Wissensdatenbank steht?"
 *
 * Der entscheidende Vergleich ist "letzte Extraktion vs. jüngster Fakt" —
 * genau der hat bei USD Reisen den 1,5-Tage-Rückstand und die 16 nie
 * extrahierten Dokumente sichtbar gemacht.
 *
 * Farbdisziplin nach den UI-Regeln: kein Grün/Gelb. Aktuell = neutral,
 * Rückstand = Pink-Akzent, Fehler = Rot. Keine Popups — der Fehlertext
 * klappt inline auf.
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"

import { apiFetch } from "@/lib/api-fetch"

interface GraphStatus {
  up_to_date: boolean
  lags_behind: boolean
  entities: number
  relations: number
  communities: number
  documents_total: number
  documents_pending: number
  jobs_queued: number
  jobs_running: number
  jobs_failed: number
  last_extraction: string | null
  newest_fact: string | null
  last_error: string | null
}

interface Props {
  knowledgeBaseId: string
  /** Wird nach einem angestoßenen Neuaufbau gerufen, damit der Graph neu lädt. */
  onRebuildStarted?: () => void
}

function formatWhen(iso: string | null): string {
  if (!iso) return "nie"
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return "gerade eben"
  if (mins < 60) return `vor ${mins} min`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `vor ${hrs} h`
  return `vor ${Math.round(hrs / 24)} Tagen`
}

export default function GraphStatusBar({ knowledgeBaseId, onRebuildStarted }: Props) {
  const [status, setStatus] = useState<GraphStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/knowledge/graph/status?knowledge_base_id=${knowledgeBaseId}`
      )
      if (!res.ok) return
      setStatus(await res.json())
    } catch {
      /* Statuszeile darf nie die Ansicht kippen */
    }
  }, [knowledgeBaseId])

  useEffect(() => {
    load()
  }, [load])

  // Solange Aufträge laufen, öfter nachsehen — sonst bleibt es ruhig.
  useEffect(() => {
    if (!status) return
    const working = status.jobs_queued > 0 || status.jobs_running > 0
    const interval = setInterval(load, working ? 5000 : 60000)
    return () => clearInterval(interval)
  }, [status, load])

  const rebuild = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await apiFetch("/api/knowledge/graph/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledge_base_id: knowledgeBaseId }),
      })
      const data = await res.json()
      setMessage(
        res.ok
          ? data.message || "Neuaufbau gestartet."
          : data.error || "Neuaufbau fehlgeschlagen."
      )
      if (res.ok) {
        onRebuildStarted?.()
        load()
      }
    } catch {
      setMessage("Neuaufbau fehlgeschlagen.")
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null

  const working = status.jobs_queued > 0 || status.jobs_running > 0
  const hasProblem = status.jobs_failed > 0

  let headline: string
  if (working) {
    headline = `${status.jobs_running + status.jobs_queued} Dokumente in Arbeit`
  } else if (status.entities === 0) {
    headline = "Noch kein Graph aufgebaut"
  } else if (status.documents_pending > 0) {
    headline = `${status.documents_pending} von ${status.documents_total} Dokumenten fehlen im Graphen`
  } else if (status.lags_behind) {
    headline = "Neues Wissen noch nicht im Graphen"
  } else {
    headline = `Aktuell — Stand ${formatWhen(status.last_extraction)}`
  }

  const dotClass = working
    ? "bg-primary animate-pulse"
    : status.up_to_date
      ? "bg-white/30"
      : "bg-primary"

  return (
    <div className="flex flex-col gap-1.5 bg-[#1e1e1e]/80 backdrop-blur-sm border border-white/[0.06] rounded-lg px-3 py-2">
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-[11px] text-white/55 truncate">{headline}</span>

        {hasProblem && (
          <button
            onClick={() => setShowDetail((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-red-400/80 hover:text-red-400 transition-colors flex-shrink-0"
            title="Fehlerdetails anzeigen"
          >
            <AlertTriangle className="size-3" />
            {status.jobs_failed}
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={rebuild}
          disabled={busy || working}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-white/45 hover:text-white/75 hover:bg-white/[0.05] disabled:opacity-30 disabled:hover:bg-transparent transition-colors flex-shrink-0"
          title="Graph komplett neu aufbauen — manuell gepflegte Verknüpfungen bleiben erhalten"
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          Neu aufbauen
        </button>
      </div>

      {(showDetail || message) && (
        <div className="text-[10px] text-white/35 leading-relaxed border-t border-white/[0.05] pt-1.5">
          {message && <div className="text-white/55">{message}</div>}
          {showDetail && status.last_error && (
            <div className="text-red-400/70 font-mono break-all">{status.last_error}</div>
          )}
          {showDetail && (
            <div>
              Jüngster Fakt {formatWhen(status.newest_fact)} · letzte Extraktion{" "}
              {formatWhen(status.last_extraction)} · {status.communities} Themen
            </div>
          )}
        </div>
      )}
    </div>
  )
}
