"use client"

import { useCallback, useEffect, useState } from "react"
import { Workflow, Plus, Pencil, Trash2, Loader2, X, AlertCircle } from "lucide-react"

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/

type Skill = {
  id: string
  knowledge_base_id: string | null
  name: string
  description: string
  tags: string[]
  token_count_body: number
  current_version: number
}

type SkillDetail = Skill & { body: string }

interface SkillsViewProps {
  /** Aktive Datenbank — neue Skills werden unter dieser angelegt. */
  knowledgeBaseId: string
  knowledgeBaseName?: string | null
}

const EMPTY_FORM = { id: "", name: "", description: "", body: "", tags: "" }

export default function SkillsView({ knowledgeBaseId, knowledgeBaseName }: SkillsViewProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formNote, setFormNote] = useState<string | null>(null)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const reload = useCallback(async () => {
    if (!knowledgeBaseId) return
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/skills?knowledge_base_id=${encodeURIComponent(knowledgeBaseId)}`, { method: "GET" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
      setSkills(data.items || [])
    } catch (e: any) {
      setLoadError(e?.message || "Laden fehlgeschlagen")
    } finally {
      setIsLoading(false)
    }
  }, [knowledgeBaseId])

  useEffect(() => { reload() }, [reload])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setIsEditing(false)
    setFormError(null)
    setFormNote(null)
    setEditorOpen(true)
  }

  const openEdit = async (skillId: string) => {
    setFormError(null)
    setFormNote(null)
    try {
      const res = await fetch(`/api/skills/${skillId}`, { method: "GET" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
      setForm({ id: data.id, name: data.name, description: data.description, body: data.body || "", tags: (data.tags || []).join(", ") })
      setIsEditing(true)
      setEditorOpen(true)
    } catch (e: any) {
      setLoadError(`Skill laden fehlgeschlagen: ${e?.message || e}`)
    }
  }

  const save = async () => {
    const name = form.name.trim()
    const description = form.description.trim()
    const body = form.body.trim()
    setFormError(null)
    setFormNote(null)
    if (!NAME_RE.test(name)) { setFormError("Name muss kebab-case sein (2–40 Zeichen, a–z 0–9 und Bindestrich)."); return }
    if (description.length < 20 || description.length > 500) { setFormError("Beschreibung muss 20–500 Zeichen lang sein."); return }
    if (!body) { setFormError("Der Workflow-Body darf nicht leer sein."); return }
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean)
    setSaving(true)
    try {
      let res: Response
      if (isEditing) {
        res = await fetch(`/api/skills/${form.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, body, tags }),
        })
      } else {
        res = await fetch(`/api/skills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, body, tags, knowledge_base_id: knowledgeBaseId }),
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(data?.reason || data?.detail || data?.errors?.[0]?.message || `HTTP ${res.status}`)
        return
      }
      const warns = (data.token_warnings || []).filter((w: any) => w.level !== "info")
      if (data.quality_check?.verdict === "overlap_warning") {
        setFormNote(`Angelegt — Hinweis: ${data.quality_check.reason || "mögliche Überlappung mit bestehendem Skill."}`)
      }
      if (warns.length) setFormNote((prev) => [prev, ...warns.map((w: any) => w.message)].filter(Boolean).join(" "))
      setEditorOpen(false)
      await reload()
    } catch (e: any) {
      setFormError(`Speichern fehlgeschlagen: ${e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async (skillId: string) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/skills/${skillId}?force=true`, { method: "DELETE" })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        setLoadError(data?.detail || `Löschen fehlgeschlagen (HTTP ${res.status})`)
        return
      }
      setDeleteId(null)
      await reload()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0 p-2 sm:p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Skills (Workflow-Pakete) unter <span className="text-foreground/90 font-medium">{knowledgeBaseName || "dieser Datenbank"}</span>.
          Mehrschrittige, situative Abläufe — der Mail-Agent lädt sie bei passender Anfrage.
          Freigeschaltet werden sie pro Agent in der SupportAI.
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs sm:text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-pink-600 whitespace-nowrap"
        >
          <Plus className="size-4" /> Skill anlegen
        </button>
      </div>

      {loadError && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-pink-500/30 bg-pink-500/10 px-3 py-2 text-xs text-foreground/85">
          <AlertCircle className="size-3.5 text-pink-400" /> {loadError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="size-4 animate-spin" /> Skills werden geladen…
          </div>
        ) : skills.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-[#1e1e1e] px-4 py-6 text-center text-xs text-muted-foreground">
            Noch keine Skills unter dieser Datenbank. Lege einen mehrschrittigen Workflow an
            (z.B. „Sammelbestellungen eines Großhändlers abwickeln").
          </div>
        ) : (
          skills.map((s) => (
            <div key={s.id} className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2.5">
              <Workflow className="mt-0.5 size-4 shrink-0 text-pink-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] text-foreground/90">{s.name}</span>
                  <span className="text-[10.5px] text-muted-foreground">{s.token_count_body} Token · v{s.current_version}</span>
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground line-clamp-2">{s.description}</p>
                {s.tags?.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.tags.map((t) => (
                      <span key={t} className="rounded border border-pink-500/30 px-1.5 py-0.5 text-[10px] text-foreground/70">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(s.id)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="Bearbeiten">
                  <Pencil className="size-3.5" />
                </button>
                <button onClick={() => setDeleteId(s.id)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-pink-400" title="Löschen">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Editor-Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setEditorOpen(false)}>
          <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#1a1a1a] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">{isEditing ? "Skill bearbeiten" : "Neue Skill anlegen"}</h3>
              <button onClick={() => !saving && setEditorOpen(false)} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            </div>
            <div className="space-y-3 px-4 py-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Name (kebab-case)</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="grosshaendler-bestellung"
                  disabled={isEditing}
                  className="w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-pink-500/50 focus:outline-none disabled:opacity-60"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Beschreibung / Trigger (20–500 Zeichen)</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Aufrufen bei Sammelbestellungen eines Großhändlers (No-Reply-Mails mit Artikelliste)."
                  className="min-h-[60px] w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-pink-500/50 focus:outline-none"
                />
                <div className="text-[10.5px] text-muted-foreground">{form.description.length}/500 Zeichen</div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Workflow / Body (Markdown, max. ~2000 Token)</label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder={"## Workflow\n1. Artikel aus der Liste extrahieren\n2. Lieferzeit pro Artikel prüfen\n3. Auftragsbestätigung mit Sammeltermin antworten"}
                  className="min-h-[200px] w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:border-pink-500/50 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tags (kommagetrennt, optional)</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="bestellung, grosshaendler"
                  className="w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-pink-500/50 focus:outline-none"
                />
              </div>
              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-pink-500/40 bg-pink-500/10 px-3 py-2 text-xs text-foreground/90">
                  <AlertCircle className="size-3.5 text-pink-400 shrink-0" /> {formError}
                </div>
              )}
              {formNote && (
                <div className="rounded-lg border border-pink-500/20 bg-pink-500/[0.06] px-3 py-2 text-xs text-foreground/80">{formNote}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
              <button onClick={() => setEditorOpen(false)} disabled={saving} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">Abbrechen</button>
              <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-foreground hover:bg-pink-600 disabled:opacity-50">
                {saving && <Loader2 className="size-3.5 animate-spin" />} {isEditing ? "Speichern" : "Anlegen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Löschen-Bestätigung */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !deleting && setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#1a1a1a] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">Skill löschen?</h3>
            <p className="mt-1 text-xs text-muted-foreground">Diese Aktion entfernt den Skill endgültig (inkl. aller Agent-Freischaltungen). Die Versionshistorie bleibt als Audit erhalten.</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setDeleteId(null)} disabled={deleting} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50">Abbrechen</button>
              <button onClick={() => doDelete(deleteId)} disabled={deleting} className="flex items-center gap-1.5 rounded-lg bg-pink-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-pink-700 disabled:opacity-50">
                {deleting && <Loader2 className="size-3.5 animate-spin" />} Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
