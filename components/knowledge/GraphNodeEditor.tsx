"use client"

/**
 * Eigene Verknüpfungen im Knowledge Graph pflegen.
 * =====================================================================
 * Sitzt im Detailpanel des gewählten Knotens und kann drei Dinge:
 *
 *   Bearbeiten     — Name, Typ und Beschreibung ändern
 *   Verknüpfen     — eine Kante zu einer anderen Entität ziehen
 *   Zusammenführen — eine Variante desselben Begriffs einschmelzen
 *
 * Warum das letzte wichtig ist: der Extraktor erzeugt trotz Normalisierung
 * weiterhin Varianten ("Gutschein" / "Gutscheincode" / "Gutschein-Code"),
 * und jede trägt eigene Kanten. Von einer aus erreicht die Traversierung
 * dann nur einen Teil der Nachbarschaft.
 *
 * Alles hier Gepflegte bekommt origin='manual' und überlebt jeden
 * Neuaufbau — der Extraktor fasst solche Zeilen nie an.
 *
 * Keine Popups (UI-Regel): die Formulare klappen inline auf.
 */
import { useMemo, useState } from "react"
import { Link2, Loader2, Merge, Pencil, Trash2 } from "lucide-react"

import { apiFetch } from "@/lib/api-fetch"

const ENTITY_TYPES: Array<[string, string]> = [
  ["person", "Person"],
  ["organization", "Organisation"],
  ["location", "Ort"],
  ["role", "Rolle"],
  ["feature", "Feature"],
  ["rule", "Regel"],
  ["step", "Schritt"],
  ["spec", "Spezifikation"],
  ["contact", "Kontakt"],
  ["definition", "Definition"],
  ["process", "Prozess"],
  ["product", "Produkt"],
]

const RELATION_TYPES: Array<[string, string]> = [
  ["requires", "setzt voraus"],
  ["part_of", "ist Teil von"],
  ["belongs_to", "gehört zu"],
  ["uses", "nutzt"],
  ["produces", "erzeugt"],
  ["defines", "definiert"],
  ["responsible_for", "zuständig für"],
  ["manages", "verwaltet"],
  ["follows", "folgt auf"],
  ["located_at", "befindet sich bei"],
  ["related_to", "hängt zusammen mit"],
]

interface NodeLike {
  id: string
  label: string
  type: string
  description: string
}

interface Props {
  node: NodeLike
  /** Alle Knoten, für die Auswahl beim Verknüpfen und Zusammenführen. */
  allNodes: NodeLike[]
  /** Nach jeder Änderung: Graph neu laden. */
  onChanged: () => void
}

type Mode = null | "edit" | "link" | "merge"

const inputClass =
  "w-full bg-[#161616] border border-white/[0.07] rounded-md px-2 py-1.5 text-[11px] " +
  "text-white/80 placeholder:text-white/20 outline-none focus:border-primary/40 transition-colors"

export default function GraphNodeEditor({ node, allNodes, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [name, setName] = useState(node.label)
  const [type, setType] = useState(node.type)
  const [description, setDescription] = useState(node.description)

  const [partnerQuery, setPartnerQuery] = useState("")
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [relationType, setRelationType] = useState("related_to")

  const candidates = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase()
    if (!q) return []
    return allNodes
      .filter((n) => n.id !== node.id && n.label.toLowerCase().includes(q))
      .slice(0, 6)
  }, [partnerQuery, allNodes, node.id])

  const partner = allNodes.find((n) => n.id === partnerId) || null

  const call = async (
    path: string,
    method: string,
    body: Record<string, unknown>,
    successText: string
  ) => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await apiFetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error || "Hat nicht geklappt.")
        return false
      }
      setMessage(successText)
      setMode(null)
      setPartnerId(null)
      setPartnerQuery("")
      onChanged()
      return true
    } catch {
      setMessage("Hat nicht geklappt.")
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    call(
      "/api/knowledge/graph/entity",
      "PATCH",
      { entity_id: node.id, name, entity_type: type, description },
      "Gespeichert."
    )

  const link = () => {
    if (!partnerId) return
    return call(
      "/api/knowledge/graph/relation",
      "POST",
      {
        source_entity_id: node.id,
        target_entity_id: partnerId,
        relation_type: relationType,
      },
      "Verknüpft."
    )
  }

  const merge = () => {
    if (!partnerId) return
    // Der gewählte Knoten bleibt, der Partner wird eingeschmolzen.
    return call(
      "/api/knowledge/graph/merge",
      "POST",
      { keep_entity_id: node.id, drop_entity_id: partnerId },
      "Zusammengeführt."
    )
  }

  const remove = () =>
    call(
      "/api/knowledge/graph/entity",
      "DELETE",
      { entity_id: node.id },
      "Gelöscht."
    )

  const PartnerPicker = ({ label }: { label: string }) => (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        value={partner ? partner.label : partnerQuery}
        onChange={(e) => {
          setPartnerId(null)
          setPartnerQuery(e.target.value)
        }}
        placeholder={label}
        className={inputClass}
      />
      {!partner && candidates.length > 0 && (
        <div className="flex flex-col bg-[#161616] border border-white/[0.06] rounded-md overflow-hidden">
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setPartnerId(c.id)
                setPartnerQuery("")
              }}
              className="text-left px-2 py-1 text-[11px] text-white/60 hover:bg-white/[0.05] hover:text-white/85 transition-colors truncate"
            >
              {c.label}
              <span className="text-white/25 ml-1.5">{c.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.05] flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {(
          [
            ["edit", Pencil, "Bearbeiten"],
            ["link", Link2, "Verknüpfen"],
            ["merge", Merge, "Zusammenführen"],
          ] as const
        ).map(([m, Icon, label]) => (
          <button
            key={m}
            onClick={() => {
              setMode(mode === m ? null : m)
              setMessage(null)
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors ${
              mode === m
                ? "bg-primary/15 text-primary"
                : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
            }`}
          >
            <Icon className="size-3" />
            {label}
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={remove}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-white/30 hover:text-red-400/90 hover:bg-red-500/[0.06] disabled:opacity-30 transition-colors"
          title="Entität und ihre Verknüpfungen entfernen"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {mode === "edit" && (
        <div className="flex flex-col gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Name" />
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            {ENTITY_TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Beschreibung"
            className={`${inputClass} resize-none`}
          />
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/15 text-primary text-[10px] hover:bg-primary/25 disabled:opacity-30 transition-colors"
          >
            {busy && <Loader2 className="size-3 animate-spin" />}
            Speichern
          </button>
        </div>
      )}

      {mode === "link" && (
        <div className="flex flex-col gap-1.5">
          <select
            value={relationType}
            onChange={(e) => setRelationType(e.target.value)}
            className={inputClass}
          >
            {RELATION_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {node.label} {l} …
              </option>
            ))}
          </select>
          <PartnerPicker label="Womit verknüpfen?" />
          <button
            onClick={link}
            disabled={busy || !partnerId}
            className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/15 text-primary text-[10px] hover:bg-primary/25 disabled:opacity-30 transition-colors"
          >
            {busy && <Loader2 className="size-3 animate-spin" />}
            Verknüpfen
          </button>
        </div>
      )}

      {mode === "merge" && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] text-white/35 leading-relaxed">
            Die gewählte Entität bleibt bestehen. Die andere wird eingeschmolzen:
            ihre Verknüpfungen und Belege wandern herüber.
          </div>
          <PartnerPicker label="Welche Entität einschmelzen?" />
          <button
            onClick={merge}
            disabled={busy || !partnerId}
            className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/15 text-primary text-[10px] hover:bg-primary/25 disabled:opacity-30 transition-colors"
          >
            {busy && <Loader2 className="size-3 animate-spin" />}
            In „{node.label}" zusammenführen
          </button>
        </div>
      )}

      {message && <div className="text-[10px] text-white/45">{message}</div>}
    </div>
  )
}
