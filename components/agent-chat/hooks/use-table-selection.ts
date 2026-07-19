"use client"

import { useState, useCallback } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

export interface UseTableSelectionReturn {
  tableSelections: Record<string, Set<number>>
  expandedTables: Record<string, boolean>
  /** Per-Tabelle Open-State. Default = closed (Body komplett weg, nur Header
   * mit Titel + Eintragsanzahl). User klickt Header → Tabelle expandiert. */
  openTables: Record<string, boolean>
  pendingTableContext: { title: string; columns: string[]; rows: string[][] } | null
  toggleTableRow: (tableKey: string, rowIndex: number) => void
  toggleAllTableRows: (tableKey: string, totalRows: number) => void
  attachSelectedRows: (tableKey: string, title: string | undefined, columns: string[], rows: string[][]) => void
  toggleTableExpanded: (tableKey: string) => void
  toggleTableOpen: (tableKey: string) => void
  clearPendingTableContext: () => void
  resetTableSelections: () => void
}

export function useTableSelection(): UseTableSelectionReturn {
  const { t } = useLanguage()
  const [tableSelections, setTableSelections] = useState<Record<string, Set<number>>>({})
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({})
  const [openTables, setOpenTables] = useState<Record<string, boolean>>({})
  const [pendingTableContext, setPendingTableContext] = useState<{ title: string; columns: string[]; rows: string[][] } | null>(null)

  const toggleTableRow = useCallback((tableKey: string, rowIndex: number) => {
    setTableSelections(prev => {
      const current = new Set(prev[tableKey] || [])
      if (current.has(rowIndex)) current.delete(rowIndex)
      else current.add(rowIndex)
      return { ...prev, [tableKey]: current }
    })
  }, [])

  const toggleAllTableRows = useCallback((tableKey: string, totalRows: number) => {
    setTableSelections(prev => {
      const current = prev[tableKey] || new Set<number>()
      if (current.size === totalRows) return { ...prev, [tableKey]: new Set<number>() }
      const all = new Set<number>()
      for (let i = 0; i < totalRows; i++) all.add(i)
      return { ...prev, [tableKey]: all }
    })
  }, [])

  const attachSelectedRows = useCallback((tableKey: string, title: string | undefined, columns: string[], rows: string[][]) => {
    const selected = tableSelections[tableKey]
    if (!selected || selected.size === 0) return
    const selectedRows = rows.filter((_, i) => selected.has(i))
    setPendingTableContext({ title: title || t("agentChatCore.tableContext.defaultTitle"), columns, rows: selectedRows })
  }, [tableSelections, t])

  const toggleTableExpanded = useCallback((tableKey: string) => {
    setExpandedTables(prev => ({ ...prev, [tableKey]: !prev[tableKey] }))
  }, [])

  const toggleTableOpen = useCallback((tableKey: string) => {
    setOpenTables(prev => ({ ...prev, [tableKey]: !prev[tableKey] }))
  }, [])

  const clearPendingTableContext = useCallback(() => {
    setPendingTableContext(null)
  }, [])

  const resetTableSelections = useCallback(() => {
    setTableSelections({})
    setExpandedTables({})
    setOpenTables({})
    setPendingTableContext(null)
  }, [])

  return {
    tableSelections,
    expandedTables,
    openTables,
    pendingTableContext,
    toggleTableRow,
    toggleAllTableRows,
    attachSelectedRows,
    toggleTableExpanded,
    toggleTableOpen,
    clearPendingTableContext,
    resetTableSelections,
  }
}
