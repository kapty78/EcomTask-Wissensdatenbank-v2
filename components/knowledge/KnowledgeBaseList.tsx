"use client"

import React, { useState, useEffect, FC, useRef } from "react"
import { getSupabaseClient } from "@/lib/supabase-browser"
import { Database } from "@/supabase/types"
import type { Tables } from "@/supabase/types"
import { isRLSError, handleRLSError } from "@/lib/rls-error-handler"
import {
  Database as DatabaseIcon,
  Plus,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Pencil,
  X,
  Check
} from "lucide-react"

type KnowledgeBase = Tables<"knowledge_bases">

interface KnowledgeBaseListProps {
  userId: string
  selectedKnowledgeBaseId: string | null
  onSelectKnowledgeBase: (id: string | null) => void
  onKnowledgeBaseDeleted?: (id: string) => void
  externalNewKb?: any
  onExternalNewKbProcessed?: () => void
}

const KnowledgeStackIcon: FC<{ isSelected: boolean }> = ({ isSelected }) => (
  <span
    className={`relative inline-flex size-4 flex-shrink-0 items-center justify-center rounded-[5px] border transition-all duration-150 ${
      isSelected ? "border-transparent bg-primary/[0.08]" : "border-transparent bg-transparent"
    }`}
    aria-hidden="true"
  >
    <DatabaseIcon className={`size-3 ${isSelected ? "text-primary/80" : "text-zinc-500/90"}`} strokeWidth={2} />
  </span>
)

export const KnowledgeBaseList: FC<KnowledgeBaseListProps> = ({
  userId,
  selectedKnowledgeBaseId,
  onSelectKnowledgeBase,
  onKnowledgeBaseDeleted,
  externalNewKb,
  onExternalNewKbProcessed,
}) => {
  const supabase = getSupabaseClient()
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Inline create
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newLanguage, setNewLanguage] = useState("de")
  const [createLoading, setCreateLoading] = useState(false)
  const createInputRef = useRef<HTMLInputElement>(null)

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameLoading, setRenameLoading] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Inline delete
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState("")
  const [deleteLoading, setDeleteLoading] = useState(false)
  const deleteInputRef = useRef<HTMLInputElement>(null)

  // Fetch
  useEffect(() => {
    const fetchKnowledgeBases = async () => {
      if (!userId) return
      setLoading(true)
      setError(null)
      try {
        const { data, error } = await supabase
          .from("knowledge_bases")
          .select("*")
          .order("created_at", { ascending: false })

        if (error) {
          const rlsResult = handleRLSError(error)
          setError(rlsResult.isRLSError ? rlsResult.userFriendlyMessage : `Fehler: ${error.message}`)
          setKnowledgeBases([])
          return
        }
        setKnowledgeBases(data || [])
      } catch (err: any) {
        setError(`Fehler: ${err.message}`)
        setKnowledgeBases([])
      } finally {
        setLoading(false)
      }
    }
    fetchKnowledgeBases()
  }, [userId, supabase])

  // External new KB
  useEffect(() => {
    if (externalNewKb && onExternalNewKbProcessed) {
      setKnowledgeBases(prev => [externalNewKb, ...prev])
      onExternalNewKbProcessed()
    }
  }, [externalNewKb, onExternalNewKbProcessed])

  // ── CREATE ──
  const handleCreateNew = () => {
    setIsCreating(true)
    setNewName("")
    setNewLanguage("de")
    setTimeout(() => createInputRef.current?.focus(), 50)
  }

  const handleConfirmCreate = async () => {
    if (!newName.trim()) return
    setCreateLoading(true)
    try {
      const { data, error } = await supabase
        .from("knowledge_bases")
        .insert({ user_id: userId, name: newName.trim(), language: newLanguage })
        .select()
        .single()
      if (error) throw error
      if (data) {
        setKnowledgeBases(prev => [data, ...prev])
        setIsCreating(false)
        onSelectKnowledgeBase(data.id)
      }
    } catch (err: any) {
      setError(`Fehler: ${err.message}`)
    } finally {
      setCreateLoading(false)
    }
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newName.trim()) { e.preventDefault(); handleConfirmCreate() }
    else if (e.key === "Escape") setIsCreating(false)
  }

  // ── RENAME ──
  const startRename = (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingId(kb.id)
    setRenameValue(kb.name)
    setDeletingId(null)
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  const handleConfirmRename = async () => {
    if (!renamingId || !renameValue.trim()) return
    const kb = knowledgeBases.find(k => k.id === renamingId)
    if (renameValue.trim() === kb?.name) { setRenamingId(null); return }

    setRenameLoading(true)
    try {
      const res = await fetch("/api/knowledge/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledgeBaseId: renamingId, newName: renameValue.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Rename failed")
      setKnowledgeBases(prev => prev.map(k => k.id === renamingId ? { ...k, name: renameValue.trim() } : k))
      setRenamingId(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRenameLoading(false)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleConfirmRename() }
    else if (e.key === "Escape") setRenamingId(null)
  }

  // ── DELETE ──
  const startDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingId(id)
    setDeleteConfirm("")
    setRenamingId(null)
    setTimeout(() => deleteInputRef.current?.focus(), 50)
  }

  const handleConfirmDelete = async () => {
    if (!deletingId) return
    const kb = knowledgeBases.find(k => k.id === deletingId)
    if (deleteConfirm !== kb?.name) return

    setDeleteLoading(true)
    try {
      const res = await fetch("/api/knowledge/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledgeBaseId: deletingId }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed")
      setKnowledgeBases(prev => prev.filter(k => k.id !== deletingId))
      onKnowledgeBaseDeleted?.(deletingId)
      setDeletingId(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleDeleteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleConfirmDelete() }
    else if (e.key === "Escape") setDeletingId(null)
  }

  // ── ITEM CLICK ──
  const handleItemClick = (id: string) => {
    if (renamingId || deletingId) return
    onSelectKnowledgeBase(id === selectedKnowledgeBaseId ? null : id)
  }

  // ── RENDER ──
  return (
    <div className="space-y-1">
      {loading && (
        <div className="flex items-center justify-center p-6">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="size-3.5 flex-shrink-0" />
            {error}
          </p>
        </div>
      )}

      {/* Inline create */}
      {isCreating && (
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
          <KnowledgeStackIcon isSelected={false} />
          <input
            ref={createInputRef}
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            placeholder="Name..."
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-white placeholder:text-gray-500 focus:outline-none"
            disabled={createLoading}
            autoFocus
          />
          <select
            value={newLanguage}
            onChange={e => setNewLanguage(e.target.value)}
            className="w-[52px] rounded border border-[#333] bg-transparent px-1 py-0.5 text-[11px] text-gray-400 focus:outline-none"
            disabled={createLoading}
          >
            <option value="de">DE</option>
            <option value="en">EN</option>
            <option value="fr">FR</option>
            <option value="es">ES</option>
            <option value="it">IT</option>
            <option value="nl">NL</option>
            <option value="pl">PL</option>
            <option value="pt">PT</option>
          </select>
          {createLoading ? (
            <Loader2 className="size-3.5 animate-spin text-gray-400" />
          ) : (
            <>
              <button onClick={handleConfirmCreate} disabled={!newName.trim()} className="rounded p-0.5 text-gray-400 hover:text-white disabled:opacity-30" title="Erstellen (Enter)">
                <Check className="size-3.5" />
              </button>
              <button onClick={() => setIsCreating(false)} className="rounded p-0.5 text-gray-500 hover:text-white" title="Abbrechen (Esc)">
                <X className="size-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {/* KB List */}
      {!loading && !error && knowledgeBases.length === 0 && !isCreating && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-8">
          <DatabaseIcon className="mb-3 size-12 text-muted-foreground opacity-50" />
          <p className="text-center text-sm text-muted-foreground">Keine Datenbanken vorhanden</p>
        </div>
      )}

      {!loading && !error && knowledgeBases.length > 0 && (
        <div className="space-y-0.5">
          {knowledgeBases.map(kb => {
            const isSelected = kb.id === selectedKnowledgeBaseId
            const isRenaming = renamingId === kb.id
            const isDeleting = deletingId === kb.id

            // ── DELETE CONFIRM ROW ──
            if (isDeleting) {
              return (
                <div key={kb.id} className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                  <span className="relative inline-flex size-4 flex-shrink-0 items-center justify-center">
                    <Trash2 className="size-3 text-red-400" />
                  </span>
                  <input
                    ref={deleteInputRef}
                    type="text"
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    onKeyDown={handleDeleteKeyDown}
                    placeholder={`"${kb.name}" eingeben`}
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-white placeholder:text-gray-500 focus:outline-none"
                    disabled={deleteLoading}
                    autoFocus
                  />
                  {deleteLoading ? (
                    <Loader2 className="size-3.5 animate-spin text-red-400" />
                  ) : (
                    <>
                      <button onClick={handleConfirmDelete} disabled={deleteConfirm !== kb.name} className="rounded p-0.5 text-red-400 hover:text-red-300 disabled:opacity-30" title="Löschen (Enter)">
                        <Check className="size-3.5" />
                      </button>
                      <button onClick={() => setDeletingId(null)} className="rounded p-0.5 text-gray-500 hover:text-white" title="Abbrechen (Esc)">
                        <X className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )
            }

            // ── RENAME ROW ──
            if (isRenaming) {
              return (
                <div key={kb.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
                  <KnowledgeStackIcon isSelected={true} />
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-white focus:outline-none"
                    disabled={renameLoading}
                    autoFocus
                  />
                  {renameLoading ? (
                    <Loader2 className="size-3.5 animate-spin text-gray-400" />
                  ) : (
                    <>
                      <button onClick={handleConfirmRename} disabled={!renameValue.trim()} className="rounded p-0.5 text-gray-400 hover:text-white disabled:opacity-30" title="Speichern (Enter)">
                        <Check className="size-3.5" />
                      </button>
                      <button onClick={() => setRenamingId(null)} className="rounded p-0.5 text-gray-500 hover:text-white" title="Abbrechen (Esc)">
                        <X className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              )
            }

            // ── NORMAL ROW ──
            return (
              <div
                key={kb.id}
                onClick={() => handleItemClick(kb.id)}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 transition-all duration-150 ${
                  isSelected
                    ? "border border-white/15 bg-white/[0.05]"
                    : "border border-transparent hover:border-white/10 hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <KnowledgeStackIcon isSelected={isSelected} />
                  <span className="text-[13px] font-medium text-foreground/95 truncate" title={kb.name}>{kb.name}</span>
                </div>
                <div className="flex items-center flex-shrink-0">
                  <button
                    onClick={(e) => startRename(kb, e)}
                    className={`ml-1 rounded p-1 text-muted-foreground transition-all hover:bg-white/10 hover:text-foreground ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    title="Umbenennen"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={(e) => startDelete(kb.id, e)}
                    className={`ml-0.5 rounded p-1 text-foreground/40 transition-all hover:bg-white/10 hover:text-foreground ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    title="Löschen"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create button */}
      {!isCreating && (
        <button
          onClick={handleCreateNew}
          className="w-full rounded-lg border border-primary/55 bg-primary px-4 py-2.5 text-sm text-foreground font-medium hover:bg-pink-600 transition-colors"
          disabled={loading}
        >
          + Neue Datenbank
        </button>
      )}
    </div>
  )
}
