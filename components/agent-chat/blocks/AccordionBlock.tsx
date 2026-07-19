"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import type { AgentRichBlock } from "../types"
import { MarkdownMessage } from "./MarkdownMessage"

type AccordionBlockData = AgentRichBlock & { type: "accordion" }

export function AccordionBlock({ block, blockIndex }: { block: AccordionBlockData; blockIndex: number }) {
  const sections = Array.isArray(block.sections) ? block.sections.filter(s => !!s?.id && !!s?.title) : []
  if (sections.length === 0) return null

  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    sections.forEach(s => { if (s.defaultOpen) initial.add(s.id) })
    return initial
  })

  const toggle = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div key={`accordion-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {block.title && (
        <div className="px-4 py-2.5 border-b border-white/[0.06] text-[13px] font-medium text-foreground/80">{block.title}</div>
      )}
      <div className="divide-y divide-white/[0.04]">
        {sections.map(section => {
          const isOpen = openIds.has(section.id)
          return (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => toggle(section.id)}
                className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-[12.5px] font-medium text-foreground/80">{section.title}</span>
                <ChevronDown className={`size-3.5 text-muted-foreground/50 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="px-4 pb-3 text-[12.5px] leading-[1.7] text-foreground/65">
                  <MarkdownMessage content={section.content} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
