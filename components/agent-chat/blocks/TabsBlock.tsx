"use client"

import { useState } from "react"
import type { AgentRichBlock } from "../types"
import { MarkdownMessage } from "./MarkdownMessage"

type TabsBlockData = AgentRichBlock & { type: "tabs" }

export function TabsBlock({ block, blockIndex }: { block: TabsBlockData; blockIndex: number }) {
  const tabs = Array.isArray(block.tabs) ? block.tabs.filter(t => !!t?.id && !!t?.label) : []
  if (tabs.length === 0) return null

  const [activeTab, setActiveTab] = useState(tabs[0].id)
  const activeContent = tabs.find(t => t.id === activeTab)?.content || ""

  return (
    <div key={`tabs-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {block.title && (
        <div className="px-4 py-2.5 border-b border-white/[0.06] text-[13px] font-medium text-foreground/80">{block.title}</div>
      )}
      {/* Tab headers */}
      <div className="flex border-b border-white/[0.06] overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 px-4 py-2.5 text-[12px] font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? "border-[#f381cf] text-foreground/90"
                : "border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/[0.02]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div className="px-4 py-3 text-[12.5px] leading-[1.7] text-foreground/70">
        <MarkdownMessage content={activeContent} />
      </div>
    </div>
  )
}
