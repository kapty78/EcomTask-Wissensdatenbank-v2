"use client"

import type { AgentRichBlock } from "../types"

type DiffBlockData = AgentRichBlock & { type: "diff" }

function computeDiff(before: string, after: string): Array<{ type: "removed" | "added" | "unchanged"; text: string }> {
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  const result: Array<{ type: "removed" | "added" | "unchanged"; text: string }> = []

  const maxLen = Math.max(beforeLines.length, afterLines.length)
  let bi = 0, ai = 0

  while (bi < beforeLines.length || ai < afterLines.length) {
    if (bi < beforeLines.length && ai < afterLines.length && beforeLines[bi] === afterLines[ai]) {
      result.push({ type: "unchanged", text: beforeLines[bi] })
      bi++; ai++
    } else if (bi < beforeLines.length && (ai >= afterLines.length || !afterLines.includes(beforeLines[bi]))) {
      result.push({ type: "removed", text: beforeLines[bi] })
      bi++
    } else if (ai < afterLines.length) {
      result.push({ type: "added", text: afterLines[ai] })
      ai++
    } else {
      break
    }
    if (result.length > maxLen * 2 + 10) break // safety
  }
  return result
}

export function DiffViewerBlock({ block, blockIndex }: { block: DiffBlockData; blockIndex: number }) {
  const diff = computeDiff(block.before || "", block.after || "")

  return (
    <div key={`diff-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      {block.title && (
        <div className="px-4 py-2.5 border-b border-white/[0.06] text-[13px] font-medium text-foreground/80">{block.title}</div>
      )}
      <div className="overflow-x-auto">
        {/* table/table-row/table-cell (not block divs) so a line's background
            stretches to the width of the longest line, not just the viewport —
            block divs stop coloring the moment text overflows their own box. */}
        <pre className="table min-w-full text-[11.5px] leading-[1.8] font-mono">
          {diff.map((line, i) => (
            <div key={i} className="table-row">
              <div
                className={
                  (line.type === "removed" ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300/80" :
                  line.type === "added" ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300/80" :
                  "text-foreground/50") + " table-cell whitespace-pre px-4 py-0.5"
                }
              >
                <span className="inline-block w-4 text-right mr-3 text-[10px] text-muted-foreground/30 select-none">
                  {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
                </span>
                {line.text || " "}
              </div>
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
