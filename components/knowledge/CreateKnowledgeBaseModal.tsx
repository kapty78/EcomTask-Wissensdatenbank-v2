"use client"

import React, { useState, FC } from "react"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { Database } from "@/supabase/types"
import { Tables } from "@/supabase/types"
import {
  X,
  Database as DatabaseIcon,
  AlertCircle,
  Loader2,
  Plus
} from "lucide-react"

type KnowledgeBase = Tables<"knowledge_bases">

interface CreateKnowledgeBaseModalProps {
  userId: string
  isOpen: boolean
  onClose: () => void
  onKnowledgeBaseCreated: (newKb: KnowledgeBase) => void
}

export const CreateKnowledgeBaseModal: FC<CreateKnowledgeBaseModalProps> = ({
  userId,
  isOpen,
  onClose,
  onKnowledgeBaseCreated
}) => {
  const supabase = createClientComponentClient<Database>()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [language, setLanguage] = useState("de")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError("Name ist erforderlich.")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data, error: insertError } = await supabase
        .from("knowledge_bases")
        .insert({
          user_id: userId,
          name: name.trim(),
          description: description.trim() || null,
          language
        })
        .select() // Select the newly created row
        .single() // Expect a single row back

      if (insertError) {
        throw insertError
      }

      if (data) {
        // console.log("Datenbank erfolgreich erstellt:", data)
        onKnowledgeBaseCreated(data) // Pass the new KB back to the list
        handleClose() // Close modal on success
      } else {
        throw new Error("Fehler beim Abrufen der erstellten Datenbank.")
      }
    } catch (err: any) {
      // console.error("Fehler beim Erstellen der Datenbank:", err)
      setError(`Fehler beim Erstellen der Datenbank: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    // Reset form state on close
    setName("")
    setDescription("")
    setLanguage("de")
    setError(null)
    setLoading(false)
    onClose()
  }

  if (!isOpen) {
    return null
  }

  // Modal Structure with updated design
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm transition-all duration-200">
      <div className="w-full max-w-md rounded-xl border border-[#333333] bg-gradient-to-b from-[#252525] to-[#1e1e1e] p-6 shadow-xl transition-all duration-200">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gradient-to-r from-pink-500/20 to-pink-600/20 p-2">
              <DatabaseIcon className="size-5 text-pink-500" />
            </div>
            <h2 className="text-lg font-bold text-white">
              Neue Datenbank erstellen
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-1 transition-colors hover:bg-white/10"
          >
            <X className="size-5 text-gray-400 hover:text-white" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="kb-name"
              className="mb-1.5 block text-sm font-medium text-gray-200"
            >
              Name <span className="text-pink-500">*</span>
            </label>
            <input
              type="text"
              id="kb-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="z.B. Produktdokumentation"
              className="w-full rounded-md border border-[#333333] bg-[#252525]/30 p-2.5 text-sm text-white transition-all placeholder:text-gray-500 focus:border-pink-500/50 focus:outline-none focus:ring-1 focus:ring-pink-500/50"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label
              htmlFor="kb-description"
              className="mb-1.5 block text-sm font-medium text-gray-200"
            >
              Beschreibung <span className="text-gray-400">(Optional)</span>
            </label>
            <textarea
              id="kb-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Kurze Beschreibung des Inhalts dieser Datenbank."
              rows={3}
              className="w-full rounded-md border border-[#333333] bg-[#252525]/30 p-2.5 text-sm text-white transition-all placeholder:text-gray-500 focus:border-pink-500/50 focus:outline-none focus:ring-1 focus:ring-pink-500/50"
              disabled={loading}
            />
          </div>

          <div>
            <label
              htmlFor="kb-language"
              className="mb-1.5 block text-sm font-medium text-gray-200"
            >
              Sprache der Wissensdatenbank
            </label>
            <select
              id="kb-language"
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="w-full rounded-md border border-[#333333] bg-[#252525]/30 p-2.5 text-sm text-white transition-all focus:border-pink-500/50 focus:outline-none focus:ring-1 focus:ring-pink-500/50"
              disabled={loading}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="it">Italiano</option>
              <option value="nl">Nederlands</option>
              <option value="pl">Polski</option>
              <option value="pt">Português</option>
            </select>
          </div>

          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3">
              <p className="flex items-center text-sm text-red-300">
                <AlertCircle className="mr-2 size-4 text-red-400" />
                {error}
              </p>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="rounded-md border border-[#333333] px-4 py-2.5 text-sm font-medium text-gray-300 transition-all duration-200 hover:bg-white/5 hover:text-white disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center rounded-md bg-pink-500 px-4 py-2.5 text-sm font-medium text-white shadow-md transition-all duration-200 hover:bg-pink-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  <span>Wird erstellt...</span>
                </>
              ) : (
                <>
                  <Plus className="mr-2 size-4" />
                  <span>Datenbank erstellen</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
