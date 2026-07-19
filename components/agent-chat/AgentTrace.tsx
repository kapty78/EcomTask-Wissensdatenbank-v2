"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"
import type { ToolActivity } from "./types"
import { TraceStep } from "./TraceStep"
import { LogoSpinner } from "@/components/DynamicLogo"
import { useLanguage } from "@/contexts/LanguageContext"

interface AgentTraceProps {
  activities: ToolActivity[]
  /** Whether the agent is still actively producing this trace. Drives auto-expand & live cursor. */
  isStreaming?: boolean
}

function totalLatency(activities: ToolActivity[], isStreaming: boolean): string | null {
  const starts = activities.map((a) => a.startedAt).filter((v): v is number => typeof v === "number")
  if (!starts.length) return null
  const start = Math.min(...starts)
  // Solange der Agent noch laeuft, soll der Top-Timer auch in Reasoning-Pausen
  // (kein Tool aktiv, aber LLM denkt zwischen Runden) weiter tickern. Ohne
  // dieses Override wuerde max(endedAt) den Timer einfrieren, sobald das letzte
  // Tool fertig ist — der User denkt das Ganze haengt.
  const end = isStreaming
    ? Date.now()
    : Math.max(
        ...activities
          .map((a) => a.endedAt ?? (a.status === "running" ? Date.now() : undefined))
          .filter((v): v is number => typeof v === "number")
      )
  if (!Number.isFinite(end)) return null
  const ms = Math.max(0, end - start)
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`
}

export function AgentTrace({ activities, isStreaming = false }: AgentTraceProps) {
  const { t } = useLanguage()
  // Force a re-render every 250ms while EITHER streaming OR there's a running
  // activity. Beim Live-Resume-Polling ist isStreaming=false (kein lokaler
  // SSE-Stream), aber tool-Status='running' aus der DB → Timer der laufenden
  // Step muss trotzdem hochzaehlen.
  const anyRunning = useMemo(() => activities.some(
    (a) => a.status === "running" || a.subActivities?.some((s) => s.status === "running")
  ), [activities])
  const shouldTick = isStreaming || anyRunning
  const [, force] = useState(0)
  useEffect(() => {
    if (!shouldTick) return
    const id = window.setInterval(() => force((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [shouldTick])

  // Header chevron — collapse the entire trace if user wants to dismiss it
  const [collapsed, setCollapsed] = useState(false)
  // While streaming OR aktiv tickend wollen wir das Panel offen
  useEffect(() => {
    if (shouldTick) setCollapsed(false)
  }, [shouldTick])

  const lastRunningIdx = useMemo(() => {
    for (let i = activities.length - 1; i >= 0; i--) {
      if (activities[i].status === "running") return i
    }
    return -1
  }, [activities])

  if (!activities || activities.length === 0) return null

  // Total tickert mit shouldTick (statt nur isStreaming) — gleiche Logik
  // damit sowohl Live-SSE als auch Live-Polling den Header-Timer fuettern.
  const total = totalLatency(activities, shouldTick)
  // Reasoning-Gap nur waehrend echtem SSE-Streaming sinnvoll — beim
  // Polling-Fall heisst "kein Tool aktiv" einfach "Run beendet", kein
  // "Agent ueberlegt".
  const showReasoningGap = isStreaming && !anyRunning && activities.length > 0
  const errored = activities.some((a) => a.status === "error")
  const stepCount = activities.length

  return (
    <div className="agent-trace mb-2 overflow-hidden rounded-lg border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.015] dark:bg-white/[0.012]">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
      >
        <span className="shrink-0">
          {isStreaming ? (
            <LogoSpinner size={14} />
          ) : errored ? (
            <span className="block size-2 rounded-full bg-[#f381cf] ring-1 ring-[#f381cf]/40" />
          ) : (
            <Sparkles className="size-3.5 text-[#f381cf]/70" />
          )}
        </span>
        <span className="min-w-0 flex-1 text-[11px] font-medium text-foreground/85">
          {isStreaming ? (
            <>
              {t("agentChatCore.trace.working")}<span className="agent-trace-dots ml-0.5" />
            </>
          ) : errored ? (
            t("agentChatCore.trace.error")
          ) : (
            t(stepCount === 1 ? "agentChatCore.trace.stepsSingular" : "agentChatCore.trace.stepsPlural").replace("{count}", String(stepCount))
          )}
        </span>
        {total && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/55 tabular-nums">
            {total}
          </span>
        )}
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground/45 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <div className="px-2 pb-2 pt-0.5">
          {activities.map((a, i) => (
            <TraceStep
              key={`step-${a.id}`}
              activity={a}
              defaultOpen={i === lastRunningIdx || (lastRunningIdx === -1 && i === activities.length - 1 && isStreaming)}
              isLast={i === activities.length - 1 && !showReasoningGap}
            />
          ))}
          {showReasoningGap && (
            <div className="relative pl-5">
              <div
                aria-hidden
                className="absolute left-[7px] top-0 h-3 w-px bg-gradient-to-b from-[#f381cf]/40 to-transparent"
              />
              <div
                aria-hidden
                className="absolute left-[3px] top-[7px] flex h-[11px] w-[11px] items-center justify-center rounded-full border border-[#f381cf]/40 bg-[#161616] agent-trace-pulse"
              >
                <span className="size-[5px] rounded-full bg-[#f381cf]/70" />
              </div>
              <div className="flex items-center gap-1.5 py-1 text-[11px] text-foreground/55 italic">
                <span>{t("agentChatCore.trace.thinking")}</span>
                <span className="agent-trace-dots" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
