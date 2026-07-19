"use client"

import { memo, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { preprocessMarkdown } from "../helpers"

const markdownTableComponents = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 rounded-lg border border-border bg-card overflow-hidden shadow-sm [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <Table>{children}</Table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }: { children?: React.ReactNode }) => <TableBody>{children}</TableBody>,
  tr: ({ children }: { children?: React.ReactNode }) => <TableRow className="border-border">{children}</TableRow>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <TableHead className="text-[12px] font-semibold text-muted-foreground">{children}</TableHead>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <TableCell className="text-[12px] text-foreground/70 py-2">{children}</TableCell>
  ),
}

function MarkdownMessageImpl({ content }: { content: string }) {
  const processed = useMemo(() => preprocessMarkdown(content), [content])
  return (
    <div className="prose dark:prose-invert max-w-none text-[13px] leading-[1.7] text-foreground/75 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-pre:rounded-md prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-code:text-foreground/70 prose-strong:text-foreground/85 prose-strong:font-mono prose-headings:text-foreground/85 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-[14px] prose-h2:text-[13px] prose-h3:text-[12.5px] prose-h4:text-[12px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}

// Memoize so a parent re-render with the same `content` doesn't re-parse the
// entire markdown tree. Critical during streaming: the parent re-renders on
// every token, but only the actively-streaming message has changing content.
export const MarkdownMessage = memo(MarkdownMessageImpl)
