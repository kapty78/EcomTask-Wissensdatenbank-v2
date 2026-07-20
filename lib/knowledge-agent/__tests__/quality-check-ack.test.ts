/**
 * @jest-environment node
 *
 * Regression: der Qualitaetspruefer (skill_quality_check) darf einen Save mit
 * verdict='reject' hart ablehnen (HTTP 422). Sein eigener System-Prompt sah
 * dafuer seit jeher ein Uebersteuern vor — "kann mit ack=true ueberschreiben" —
 * aber `ack` war NIRGENDS implementiert: nicht im Router, nicht im Payload,
 * nicht im Agenten-Tool.
 *
 * Live-Folge 2026-07-20: Auftrag "Skills zusammenfuehren". Eine konsolidierte
 * Skill deckt per Definition ab, was die alten abdeckten — der Pruefer sieht
 * nur Name+Beschreibung und kann Absicht (Zusammenfuehren) nicht von Wildwuchs
 * (20. Dublette) unterscheiden. Ergebnis: 5 abgelehnte Schreibversuche in
 * Folge, kein Fortschritt, der Agent probierte Formulierungsvarianten durch.
 *
 * Zwei Invarianten sichern das ab:
 *   1. jedes Tool, dessen Save abgelehnt werden kann, bietet `ack` an
 *   2. Fehlermeldungen des Skills-Backends reichen die Handlungsanweisung
 *      (`hint`) mit durch — sonst kennt der Agent den Ausweg nicht
 */
import fs from "fs"
import path from "path"
import { KNOWLEDGE_AGENT_TOOLS } from "../tool-schema"

const ROUTE = path.join(process.cwd(), "app/api/knowledge/agent/route.ts")

/** Schreib-Tools, die der Qualitaetspruefer mit 422 ablehnen kann. */
const GATED_WRITE_TOOLS = [
  "create_skill",
  "update_skill",
  "create_standard_answer",
  "update_standard_answer",
] as const

function toolByName(name: string): any {
  return (KNOWLEDGE_AGENT_TOOLS as readonly any[]).find((t) => t?.function?.name === name)
}

describe("Uebersteuern des Qualitaetspruefers", () => {
  it.each(GATED_WRITE_TOOLS)("%s bietet ack an", (name) => {
    const props = toolByName(name)?.function?.parameters?.properties
    expect(props).toBeDefined()
    expect(props.ack).toBeDefined()
    expect(props.ack.type).toBe("boolean")
  })

  it.each(GATED_WRITE_TOOLS)("%s erzwingt ack NICHT (Default = ohne)", (name) => {
    // ack darf nie Pflicht sein: der erste Versuch laeuft bewusst ohne, damit
    // der Pruefer echte Dubletten weiterhin abfaengt.
    const required = toolByName(name)?.function?.parameters?.required ?? []
    expect(required).not.toContain("ack")
  })

  const src = fs.readFileSync(ROUTE, "utf8")

  it("reicht ack in allen vier Schreib-Aufrufen ans Backend durch", () => {
    const wired = src.match(/\.\.\.\(args\?\.ack === true \? \{ query: \{ ack: "true" \} \} : \{\}\)/g)
    expect(wired).toHaveLength(GATED_WRITE_TOOLS.length)
  })

  it("gibt die Handlungsanweisung des Backends an den Agenten weiter", () => {
    // Ohne den hint kennt der Agent nur den Grund der Ablehnung, nicht den Weg
    // heraus — genau das fuehrte zu den Formulierungs-Durchprobierschleifen.
    expect(src).toMatch(/data\?\.hint \?/)
  })
})
