"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronRight, Check, AlertCircle, ArrowRight } from "lucide-react"
import type { ToolActivity, SubToolActivity } from "./types"
import { LogoSpinner } from "@/components/DynamicLogo"
import { useLanguage } from "@/contexts/LanguageContext"

function formatLatency(start?: number, end?: number): string | null {
  if (!start) return null
  const e = end ?? Date.now()
  const ms = Math.max(0, e - start)
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`
}

function StatusIcon({ status, size = "sm" }: { status: ToolActivity["status"]; size?: "sm" | "xs" }) {
  const cls = size === "xs" ? "size-2.5" : "size-3"
  if (status === "running") {
    return <LogoSpinner size={size === "xs" ? 10 : 12} />
  }
  if (status === "error") {
    return <AlertCircle className={`${cls} text-[#f381cf]`} />
  }
  return <Check className={`${cls} text-[#f381cf]/70`} />
}

function SubStepRow({ sub }: { sub: SubToolActivity }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(sub.status === "running")
  const streamRef = useRef<HTMLDivElement>(null)
  const hasDetail = !!(sub.streamText || sub.details?.lines?.length || sub.error)

  // Auto-collapse once done unless user explicitly opened — track previous status
  const wasRunning = useRef(sub.status === "running")
  useEffect(() => {
    if (wasRunning.current && sub.status !== "running") {
      setOpen(false)
    }
    wasRunning.current = sub.status === "running"
  }, [sub.status])

  // Autoscroll the streaming text to the bottom as new chunks arrive
  useEffect(() => {
    if (!open || !sub.streamText) return
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, sub.streamText])

  const latency = formatLatency(sub.startedAt, sub.endedAt)
  const isStreamPreview = sub.tool === "sub_text"

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
        className={`group flex w-full items-center gap-1.5 py-0.5 text-left text-[10.5px] leading-tight ${
          hasDetail ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span className="shrink-0">
          <StatusIcon status={sub.status} size="xs" />
        </span>
        <span className={`min-w-0 flex-1 truncate ${sub.status === "running" ? "text-foreground/85" : "text-muted-foreground/70 group-hover:text-foreground/80"}`}>
          {sub.agent && <span className="text-[#f381cf]/70 font-medium">{sub.agent}</span>}
          {sub.agent && <span className="text-muted-foreground/30 mx-1">·</span>}
          <span>{sub.label}</span>
        </span>
        {latency && (
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground/40 tabular-nums">
            {latency}
          </span>
        )}
        {hasDetail && (
          <ChevronRight
            className={`size-2.5 shrink-0 text-muted-foreground/30 transition-transform ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {open && hasDetail && (
        <div className="ml-3.5 mb-1 mt-0.5 space-y-1">
          {isStreamPreview && sub.streamText ? (
            <div
              ref={streamRef}
              className="agent-trace-stream max-h-[140px] overflow-y-auto rounded-md border border-black/[0.06] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.025] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-foreground/75 whitespace-pre-wrap"
            >
              {sub.streamText}
              {sub.status === "running" && <span className="agent-trace-cursor">▍</span>}
            </div>
          ) : null}
          {sub.details?.lines?.map((line, i) => (
            <div
              key={i}
              className="rounded-md bg-black/[0.03] dark:bg-white/[0.025] px-2 py-1 font-mono text-[10px] leading-relaxed text-muted-foreground/80 whitespace-pre-wrap break-words"
            >
              {line}
            </div>
          ))}
          {sub.error && (
            <div className="rounded-md border border-[#f381cf]/30 bg-[#f381cf]/[0.05] px-2 py-1 text-[10px] text-foreground/85 whitespace-pre-wrap">
              <span className="mr-1 font-medium text-[#f381cf]/85">{t("agentChatCore.trace.errorLabel")}</span>
              {sub.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface TraceStepProps {
  activity: ToolActivity
  defaultOpen: boolean
  isLast: boolean
}

export function TraceStep({ activity, defaultOpen, isLast }: TraceStepProps) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(defaultOpen)
  const wasRunning = useRef(activity.status === "running")

  // Auto-open on running, auto-close once done (unless user manually toggled in between)
  const userToggled = useRef(false)
  useEffect(() => {
    if (userToggled.current) return
    if (activity.status === "running" && !open) setOpen(true)
    if (wasRunning.current && activity.status !== "running") setOpen(false)
    wasRunning.current = activity.status === "running"
  }, [activity.status, open])

  const subs = activity.subActivities || []
  const hasBody =
    !!activity.details?.request ||
    !!activity.details?.response ||
    !!activity.details?.lines?.length ||
    !!activity.details?.links?.length ||
    !!activity.error ||
    subs.length > 0
  const latency = formatLatency(activity.startedAt, activity.endedAt)

  // The first segment of "Agent: Tool" labels — used to badge the agent
  const labelParts = (activity.label || "").split(":")
  const hasAgentBadge = labelParts.length > 1 && activity.tool?.startsWith("call_")
  const agentName = hasAgentBadge ? labelParts[0].trim() : null
  const toolPart = hasAgentBadge ? labelParts.slice(1).join(":").trim() : activity.label

  return (
    <div className="relative pl-5">
      {/* Vertical rail */}
      <div
        aria-hidden
        className={`absolute left-[7px] top-3 ${isLast ? "h-3" : "bottom-0"} w-px ${
          activity.status === "running"
            ? "bg-gradient-to-b from-[#f381cf]/60 via-[#f381cf]/30 to-transparent"
            : "bg-black/[0.08] dark:bg-white/[0.08]"
        }`}
      />
      {/* Node dot */}
      <div
        aria-hidden
        className={`absolute left-[3px] top-[7px] flex h-[11px] w-[11px] items-center justify-center rounded-full border ${
          activity.status === "running"
            ? "border-[#f381cf]/60 bg-[#161616] agent-trace-pulse"
            : activity.status === "error"
            ? "border-[#f381cf]/70 bg-[#f381cf]/30"
            : "border-[#f381cf]/35 bg-[#f381cf]/15"
        }`}
      >
        {activity.status === "running" && (
          <span className="size-[5px] rounded-full bg-[#f381cf]" />
        )}
        {activity.status === "done" && (
          <Check className="size-[7px] text-[#f381cf]" strokeWidth={3} />
        )}
        {activity.status === "error" && (
          <span className="text-[8px] font-bold leading-none text-[#f381cf]">!</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          userToggled.current = true
          setOpen((v) => !v)
        }}
        className="group flex w-full items-center gap-1.5 py-1 text-left"
      >
        <span
          className={`min-w-0 flex-1 truncate text-[11px] font-medium leading-tight ${
            activity.status === "running" ? "text-foreground" : "text-foreground/70 group-hover:text-foreground"
          }`}
        >
          {agentName && (
            <>
              <span className="rounded bg-[#f381cf]/10 px-1 py-[1px] font-mono text-[9.5px] uppercase tracking-wide text-[#f381cf]/85">
                {agentName}
              </span>
              <span className="text-muted-foreground/30 mx-1.5">·</span>
            </>
          )}
          <span className={agentName ? "" : "font-mono text-[10.5px]"}>{toolPart}</span>
        </span>
        {latency && (
          <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/45 tabular-nums">
            {latency}
          </span>
        )}
        {hasBody && (
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground/40 transition-transform ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>

      {open && hasBody && (
        <div className="mb-2 mt-1 space-y-1.5">
          {activity.details?.request && (
            <div className="rounded-md bg-black/[0.03] dark:bg-white/[0.025] px-2.5 py-1.5">
              <div className="mb-0.5 flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-wide text-[#f381cf]/55">
                <ArrowRight className="size-2.5" /> {t("agentChatCore.trace.orchestrator")}
              </div>
              <div className="font-mono text-[10px] leading-relaxed text-foreground/75 whitespace-pre-wrap break-words">
                {activity.details.request}
              </div>
            </div>
          )}

          {subs.length > 0 && (
            <div className="rounded-md border border-black/[0.05] dark:border-white/[0.05] bg-black/[0.015] dark:bg-white/[0.012] px-2 py-1.5">
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40">
                {t("agentChatCore.trace.workSteps")}
              </div>
              <div className="space-y-0">
                {subs.map((sub) => (
                  <SubStepRow key={sub.id} sub={sub} />
                ))}
              </div>
            </div>
          )}

          {activity.details?.response && (
            <div className="rounded-md bg-black/[0.03] dark:bg-white/[0.025] px-2.5 py-1.5">
              <div className="mb-0.5 flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/45">
                <ArrowRight className="size-2.5 rotate-180" /> {agentName || t("agentChatCore.trace.answerFallback")}
              </div>
              <div className="font-mono text-[10px] leading-relaxed text-foreground/75 whitespace-pre-wrap break-words">
                {activity.details.response}
              </div>
            </div>
          )}

          {activity.details?.lines && activity.details.lines.length > 0 && (
            <div className="space-y-0.5">
              {activity.details.lines.map((line, i) => (
                <div
                  key={i}
                  className="rounded-md bg-black/[0.025] dark:bg-white/[0.02] px-2 py-1 font-mono text-[10px] leading-relaxed text-muted-foreground/85 whitespace-pre-wrap break-words"
                >
                  {line}
                </div>
              ))}
            </div>
          )}

          {activity.details?.links && activity.details.links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activity.details.links.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-[#f381cf]/20 bg-[#f381cf]/[0.06] px-2 py-0.5 text-[10px] text-[#f381cf]/85 hover:bg-[#f381cf]/[0.12] hover:text-[#f381cf]"
                >
                  {link.title}
                </a>
              ))}
            </div>
          )}

          {activity.error && (
            <div className="rounded-md border border-[#f381cf]/35 bg-[#f381cf]/[0.05] px-2.5 py-1.5 text-[10.5px] text-foreground/85 whitespace-pre-wrap">
              <span className="mr-1 font-medium text-[#f381cf]">{t("agentChatCore.trace.errorLabel")}</span>
              {activity.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
