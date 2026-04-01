"use client"

import React, { useState, useEffect, FC } from "react"
import { createPortal } from "react-dom"
import { getSupabaseClient } from "@/lib/supabase-browser"
import { Database } from "@/supabase/types"
import type { Tables } from "@/supabase/types"; // Import Tables from the correct path
// Inline creation replaces the old CreateKnowledgeBaseModal
import { isRLSError, handleRLSError } from "@/lib/rls-error-handler"
import {
  Database as DatabaseIcon,
  FolderPlus,
  FileText,
  Sparkles,
  Plus,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Pencil,
  X
} from "lucide-react"

// Define the type for a knowledge base item based on your DB schema
type KnowledgeBase = Tables<"knowledge_bases">

interface KnowledgeBaseListProps {
  userId: string
  selectedKnowledgeBaseId: string | null // Add prop to receive selected ID
  onSelectKnowledgeBase: (id: string | null) => void // Add callback prop
  onKnowledgeBaseDeleted?: (id: string) => void // Optional callback after successful deletion
  externalNewKb?: any // External new knowledge base to add to the list
  onExternalNewKbProcessed?: () => void // Callback to reset the external new KB state
}

const KnowledgeStackIcon: FC<{ isSelected: boolean }> = ({ isSelected }) => {
  return (
    <span
      className={`relative inline-flex size-4 flex-shrink-0 items-center justify-center rounded-[5px] border transition-all duration-150 ${
        isSelected
          ? "border-transparent bg-primary/[0.08]"
          : "border-transparent bg-transparent"
      }`}
      aria-hidden="true"
    >
      <DatabaseIcon className={`size-3 ${isSelected ? "text-primary/80" : "text-zinc-500/90"}`} strokeWidth={2} />
    </span>
  )
}

const ModalPortal: FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null
  return createPortal(children, document.body)
}

export const KnowledgeBaseList: FC<KnowledgeBaseListProps> = ({
  userId,
  selectedKnowledgeBaseId, // Destructure the new prop
  onSelectKnowledgeBase, // Destructure the new prop
  onKnowledgeBaseDeleted, // Destructure new prop
  externalNewKb, // External new knowledge base
  onExternalNewKbProcessed // Callback to reset external new KB
}) => {
  const supabase = getSupabaseClient()
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newLanguage, setNewLanguage] = useState("de")
  const [createLoading, setCreateLoading] = useState(false)
  const nameInputRef = React.useRef<HTMLInputElement>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [kbToDeleteId, setKbToDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState<string>("");

  // States for renaming
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [kbToRename, setKbToRename] = useState<KnowledgeBase | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [newKbName, setNewKbName] = useState("");

  useEffect(() => {
    const fetchKnowledgeBases = async () => {
      if (!userId) return // Don't fetch if userId is not available yet

      setLoading(true)
      setError(null)

      try {
        // ✅ COMPANY SHARING: RLS Policies filtern automatisch auf company_id
        // Kein .eq("user_id") mehr - alle Company-KBs werden zurückgegeben
        const { data, error } = await supabase
          .from("knowledge_bases")
          .select("*")
          .order("created_at", { ascending: false })

        if (error) {
          // ✅ RLS-Fehlerbehandlung
          const rlsResult = handleRLSError(error)
          if (rlsResult.isRLSError) {
            setError(rlsResult.userFriendlyMessage)
          } else {
            setError(`Fehler beim Laden der Wissensdatenbanken: ${error.message}`)
          }
          setKnowledgeBases([])
          return
        }

        setKnowledgeBases(data || [])
      } catch (err: any) {
        // console.error("Error fetching knowledge bases:", err)
        setError(`Fehler beim Laden der Wissensdatenbanken: ${err.message}`)
        setKnowledgeBases([]) // Clear data on error
      } finally {
        setLoading(false)
      }
    }

    fetchKnowledgeBases()
  }, [userId, supabase])

  // Handle external new knowledge base addition
  useEffect(() => {
    if (externalNewKb && onExternalNewKbProcessed) {
      // console.log('Adding external new knowledge base to list:', externalNewKb)
      setKnowledgeBases(prevKbs => [externalNewKb, ...prevKbs])
      onExternalNewKbProcessed() // Reset the external state
    }
  }, [externalNewKb, onExternalNewKbProcessed])

  const handleCreateNew = () => {
    setIsCreating(true)
    setNewName("")
    setNewLanguage("de")
    setTimeout(() => nameInputRef.current?.focus(), 50)
  }

  const handleCancelCreate = () => {
    setIsCreating(false)
    setNewName("")
    setNewLanguage("de")
  }

  const handleConfirmCreate = async () => {
    if (!newName.trim()) return

    setCreateLoading(true)
    try {
      const { data, error: insertError } = await supabase
        .from("knowledge_bases")
        .insert({
          user_id: userId,
          name: newName.trim(),
          language: newLanguage,
        })
        .select()
        .single()

      if (insertError) throw insertError
      if (data) {
        setKnowledgeBases(prevKbs => [data, ...prevKbs])
        setIsCreating(false)
        setNewName("")
        setNewLanguage("de")
        onSelectKnowledgeBase(data.id)
      }
    } catch (err: any) {
      setError(`Fehler: ${err.message}`)
    } finally {
      setCreateLoading(false)
    }
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newName.trim()) {
      e.preventDefault()
      handleConfirmCreate()
    } else if (e.key === "Escape") {
      handleCancelCreate()
    }
  }

  const handleDeleteClick = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent item click
    // console.log(`Initiating delete for KB: ${name} (${id})`);
    setKbToDeleteId(id);
    setDeleteError(null);
    setDeleteConfirmInput("");
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!kbToDeleteId) return;

    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const kbName = knowledgeBases.find(kb => kb.id === kbToDeleteId)?.name || "";
      const expected = kbName;
      if (deleteConfirmInput !== expected) {
        setDeleteError("Der Bestätigungstext stimmt nicht exakt. Bitte geben Sie exakt den Namen der Datenbank ein.");
        return;
      }

      const response = await fetch("/api/knowledge/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ knowledgeBaseId: kbToDeleteId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete knowledge base");
      }

      // console.log(`Successfully deleted KB: ${kbToDeleteId}`);
      // Remove from local state & trigger parent update
      setKnowledgeBases(prev => prev.filter(kb => kb.id !== kbToDeleteId));
      onKnowledgeBaseDeleted && onKnowledgeBaseDeleted(kbToDeleteId); // Inform parent

    } catch (err: any) {
      // console.error("Error deleting knowledge base:", err);
      setDeleteError(err.message);
    } finally {
      setDeleteLoading(false);
      setShowDeleteModal(false);
      setKbToDeleteId(null);
      setDeleteConfirmInput("");
    }
  };

  const handleRenameClick = (kb: KnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    setKbToRename(kb);
    setNewKbName(kb.name);
    setRenameError(null);
    setShowRenameModal(true);
  };

  const handleConfirmRename = async () => {
    if (!kbToRename || !newKbName.trim()) {
      setRenameError("Der Name darf nicht leer sein.");
      return;
    }
    if (newKbName.trim() === kbToRename.name) {
      setShowRenameModal(false);
      return; // No change
    }

    setRenameLoading(true);
    setRenameError(null);

    try {
      const response = await fetch("/api/knowledge/rename", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          knowledgeBaseId: kbToRename.id,
          newName: newKbName.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to rename knowledge base");
      }

      setKnowledgeBases(prev =>
        prev.map(kb =>
          kb.id === kbToRename.id ? { ...kb, name: newKbName.trim() } : kb
        )
      );
      setShowRenameModal(false);
    } catch (err: any) {
      setRenameError(err.message);
    } finally {
      setRenameLoading(false);
    }
  };

  // Handle clicking on a list item
  const handleItemClick = (id: string) => {
    // If the clicked item is already selected, deselect it
    if (id === selectedKnowledgeBaseId) {
      onSelectKnowledgeBase(null)
    } else {
      onSelectKnowledgeBase(id)
    }
  }

  return (
    <div className="space-y-4">
      {loading && (
        <div className="flex items-center justify-center p-6">
          <div className="flex animate-pulse flex-col items-center">
            <Loader2 className="mb-2 size-8 animate-spin text-foreground" />
            <p className="text-sm text-muted-foreground">Loading databases...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            {error.includes('Company') || error.includes('Berechtigung') ? (
              <AlertTriangle className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-sm text-muted-foreground">{error}</p>
              {(error.includes('Company') || error.includes('Berechtigung')) && (
                <p className="text-xs text-muted-foreground mt-2">
                  Kontaktieren Sie Ihren Administrator, um Zugang zu erhalten.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && knowledgeBases.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-8">
          <DatabaseIcon className="mb-3 size-12 text-muted-foreground opacity-50" />
          <p className="text-center text-sm text-muted-foreground">
            No databases found
          </p>
        </div>
      )}

      {/* Inline create row */}
      {isCreating && (
        <div className="flex items-center gap-1.5 px-1 py-1">
          <input
            ref={nameInputRef}
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            placeholder="Name..."
            className="min-w-0 flex-1 rounded-md border border-[#333] bg-transparent px-2 py-1.5 text-[13px] text-white placeholder:text-gray-500 focus:border-white/30 focus:outline-none"
            disabled={createLoading}
            autoFocus
          />
          <select
            value={newLanguage}
            onChange={e => setNewLanguage(e.target.value)}
            className="w-[72px] rounded-md border border-[#333] bg-transparent px-1.5 py-1.5 text-[11px] text-gray-300 focus:border-white/30 focus:outline-none"
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
              <button
                onClick={handleConfirmCreate}
                disabled={!newName.trim()}
                className="rounded p-1 text-gray-400 transition-colors hover:text-white disabled:opacity-30"
                title="Erstellen (Enter)"
              >
                <Plus className="size-3.5" />
              </button>
              <button
                onClick={handleCancelCreate}
                className="rounded p-1 text-gray-500 transition-colors hover:text-white"
                title="Abbrechen (Esc)"
              >
                <X className="size-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {!loading && !error && knowledgeBases.length > 0 && (
        <div className="space-y-1.5">
          {knowledgeBases.map(kb => {
            // Determine if the current item is selected
            const isSelected = kb.id === selectedKnowledgeBaseId
            return (
              <div
                key={kb.id}
                onClick={() => handleItemClick(kb.id)}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 transition-all duration-150 ease-in-out ${
                  selectedKnowledgeBaseId === kb.id
                    ? "border border-white/15 bg-white/[0.05]"
                    : "border border-transparent hover:border-white/10 hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <KnowledgeStackIcon isSelected={isSelected} />
                  <span className="text-[13px] font-medium text-foreground/95 truncate" title={kb.name}>{kb.name}</span>
                </div>
                <div className="flex items-center flex-shrink-0">
                  {/* Rename Button - always visible on touch, hover on desktop */}
                  <button
                    onClick={(e) => handleRenameClick(kb, e)}
                    className={`ml-1 rounded p-1.5 sm:p-1 text-muted-foreground transition-all hover:bg-white/10 hover:text-foreground ${selectedKnowledgeBaseId === kb.id ? 'opacity-100' : 'opacity-100 sm:opacity-0 group-hover:opacity-100'}`}
                    title="Wissensdatenbank umbenennen"
                  >
                    <Pencil size={13} />
                  </button>
                  {/* Delete Button - always visible on touch, hover on desktop */}
                  <button
                    onClick={(e) => handleDeleteClick(kb.id, kb.name, e)}
                    className={`ml-0.5 rounded p-1.5 sm:p-1 text-foreground/40 transition-all hover:bg-white/10 hover:text-foreground ${selectedKnowledgeBaseId === kb.id ? 'opacity-100' : 'opacity-100 sm:opacity-0 group-hover:opacity-100'}`}
                    title="Wissensdatenbank löschen"
                    disabled={deleteLoading}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create button moved to parent component for fixed positioning */}
      {/* 
      <button
        onClick={handleCreateNew}
        className="group mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary
         px-4 py-3 text-sm font-medium text-foreground transition-all
         duration-200 hover:bg-pink-600 hover:shadow-lg hover:shadow-pink-500/10"
        disabled={loading}
      >
        <Plus className="size-4 transition-transform duration-200 group-hover:rotate-90" />
        <span>Create New Knowledge Base</span>
      </button>
      */}

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

      {/* Delete Confirmation Modal */}
      {showDeleteModal && kbToDeleteId && (
        <ModalPortal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
          <div className="w-full max-w-md rounded-xl bg-[#1e1e1e] p-4 sm:p-6 shadow-2xl border border-white/10">
            <h3 className="mb-2 text-base sm:text-lg font-semibold text-foreground">Löschen bestätigen</h3>
            <p className="mb-4 sm:mb-5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Sind Sie sicher, dass Sie die Wissensdatenbank "
              <span className="font-medium text-foreground">
                {knowledgeBases.find(kb => kb.id === kbToDeleteId)?.name}
              </span>
              " löschen möchten? Alle zugehörigen Daten (hochgeladene Dokumente, extrahierte Abschnitte/Fakten) werden dauerhaft entfernt.
            </p>
            {/* Bestätigungsfeld */}
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Bestätigung (Groß-/Kleinschreibung beachten)</label>
              <input
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder={`Geben Sie exakt: "${knowledgeBases.find(kb => kb.id === kbToDeleteId)?.name}" ein`}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {deleteError && (
              <p className="mb-4 rounded border border-primary/30 bg-primary/10 p-2 text-xs text-pink-300">
                Fehler: {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmInput(""); setDeleteError(null); }}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                disabled={deleteLoading}
              >
                Abbrechen
              </button>
              <button
                onClick={handleConfirmDelete}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-pink-600 focus:outline-none focus:ring-2 focus:ring-pink-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={deleteLoading || deleteConfirmInput !== `${knowledgeBases.find(kb => kb.id === kbToDeleteId)?.name}`}
                aria-busy={deleteLoading}
              >
                {deleteLoading ? 'Löschen…' : 'Endgültig löschen'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Rename Modal */}
      {showRenameModal && kbToRename && (
        <ModalPortal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
          <div className="w-full max-w-md rounded-xl bg-[#1e1e1e] p-4 sm:p-6 shadow-2xl border border-white/10">
            <h3 className="mb-2 text-base sm:text-lg font-semibold text-foreground">Wissensdatenbank umbenennen</h3>
            <p className="mb-5 text-sm text-muted-foreground leading-relaxed">
              Geben Sie einen neuen Namen für die Wissensdatenbank "{kbToRename.name}" ein.
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Neuer Name</label>
              <input
                type="text"
                value={newKbName}
                onChange={(e) => setNewKbName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {renameError && (
              <p className="mb-4 rounded border border-primary/30 bg-primary/10 p-2 text-xs text-pink-300">
                Fehler: {renameError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRenameModal(false)}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                disabled={renameLoading}
              >
                Abbrechen
              </button>
              <button
                onClick={handleConfirmRename}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-pink-600 focus:outline-none focus:ring-2 focus:ring-pink-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={renameLoading}
              >
                {renameLoading ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
