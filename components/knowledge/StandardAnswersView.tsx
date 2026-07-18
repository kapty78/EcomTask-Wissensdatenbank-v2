"use client"

import { apiFetch } from "@/lib/api-fetch"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { TextQuote, Plus, Pencil, Trash2, Loader2, X, AlertCircle, Building2, Database, Lock } from "lucide-react"

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/

type AnswerMode = "adaptive" | "verbatim"

type StandardAnswer = {
  id: string
  knowledge_base_id: string | null
  answer_mode: AnswerMode
  name: string
  description: string
  tags: string[]
  token_count_body: number
  current_version: number
}

/** Zuordnung: an die aktive Datenbank oder firmenweit ("Allgemein"). */
type AnswerScope = "kb" | "general"

interface StandardAnswersViewProps {
  /** Aktive Datenbank — neue Standardantworten werden standardmäßig unter dieser angelegt. */
  knowledgeBaseId: string
  knowledgeBaseName?: string | null
}

const EMPTY_FORM = { id: "", name: "", description: "", body: "", tags: "", scope: "kb" as AnswerScope, answerMode: "adaptive" as AnswerMode }

export default function StandardAnswersView({ knowledgeBaseId, knowledgeBaseName }: StandardAnswersViewProps) {
  const [answers, setAnswers] = useState<StandardAnswer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Erfolgs-/Warnhinweis auf Seitenebene (überlebt das Schließen des Editors).
  const [actionNote, setActionNote] = useState<string | null>(null)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Sequenz-Token gegen Out-of-Order-Antworten beim Datenbank-Wechsel.
  const reloadSeq = useRef(0)

  const reload = useCallback(async () => {
    if (!knowledgeBaseId) return
    const seq = ++reloadSeq.current
    setIsLoading(true)
    setLoadError(null)
    try {
      // Standardantworten dieser Datenbank UND firmenweite ("Allgemein") laden.
      const [kbRes, generalRes] = await Promise.all([
        apiFetch(`/api/standard-answers?knowledge_base_id=${encodeURIComponent(knowledgeBaseId)}&limit=100`, { method: "GET" }),
        apiFetch(`/api/standard-answers?only_general=true&limit=100`, { method: "GET" }),
      ])
      const [kbData, generalData] = await Promise.all([kbRes.json(), generalRes.json()])
      if (seq !== reloadSeq.current) return
      if (!kbRes.ok) throw new Error(kbData?.error || kbData?.detail || `HTTP ${kbRes.status}`)
      if (!generalRes.ok) throw new Error(generalData?.error || generalData?.detail || `HTTP ${generalRes.status}`)
      setAnswers([...(kbData.items || []), ...(generalData.items || [])])
    } catch (e: any) {
      if (seq !== reloadSeq.current) return
      setLoadError(e?.message || "Laden fehlgeschlagen")
    } finally {
      if (seq === reloadSeq.current) setIsLoading(false)
    }
  }, [knowledgeBaseId])

  useEffect(() => { reload() }, [reload])

  const kbAnswers = useMemo(() => answers.filter((s) => s.knowledge_base_id === knowledgeBaseId), [answers, knowledgeBaseId])
  const generalAnswers = useMemo(() => answers.filter((s) => s.knowledge_base_id == null), [answers])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setIsEditing(false)
    setFormError(null)
    setActionNote(null)
    setEditorOpen(true)
  }

  const openEdit = async (answerId: string) => {
    setFormError(null)
    setActionNote(null)
    try {
      const res = await apiFetch(`/api/standard-answers/${answerId}`, { method: "GET" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`)
      setForm({
        id: data.id,
        name: data.name,
        description: data.description,
        body: data.body || "",
        tags: (data.tags || []).join(", "),
        scope: data.knowledge_base_id ? "kb" : "general",
        answerMode: (data.answer_mode as AnswerMode) || "adaptive",
      })
      setIsEditing(true)
      setEditorOpen(true)
    } catch (e: any) {
      setLoadError(`Standardantwort laden fehlgeschlagen: ${e?.message || e}`)
    }
  }

  const save = async () => {
    const name = form.name.trim()
    const description = form.description.trim()
    const body = form.body.trim()
    setFormError(null)
    setActionNote(null)
    if (!NAME_RE.test(name)) { setFormError("Name muss kebab-case sein (2–40 Zeichen, a–z 0–9 und Bindestrich)."); return }
    if (description.length < 20 || description.length > 500) { setFormError("Beschreibung muss 20–500 Zeichen lang sein."); return }
    if (!body) { setFormError("Der Antworttext darf nicht leer sein."); return }
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean)
    const knowledge_base_id = form.scope === "general" ? null : knowledgeBaseId
    setSaving(true)
    try {
      let res: Response
      const payload = { name, description, body, tags, knowledge_base_id, answer_mode: form.answerMode }
      if (isEditing) {
        res = await apiFetch(`/api/standard-answers/${form.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      } else {
        res = await apiFetch(`/api/standard-answers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(data?.reason || data?.detail || data?.errors?.[0]?.message || `HTTP ${res.status}`)
        return
      }
      const warns = (data.token_warnings || []).filter((w: any) => w.level !== "info")
      const noteParts: string[] = []
      if (data.quality_check?.verdict === "overlap_warning") {
        noteParts.push(`${isEditing ? "Aktualisiert" : "Angelegt"} — Hinweis: ${data.quality_check.reason || "mögliche Überlappung mit bestehender Standardantwort."}`)
      }
      if (warns.length) noteParts.push(...warns.map((w: any) => w.message))
      setActionNote(noteParts.length ? noteParts.join(" ") : null)
      setEditorOpen(false)
      await reload()
    } catch (e: any) {
      setFormError(`Speichern fehlgeschlagen: ${e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async (answerId: string) => {
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/standard-answers/${answerId}?force=true`, { method: "DELETE" })
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

  const renderAnswerCard = (s: StandardAnswer) => (
    <div key={s.id} className="flex items-start gap-3 rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2.5">
      <TextQuote className="mt-0.5 size-4 shrink-0 text-pink-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] text-foreground/90">{s.name}</span>
          {s.answer_mode === "verbatim" && (
            <span className="flex items-center gap-1 rounded border border-pink-500/30 px-1.5 py-0.5 text-[10px] text-foreground/70" title="Wird wörtlich übernommen">
              <Lock className="size-2.5" /> wörtlich
            </span>
          )}
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
  )

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0 p-2 sm:p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Standardantworten (fertige Antworttexte) unter <span className="text-foreground/90 font-medium">{knowledgeBaseName || "dieser Datenbank"}</span>
          {" "}sowie firmenweite („Allgemein", datenbank-übergreifend).
          Der Mail-Agent wählt sie bei passender Anfrage als Antwortgrundlage.
          Freigeschaltet werden sie pro Agent in der SupportAI.
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs sm:text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-pink-600 whitespace-nowrap"
        >
          <Plus className="size-4" /> Standardantwort anlegen
        </button>
      </div>

      {loadError && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-pink-500/30 bg-pink-500/10 px-3 py-2 text-xs text-foreground/85">
          <AlertCircle className="size-3.5 text-pink-400" /> {loadError}
        </div>
      )}

      {actionNote && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-pink-500/20 bg-pink-500/[0.06] px-3 py-2 text-xs text-foreground/80">
          <span className="flex-1">{actionNote}</span>
          <button onClick={() => setActionNote(null)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" title="Schließen">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="size-4 animate-spin" /> Standardantworten werden geladen…
          </div>
        ) : kbAnswers.length === 0 && generalAnswers.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-[#1e1e1e] px-4 py-6 text-center text-xs text-muted-foreground">
            Noch keine Standardantworten. Lege einen fertigen Antworttext an
            (z.B. „Widerrufsbelehrung" oder „Versanddauer-Info").
          </div>
        ) : (
          <>
            {/* Sektion: diese Datenbank */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                <Database className="size-3" /> {knowledgeBaseName || "Diese Datenbank"}
              </div>
              {kbAnswers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-center text-[11px] text-muted-foreground">
                  Noch keine Standardantworten unter dieser Datenbank.
                </div>
              ) : (
                kbAnswers.map(renderAnswerCard)
              )}
            </div>

            {/* Sektion: firmenweit — nur zeigen, wenn vorhanden */}
            {generalAnswers.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Building2 className="size-3" /> Allgemein · firmenweit
                </div>
                {generalAnswers.map(renderAnswerCard)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Editor-Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setEditorOpen(false)}>
          <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#1a1a1a] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">{isEditing ? "Standardantwort bearbeiten" : "Neue Standardantwort anlegen"}</h3>
              <button onClick={() => !saving && setEditorOpen(false)} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            </div>
            <div className="space-y-3 px-4 py-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Name (kebab-case)</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="widerrufsbelehrung"
                  disabled={isEditing}
                  className="w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-pink-500/50 focus:outline-none disabled:opacity-60"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Zuordnung</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, scope: "kb" }))}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] transition-colors ${form.scope === "kb" ? "border-pink-500/60 bg-pink-500/10 text-foreground" : "border-white/10 bg-[#1e1e1e] text-muted-foreground hover:text-foreground"}`}
                  >
                    <Database className="size-3.5" /> {knowledgeBaseName || "Diese Datenbank"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, scope: "general" }))}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] transition-colors ${form.scope === "general" ? "border-pink-500/60 bg-pink-500/10 text-foreground" : "border-white/10 bg-[#1e1e1e] text-muted-foreground hover:text-foreground"}`}
                  >
                    <Building2 className="size-3.5" /> Allgemein · firmenweit
                  </button>
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  {form.scope === "general"
                    ? "Firmenweit: für alle Datenbanken und Agenten dieser Firma freischaltbar."
                    : "Nur für Agenten, denen diese Datenbank zugewiesen ist."}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Beschreibung / Trigger (20–500 Zeichen)</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Verwenden bei Fragen zum Widerrufsrecht oder zur Widerrufsfrist."
                  className="min-h-[60px] w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-pink-500/50 focus:outline-none"
                />
                <div className="text-[10.5px] text-muted-foreground">{form.description.length}/500 Zeichen</div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Antworttext (max. ~2000 Token)</label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder={"Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen…"}
                  className="min-h-[200px] w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:border-pink-500/50 focus:outline-none"
                />
                <div className="text-[10.5px] text-muted-foreground">
                  Ohne Anrede und ohne Signatur anlegen — beides ergänzt der Agent automatisch.
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Modus</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, answerMode: "adaptive" }))}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] transition-colors ${form.answerMode === "adaptive" ? "border-pink-500/60 bg-pink-500/10 text-foreground" : "border-white/10 bg-[#1e1e1e] text-muted-foreground hover:text-foreground"}`}
                  >
                    Anpassbar
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, answerMode: "verbatim" }))}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] transition-colors ${form.answerMode === "verbatim" ? "border-pink-500/60 bg-pink-500/10 text-foreground" : "border-white/10 bg-[#1e1e1e] text-muted-foreground hover:text-foreground"}`}
                  >
                    <Lock className="size-3.5" /> Wörtlich
                  </button>
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  {form.answerMode === "verbatim"
                    ? "Wörtlich: Der Text geht exakt so raus (z.B. juristische Formulierungen). Bei fremder Kundensprache wird sinngetreu übersetzt."
                    : "Anpassbar: Der Agent nutzt den Text als Grundlage und personalisiert Anrede, Sprache und Details."}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tags (kommagetrennt, optional)</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="widerruf, recht"
                  className="w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-pink-500/50 focus:outline-none"
                />
              </div>
              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-pink-500/40 bg-pink-500/10 px-3 py-2 text-xs text-foreground/90">
                  <AlertCircle className="size-3.5 text-pink-400 shrink-0" /> {formError}
                </div>
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
            <h3 className="text-sm font-semibold text-foreground">Standardantwort löschen?</h3>
            <p className="mt-1 text-xs text-muted-foreground">Diese Aktion entfernt die Standardantwort endgültig (inkl. aller Agent-Freischaltungen). Die Versionshistorie bleibt als Audit erhalten.</p>
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
