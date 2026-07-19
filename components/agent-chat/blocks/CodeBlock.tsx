"use client"

import type { AgentRichBlock } from "../types"
import { useLanguage } from "@/contexts/LanguageContext"

type CodeBlockData = AgentRichBlock & { type: "code" }

export function CodeBlock({ block, blockIndex }: { block: CodeBlockData; blockIndex: number }) {
  const { t } = useLanguage()
  return (
    <div key={`code-${blockIndex}`} className="rounded-md border border-border bg-muted overflow-hidden">
      {(block.title || block.language) && (
        <div className="flex items-center justify-between border-b border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="truncate">{block.title || t('agentChatBlocks.code.defaultTitle')}</span>
          <span>{block.language || "text"}</span>
        </div>
      )}
      <pre className="max-h-64 overflow-auto p-2.5 text-[11.5px] leading-relaxed text-foreground"><code>{block.content}</code></pre>
    </div>
  )
}
