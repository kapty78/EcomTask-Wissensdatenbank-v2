"use client"

import { Check, ChevronDown, ChevronRight } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AgentRichBlock } from "../types"
import type { UseTableSelectionReturn } from "../hooks/use-table-selection"
import { useLanguage } from "@/contexts/LanguageContext"

type TableBlockData = AgentRichBlock & { type: "table" }

interface InteractiveTableProps {
  block: TableBlockData
  blockIndex: number
  messageId: string
  tableSelection: UseTableSelectionReturn
}

const MAX_COLLAPSED = 5

export function InteractiveTable({ block, blockIndex, messageId, tableSelection }: InteractiveTableProps) {
  const { t } = useLanguage()
  const { tableSelections, expandedTables, openTables, toggleTableRow, toggleAllTableRows, attachSelectedRows, toggleTableExpanded, toggleTableOpen } = tableSelection
  const tableKey = `${messageId}:${blockIndex}`
  const selected = tableSelections[tableKey] || new Set<number>()
  const allSelected = selected.size === block.rows.length && block.rows.length > 0
  const someSelected = selected.size > 0

  // Default = closed: nur Header sichtbar, kein Body. User-Klick auf Header
  // expandiert die Tabelle. Tabellen wurden im Chat zu raumgreifend — der
  // User schaut eh nur ab und zu rein.
  const isOpen = openTables[tableKey] || false
  const isExpanded = expandedTables[tableKey] || false
  const visibleRows = isExpanded ? block.rows : block.rows.slice(0, MAX_COLLAPSED)
  const hasMore = block.rows.length > MAX_COLLAPSED

  return (
    <div key={`table-${blockIndex}`} className="rounded-xl border border-white/[0.06] bg-background overflow-hidden shadow-sm">
      {/* Header — Klickbar, toggle Open/Close */}
      <button
        type="button"
        onClick={() => toggleTableOpen(tableKey)}
        className={`group w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02] ${isOpen ? "border-b border-white/[0.06]" : ""}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {isOpen
            ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
            : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />}
          <span className="text-[13px] font-medium text-foreground/80 truncate">{block.title || t('agentChatBlocks.table.defaultTitle')}</span>
        </span>
        <div className="flex items-center gap-3 shrink-0">
          {someSelected && isOpen && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); attachSelectedRows(tableKey, block.title, block.columns, block.rows) }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); attachSelectedRows(tableKey, block.title, block.columns, block.rows) }
              }}
              className="text-[11px] font-medium text-[#f381cf] hover:text-[#d96db5] transition-colors cursor-pointer"
            >
              {t(selected.size === 1 ? 'agentChatBlocks.table.attachRowsSingular' : 'agentChatBlocks.table.attachRowsPlural').replace('{count}', String(selected.size))}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/40">{t('agentChatBlocks.table.entriesCount').replace('{count}', String(block.rows.length))}</span>
        </div>
      </button>
      {!isOpen ? null : (<>

      {/* Table */}
      <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-white/[0.06]">
              <TableHead className="w-10 px-3 sticky left-0 z-10 bg-background">
                <button
                  type="button"
                  onClick={() => toggleAllTableRows(tableKey, block.rows.length)}
                  className={`flex items-center justify-center size-4 rounded border transition-colors ${
                    allSelected ? "border-[#f381cf] bg-[#f381cf]" : someSelected ? "border-[#f381cf]/50 bg-[#f381cf]/20" : "border-white/20 bg-transparent hover:border-white/40"
                  }`}
                >
                  {(allSelected || someSelected) && <Check className="size-2.5 text-white" />}
                </button>
              </TableHead>
              {block.columns.map((col, ci) => (
                <TableHead key={`${col}-${ci}`} className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide py-2.5 px-3">{col}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row, ri) => {
              const isSelected = selected.has(ri)
              return (
                <TableRow
                  key={`row-${ri}`}
                  className={`border-white/[0.04] cursor-pointer transition-colors ${isSelected ? "bg-[#f381cf]/[0.06]" : "hover:bg-white/[0.03]"}`}
                  onClick={() => toggleTableRow(tableKey, ri)}
                >
                  <TableCell className="w-10 px-3 py-3 sticky left-0 z-10 bg-background">
                    <span className={`flex items-center justify-center size-4 rounded border transition-colors ${
                      isSelected ? "border-[#f381cf] bg-[#f381cf]" : "border-white/20"
                    }`}>
                      {isSelected && <Check className="size-2.5 text-white" />}
                    </span>
                  </TableCell>
                  {row.map((cell, ci) => (
                    <TableCell key={`cell-${ri}-${ci}`} className="text-[12.5px] leading-[1.6] text-foreground/70 py-3 px-3 max-w-[280px]">
                      <span className="line-clamp-2">{cell}</span>
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {/* Expand/collapse button — outside scrollable area so it stays fixed */}
      {hasMore && (
        <div className="border-t border-white/[0.06] py-2.5 flex justify-center">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleTableExpanded(tableKey) }}
            className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {isExpanded ? t('agentChatBlocks.table.showLess') : t('agentChatBlocks.table.showMoreRows').replace('{count}', String(block.rows.length - MAX_COLLAPSED))}
          </button>
        </div>
      )}
      </>)}
    </div>
  )
}
