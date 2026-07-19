"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, Loader2, XCircle } from "lucide-react"
import type { AgentRichBlock, ToolActivity } from "../types"
import { MarkdownMessage } from "./MarkdownMessage"
import { AgentTrace } from "../AgentTrace"
import { LogoSpinner } from "@/components/DynamicLogo"
import { useLanguage } from "@/contexts/LanguageContext"

type ConfirmationBlockData = AgentRichBlock & { type: "confirmation" }

/** UUIDv4 mit crypto.randomUUID() wenn verfuegbar; fallback fuer aeltere
 * Browser via crypto.getRandomValues. Wird pro Mount EINMAL erzeugt, damit
 * Doppelklicks / Strict-Mode-Doppelrenders / Browser-Auto-Retries den
 * gleichen action_id-Wert wiederverwenden und der Server dedupen kann. */
function makeActionId(): string {
  if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
    return (crypto as any).randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Normalisiert die toolActivities-Liste aus dem execute-action-Response in
 * das ToolActivity-Format, das <AgentTrace/> rendert. Server schickt die
 * Felder grob im gleichen Format wie der SSE-Stream, wir defensiv-validieren
 * trotzdem (unterschiedliche Server-Versionen, fehlende optionale Felder). */
function normalizeServerActivities(raw: any, defaultActionLabel: string, defaultStepLabel: string): ToolActivity[] | null {
  if (!Array.isArray(raw)) return null
  const out: ToolActivity[] = []
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] || {}
    const status: "running" | "done" | "error" =
      a.status === "running" || a.status === "error" ? a.status : "done"
    out.push({
      id: typeof a.id === "string" && a.id ? a.id : `tool-${i}`,
      label: typeof a.label === "string" ? a.label : (typeof a.tool === "string" ? a.tool : defaultActionLabel),
      tool: typeof a.tool === "string" ? a.tool : undefined,
      status,
      error: typeof a.error === "string" ? a.error : undefined,
      details: a.details && typeof a.details === "object" ? a.details : undefined,
      startedAt: typeof a.startedAt === "number" ? a.startedAt : undefined,
      endedAt: typeof a.endedAt === "number" ? a.endedAt : undefined,
      subActivities: Array.isArray(a.subActivities)
        ? a.subActivities.map((s: any, j: number) => ({
            id: typeof s.id === "string" && s.id ? s.id : `sub-${i}-${j}`,
            label: typeof s.label === "string" ? s.label : (typeof s.tool === "string" ? s.tool : defaultStepLabel),
            tool: typeof s.tool === "string" ? s.tool : undefined,
            agent: typeof s.agent === "string" ? s.agent : undefined,
            status: s.status === "running" || s.status === "error" ? s.status : "done",
            error: typeof s.error === "string" ? s.error : undefined,
            details: s.details && typeof s.details === "object" ? s.details : undefined,
            startedAt: typeof s.startedAt === "number" ? s.startedAt : undefined,
            endedAt: typeof s.endedAt === "number" ? s.endedAt : undefined,
          }))
        : undefined,
    })
  }
  return out
}

interface ConfirmationBlockProps {
  block: ConfirmationBlockData
  blockIndex: number
  isThinking: boolean
  onSubmitMessage: (msg: string) => Promise<void>
  conversationId?: string | null
  getAuthToken?: () => Promise<string | null>
  /** Vom Parent ermittelt: gibt es schon eine User-Antwort auf diesen
   * Confirmation-Block (z.B. "Ja, fuehre den Plan aus." in der naechsten
   * User-Message)? Dann werden die Buttons sofort durch den decided-State
   * ersetzt — verhindert dass der User mehrfach klicken kann oder dass
   * nach einem Reload die Buttons wieder aktiv sind. */
  alreadyDecided?: "confirmed" | "cancelled" | null
  /** Vom Parent ermittelt: der via plan_execute gestartete Chat-Lauf hat
   * eine fertige Assistant-Antwort produziert. Loest den "wird
   * ausgefuehrt…"-Spinner auf, der sonst ewig weiterdrehen wuerde
   * (USD-Befund 2026-07-02). */
  planRunFinished?: boolean
}

export function ConfirmationBlock({ block, blockIndex, isThinking, onSubmitMessage, conversationId, getAuthToken, alreadyDecided, planRunFinished }: ConfirmationBlockProps) {
  const { t } = useLanguage()
  // Persistierte Entscheidung direkt am Block (execute-action schreibt
  // block.decision server-seitig ins rich_content, sobald die Direkt-Aktion
  // gelaufen ist). Hat Vorrang vor der Parent-Heuristik alreadyDecided und
  // ueberlebt — anders als der lokale State — jeden Remount durch
  // Realtime-Refetch oder Conversation-Reload.
  const persistedDecision =
    block.decision === "confirmed" || block.decision === "cancelled" ? block.decision : null
  const initialDecision = persistedDecision ?? alreadyDecided ?? null
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [decided, setDecided] = useState<"confirmed" | "cancelled" | null>(initialDecision)
  const [actionResult, setActionResult] = useState<string | null>(
    initialDecision === "confirmed" ? t('agentChatBlocks.confirmation.alreadyExecuted') : initialDecision === "cancelled" ? t('agentChatBlocks.confirmation.alreadyCancelled') : null
  )
  /** Live-Trace-Activities fuer den AgentTrace-Frame. Wird beim Klick mit
   * einem synthetischen "running"-Eintrag initialisiert und nach dem
   * execute-action-Response mit den echten Sub-Agent-Activities ersetzt. */
  const [traceActivities, setTraceActivities] = useState<ToolActivity[] | null>(null)
  /** True solange wir auf das execute-action-Response warten — steuert den
   * Streaming-State des AgentTrace (Spinner + tickender Timer). */
  const [traceStreaming, setTraceStreaming] = useState(false)
  /** Status der gerade ausgefuehrten Aktion. Wichtig fuer die Header-Zeile:
   * bei "error" muss "fehlgeschlagen" statt "erledigt" stehen (Codex P2).
   * 'idle' = noch nichts gestartet bzw. plan_execute-Pfad (eigener UX-Flow). */
  const [actionState, setActionState] = useState<"idle" | "running" | "success" | "error" | "in_flight">("idle")

  // Stabile action_id pro Confirmation-Block-Mount. Wird mit jedem
  // execute-action-POST mitgesendet; Server cached das Tool-Result unter
  // diesem Key. Dadurch fuehren Doppelklicks (auch knapp vor setState-
  // Sichtbarkeit), React-StrictMode-Effekt-Doppelinvocation, Tab-Reload-
  // Retries und Browser-Auto-Retries auf demselben Block nicht zu
  // doppelten Sub-Agent-Aufrufen. Zusaetzlich greift server-seitig ein
  // content_hash-Lookup, der auch dann dedupliziert, wenn der Orchestrator
  // denselben Confirmation-Block in zwei Turns mit unterschiedlichen
  // action_ids gerendert hat.
  const actionIdRef = useRef<string>("")
  if (!actionIdRef.current) actionIdRef.current = makeActionId()

  // Hard-Gate gegen Race zwischen zwei schnellen Klicks: setState ist asynchron,
  // also kann der zweite Klick noch den `isSubmitting`-Check passieren bevor
  // der erste den State sichtbar gemacht hat. useRef ist synchron lesbar.
  const inFlightRef = useRef<boolean>(false)

  // Wenn die Entscheidung nachtraeglich kommt (z.B. Live-Polling laedt eine
  // User-Bestaetigungs-Message oder das server-seitig markierte
  // block.decision NACH dem Initial-Mount), den State nachziehen.
  // Lokale Klicks (decided !== null und actionResult !== null) NICHT
  // ueberschreiben — sonst wuerden wir die Echtzeit-Antwort flackern lassen.
  useEffect(() => {
    const incoming = persistedDecision ?? alreadyDecided
    if (!incoming) return
    if (decided) return
    setDecided(incoming)
    setActionResult(incoming === "confirmed" ? t('agentChatBlocks.confirmation.alreadyExecuted') : t('agentChatBlocks.confirmation.alreadyCancelled'))
  }, [persistedDecision, alreadyDecided, decided])

  // plan_execute laeuft als Chat-Message weiter — der Block selbst bekommt
  // kein Response. Sobald der Parent meldet, dass der Lauf eine fertige
  // Assistant-Antwort produziert hat, den Spinner aufloesen; sonst dreht
  // "wird ausgefuehrt…" fuer immer weiter, obwohl das Ergebnis laengst im
  // Chat steht (USD-Befund 2026-07-02).
  useEffect(() => {
    if (!planRunFinished) return
    if (actionState !== "running") return
    if (block.confirmAction?.tool !== "plan_execute") return
    setActionState("success")
    setActionResult(decided === "cancelled" ? t('agentChatBlocks.confirmation.planCancelled') : t('agentChatBlocks.confirmation.planExecutedSeeHistory'))
  }, [planRunFinished, actionState, block.confirmAction?.tool, decided])

  const confirmLabel = block.confirmLabel || t('agentChatBlocks.confirmation.confirmDefaultLabel')
  const cancelLabel = block.cancelLabel || t('general.cancel')
  const responsePrefix = (block.responsePrefix || t('agentChatBlocks.confirmation.decisionDefaultPrefix')).trim()

  const executeDirectAction = async (action: { tool: string; args: Record<string, any> }) => {
    const token = getAuthToken ? await getAuthToken() : null
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (token) headers["Authorization"] = `Bearer ${token}`

    const res = await fetch("/api/support-agent/execute-action", {
      method: "POST",
      headers,
      body: JSON.stringify({
        tool: action.tool,
        args: action.args,
        conversationId,
        actionId: actionIdRef.current,
      }),
    })
    const data = await res.json()
    // 409 = inFlight: ein paralleler Klick auf semantisch identische Aktion
    // haelt die Pending-Reservierung. Das ist KEIN Fehler, sondern erwartet
    // (z.B. wenn der Orchestrator denselben Confirmation-Block zweimal
    // gerendert hat). Der Caller rendert dafuer einen freundlichen Hinweis
    // statt einer roten Fehlermeldung.
    if (res.status === 409 && data?.inFlight) {
      return { __inFlight: true, message: data?.error || t('agentChatBlocks.confirmation.actionInFlight') }
    }
    if (!res.ok) throw new Error(data.error || t('agentChatBlocks.common.executionFailed'))
    return data
  }

  const handleDecision = async (choice: "confirmed" | "cancelled") => {
    if (isThinking || isSubmitting || decided) return
    // useRef-Lock: synchron sichtbar, blockiert Doppelklicks zuverlaessig
    // bevor der naechste Render setIsSubmitting/setDecided sichtbar macht.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setIsSubmitting(true)
    setDecided(choice)
    try {
      if (choice === "confirmed" && block.confirmAction?.tool === "plan_execute") {
        // Plan execution: send as CHAT MESSAGE so it runs through the SSE
        // streaming flow. The user sees every sub-agent step live (tool_start,
        // tool_done events) — just like watching an agent work in Cursor.
        // WICHTIG: actionState='running' setzen, sonst zeigt der Header
        // faelschlich "erledigt" sobald actionResult gesetzt ist, obwohl
        // der Plan-Run im Hauptchat noch lange laeuft.
        setActionState("running")
        setActionResult(t('agentChatBlocks.confirmation.planRunningInChat'))
        // NOTE: this literal German phrase is a backend-matched intent trigger
        // (the parent derives `alreadyDecided` by scanning for this exact text
        // in the next user message) — intentionally NOT localized, see
        // skippedFindings for this i18n pass.
        await onSubmitMessage("Ja, führe den Plan aus.")
      } else if (choice === "cancelled" && block.confirmAction?.tool === "plan_execute") {
        // Cancel: also through the chat so the orchestrator handles it
        setActionState("running")
        setActionResult(t('agentChatBlocks.confirmation.planCancelling'))
        // NOTE: same as above — literal phrase matched server/parent-side, not localized.
        await onSubmitMessage("Nein, brich den Plan ab.")
      } else if (choice === "confirmed" && block.confirmAction?.tool) {
        // Non-plan direct actions (z.B. KB-Chunk anlegen, audit_undo) laufen
        // ueber REST, aber wir spiegeln den UX-Look des SSE-Flows: ein
        // synthetisches "running"-Trace-Item ab Klick, ersetzt nach dem
        // Response durch die echten Sub-Activity-Eintraege vom Server.
        const liveLabel = (() => {
          const toolName = block.confirmAction.tool
          const m = toolName.match(/^call_(.+)_agent$/)
          if (m) {
            const agentKey = m[1]
            const labels: Record<string, string> = {
              knowledge: t('agentChatCore.insight.typeKb'),
              knowledge_base: t('agentChatBlocks.confirmation.agentKnowledgeManagement'),
              mail: t('agentChatBlocks.confirmation.agentMail'),
              website: t('agentChatBlocks.confirmation.agentWebsite'),
              phone: t('agentChatBlocks.confirmation.agentPhone'),
              internal: t('agentChatBlocks.confirmation.agentInternal'),
              dashboard: t('agentChatBlocks.confirmation.agentDashboard'),
              follow_up: t('agentChatBlocks.confirmation.agentFollowUp'),
              task: t('agentChatBlocks.confirmation.agentTask'),
              tool_builder: t('agentChatBlocks.confirmation.agentToolBuilder'),
              trend: t('agentChatBlocks.confirmation.agentTrend'),
              account: t('agentChatBlocks.confirmation.agentAccount'),
              memory: t('agentChatBlocks.confirmation.agentMemory'),
              planner: t('agentChatBlocks.confirmation.agentPlanner'),
              analytics: t('agentChatBlocks.confirmation.agentAnalytics'),
            }
            return `${labels[agentKey] || agentKey}: ${confirmLabel}`
          }
          if (toolName === "audit_undo") return t('agentChatBlocks.confirmation.auditUndoLabel')
          return `${confirmLabel}`
        })()
        setTraceStreaming(true)
        setActionState("running")
        setTraceActivities([
          {
            id: actionIdRef.current,
            label: liveLabel,
            status: "running",
            tool: block.confirmAction.tool,
            startedAt: Date.now(),
          },
        ])
        const data = await executeDirectAction(block.confirmAction)
        // 409 inFlight: ein paralleler Klick laeuft schon — wir zeigen einen
        // freundlichen Hinweis statt Fehler. Kein actionResult mit
        // "Fehler:"-Prefix, kein roter Header.
        if (data?.__inFlight) {
          setTraceStreaming(false)
          setTraceActivities((prev) => {
            if (!prev) return prev
            return prev.map((a) =>
              a.status === "running" ? { ...a, status: "done", endedAt: Date.now() } : a
            )
          })
          setActionState("in_flight")
          setActionResult(String(data.message))
          return
        }
        const result = data?.result
        const serverActivities = normalizeServerActivities(data?.toolActivities, t('agentChatBlocks.common.actionLabel'), t('agentChatBlocks.confirmation.stepFallback'))
        const isFailure = result && typeof result === "object" && result.ok === false
        const resultText =
          typeof result?.agent_response === "string" ? result.agent_response
          : typeof result?.message === "string" ? result.message
          : data?.deduplicated === true ? t('agentChatBlocks.confirmation.actionAlreadyExecutedDedup')
          : isFailure ? `${t('agentChatCore.trace.errorLabel')} ${result?.error?.message || `${t('agentChatBlocks.common.executionFailed')}.`}`
          : result?.ok === true ? t('agentChatBlocks.common.actionSucceeded')
          : t('agentChatBlocks.common.actionExecuted')
        setTraceActivities(serverActivities && serverActivities.length > 0 ? serverActivities : (prev) => {
          // Fallback: Server hat keine Activities geschickt (z.B. Idempotency-
          // Cache-Hit). Markiere den Pseudo-Eintrag als "done"/"error" je
          // nach Result, damit der Trace nicht in running-Endlosspinner haengt.
          if (!prev) return prev
          return prev.map((a) =>
            a.status === "running"
              ? { ...a, status: isFailure ? "error" : "done", endedAt: Date.now(), error: isFailure ? (result?.error?.message || undefined) : undefined }
              : a
          )
        })
        setTraceStreaming(false)
        setActionState(isFailure ? "error" : "success")
        setActionResult(resultText)
      } else {
        // Fallback: send as user message
        await onSubmitMessage(`${responsePrefix}: ${choice === "confirmed" ? confirmLabel : cancelLabel}`)
      }
    } catch (err: any) {
      setTraceStreaming(false)
      setTraceActivities((prev) => {
        if (!prev) return prev
        return prev.map((a) =>
          a.status === "running"
            ? { ...a, status: "error", error: err?.message || t('agentChatBlocks.common.unknownError'), endedAt: Date.now() }
            : a
        )
      })
      setActionState("error")
      setActionResult(`${t('agentChatCore.trace.errorLabel')} ${err?.message || t('agentChatBlocks.common.unknownError')}`)
    } finally {
      setIsSubmitting(false)
      // inFlightRef ist Race-Schutz fuer den seltenen Doppelklick vor dem
      // ersten Render-Cycle (siehe Initialisierungs-Kommentar). Nach dem
      // ersten setState-Cycle uebernimmt `decided` als primaerer Guard.
      // Wir setzen den Lock dennoch zurueck, damit der Block intern self-
      // consistent ist — z.B. fuer den hypothetischen Fall, dass `decided`
      // via alreadyDecided-useEffect zurueckgesetzt werden wuerde (aktuell
      // nicht der Fall, aber so haengen wir nicht auf eine implementation-
      // detail-Annahme).
      inFlightRef.current = false
    }
  }

  return (
    <div key={`confirmation-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-4.5 shrink-0 mt-0.5 text-muted-foreground/50" />
        <div className="min-w-0 space-y-1">
          <div className="text-[13px] font-medium text-foreground/90">{block.title}</div>
          {block.description && (
            <div className="text-[12px] leading-relaxed text-foreground/60">
              <MarkdownMessage content={block.description} />
            </div>
          )}
        </div>
      </div>
      {decided ? (
        <div className="pl-8 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
            {decided === "confirmed" ? (
              actionState === "error" ? (
                <XCircle className="size-4 text-[#f381cf]" />
              ) : actionState === "in_flight" ? (
                <AlertTriangle className="size-4 text-[#f381cf]" />
              ) : actionState === "success" || (actionState === "idle" && actionResult) ? (
                <Check className="size-4 text-[#f381cf]" />
              ) : (
                <LogoSpinner size={16} />
              )
            ) : null}
            {decided === "confirmed"
              ? actionState === "error"
                ? t('agentChatBlocks.confirmation.statusFailed').replace('{label}', confirmLabel)
                : actionState === "in_flight"
                ? t('agentChatBlocks.confirmation.statusInFlight').replace('{label}', confirmLabel)
                : actionState === "running" || (actionState === "idle" && !actionResult)
                ? t('agentChatBlocks.confirmation.statusRunning').replace('{label}', confirmLabel)
                : t('agentChatBlocks.confirmation.statusDone').replace('{label}', confirmLabel)
              : t('agentChatBlocks.confirmation.statusCancelledChoice').replace('{label}', cancelLabel)}
          </div>
          {traceActivities && traceActivities.length > 0 && (
            <AgentTrace activities={traceActivities} isStreaming={traceStreaming} />
          )}
          {actionResult && (
            <div className="text-[11.5px] leading-relaxed text-foreground/60 border-t border-white/[0.06] pt-2">
              <MarkdownMessage content={actionResult} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 pl-8">
          <button
            type="button"
            onClick={() => handleDecision("confirmed")}
            disabled={isThinking || isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#f381cf] hover:bg-[#d96db5] text-white px-3.5 py-1.5 text-[11.5px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <Loader2 className="size-3 animate-spin" /> : null}
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={() => handleDecision("cancelled")}
            disabled={isThinking || isSubmitting}
            className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[11.5px] text-foreground/70 transition-colors hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
        </div>
      )}
    </div>
  )
}
