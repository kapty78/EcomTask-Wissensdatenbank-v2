"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Check } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type OverlayAccent = "pink" | "neutral"

interface LoadingOverlayProps {
  show: boolean
  title?: string
  description?: string
  progress?: number
  accent?: OverlayAccent
}

const accentTokens: Record<OverlayAccent, { indicator: string; orb: string; text: string }> = {
  pink: {
    indicator: "from-pink-400 via-pink-500 to-pink-400",
    orb: "bg-pink-500/20 border-pink-500/40",
    text: "text-pink-200"
  },
  neutral: {
    indicator: "from-gray-200 via-gray-100 to-gray-300",
    orb: "bg-gray-200/15 border-gray-200/20",
    text: "text-gray-200"
  }
}

export function LoadingOverlay({
  show,
  title = "Analyse läuft…",
  description,
  progress,
  accent = "pink"
}: LoadingOverlayProps) {
  const accentConfig = accentTokens[accent]
  const [internalProgress, setInternalProgress] = useState(0)
  const animationFrameRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const durationMs = 60000
  const secondPhaseStart = 0.6
  const [activeCard, setActiveCard] = useState(0)

  const cards = [
    {
      id: "document",
      label: "Hochgeladene Dokumente",
      lines: [68, 52, 78],
      icon: (
        <motion.span
          className="inline-flex items-center justify-center rounded-sm bg-pink-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-pink-200"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          DOC
        </motion.span>
      )
    },
    {
      id: "text",
      label: "Manuelle Texte",
      lines: [42, 61, 48, 68],
      icon: (
        <motion.span
          className="inline-flex items-center justify-center rounded-sm bg-pink-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-pink-200"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          TXT
        </motion.span>
      )
    },
    {
      id: "facts",
      label: "Neue Wissensfragmente",
      lines: [50, 66, 48, 57, 41],
      icon: (
        <motion.span
          className="inline-flex items-center justify-center rounded-sm bg-pink-500/20 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-pink-200"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          NEW
        </motion.span>
      )
    }
  ]

  // Animate the progress bar smoothly when no explicit value is provided.
  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (!show) {
      setInternalProgress(0)
      return
    }

    if (typeof progress === "number") {
      setInternalProgress(progress)
      return
    }

    const step = () => {
      if (!startTimeRef.current) {
        startTimeRef.current = performance.now()
      }
      const elapsed = performance.now() - startTimeRef.current
      const normalized = Math.min(elapsed / durationMs, 0.999)
      let easedValue: number
      if (normalized <= secondPhaseStart) {
        // First 60% in ~20% of the time (fast ease-out)
        const fastPortion = normalized / secondPhaseStart
        easedValue = fastPortion * 60
      } else {
        const slowPortion = (normalized - secondPhaseStart) / (1 - secondPhaseStart)
        // Ease-in for the remaining 40%
        easedValue = 60 + Math.pow(slowPortion, 1.8) * 39.2
      }
      setInternalProgress(easedValue)
      animationFrameRef.current = requestAnimationFrame(step)
    }

    animationFrameRef.current = requestAnimationFrame(step)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      startTimeRef.current = null
    }
  }, [show, progress, durationMs])

  useEffect(() => {
    if (!show) return
    setActiveCard(0)
    const interval = setInterval(() => {
      setActiveCard(prev => (prev + 1) % cards.length)
    }, 900)
    return () => clearInterval(interval)
  }, [show, cards.length])

  // Mirror external progress updates smoothly.
  useEffect(() => {
    if (!show) return
    if (typeof progress === "number") {
      setInternalProgress(progress)
    }
  }, [progress, show])

  const displayValue = useMemo(() => {
    const value = typeof progress === "number" ? progress : internalProgress
    if (Number.isNaN(value)) return 0
    return Math.max(0, Math.min(100, value))
  }, [internalProgress, progress])

  const indicatorClassName = cn(
    "bg-gradient-to-r shadow-[0_0_20px_rgba(236,72,153,0.35)] transition-none",
    accentConfig.indicator
  )

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="loading-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="absolute inset-0 z-40 flex items-center justify-center bg-background"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 18, stiffness: 220 }}
            className="relative w-full max-w-sm rounded-3xl bg-[#151515] p-6"
          >
            <div className="flex flex-col items-center gap-5">
              <div className="relative flex min-h-[88px] w-full items-center justify-center">
                <div className="flex gap-2.5">
                  {cards.map((card, index) => {
                    const isActive = activeCard === index
                    return (
                      <motion.div
                        key={card.id}
                        className={cn(
                          "w-[115px] rounded-2xl border border-[#2f2f2f] bg-[#1a1a1a] px-2.5 py-2.5 shadow-sm",
                          isActive ? "border-pink-500/40 bg-[#201019]" : "opacity-55"
                        )}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{
                          opacity: isActive ? 1 : 0.6,
                          y: isActive ? 0 : 6,
                          scale: isActive ? 1 : 0.95
                        }}
                        transition={{ duration: 0.35, ease: "easeOut" }}
                      >
                        <div className="flex items-center justify-between text-[9px] text-gray-400">
                          <span className="truncate text-[8px] font-medium uppercase tracking-wide text-gray-500">
                            {card.label}
                          </span>
                          {card.icon}
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {card.lines.map((width, lineIndex) => (
                            <motion.div
                              key={lineIndex}
                              className="h-1.5 rounded-full bg-gradient-to-r from-pink-500/10 via-pink-500/60 to-pink-500/20"
                              initial={{ width: 0 }}
                              animate={{ width: isActive ? `${width}%` : `${Math.max(25, width - 20)}%` }}
                              transition={{ duration: 0.4, ease: "easeOut", delay: lineIndex * 0.05 }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-1 text-center">
                <p className="text-sm font-semibold text-white tracking-wide">{title}</p>
                {description && <p className="text-xs text-gray-400">{description}</p>}
              </div>
              <div className="w-full">
                <div className="relative w-full overflow-hidden rounded-full">
                  <Progress
                    value={displayValue}
                    aria-label="Analysefortschritt"
                    className="h-2 w-full bg-[#1b1b1b]"
                    indicatorClassName={indicatorClassName}
                  />
                  <motion.div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white/30 to-transparent mix-blend-screen"
                    animate={{ x: ["-120%", "120%"] }}
                    transition={{ repeat: Infinity, duration: 1.9, ease: "linear" }}
                  />
                </div>
                <motion.div
                  className={cn("mt-3 text-[11px] font-medium", accentConfig.text)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 0.9, y: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  {Math.round(displayValue)}% abgeschlossen
                </motion.div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface LoadingSuccessProps {
  show: boolean
  message?: string
}

export function LoadingSuccess({ show, message = "Analyse abgeschlossen" }: LoadingSuccessProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="loading-success"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center pt-6"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 260 }}
            className="flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-pink-200"
          >
            <motion.span
              className="flex size-5 items-center justify-center rounded-full border border-pink-300/40 bg-pink-500/20 text-pink-200"
              animate={{ rotate: [0, -6, 0, 6, 0] }}
              transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
            >
              <Check className="size-3.5" />
            </motion.span>
            <span>{message}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

