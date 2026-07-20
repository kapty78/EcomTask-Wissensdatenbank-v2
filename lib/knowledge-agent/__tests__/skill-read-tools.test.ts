/**
 * @jest-environment node
 *
 * Regression: jede Entitaet, die der Agent SCHREIBEN kann, muss er auch
 * VOLLSTAENDIG LESEN koennen — und das Leseergebnis darf in der History nicht
 * gekuerzt werden.
 *
 * Live-Ausfall 2026-07-20: es gab `list_skills`, `create_skill` und
 * `update_skill`, aber kein `get_skill`. `list_skills` liefert nur die
 * Zusammenfassung (Name/Beschreibung/Tags), NICHT den Workflow-Body — der
 * Agent konnte eine Skill also gar nicht lesen. Beim Auftrag "Skills
 * aufraeumen/zusammenfuehren" wich er auf `get_standard_answer` mit Skill-IDs
 * aus (-> "Standard answer not found.", weil beide Arten dieselbe Tabelle
 * teilen und nur ueber `kind` getrennt sind), verbrannte Runden und fragte
 * am Ende den User statt zu arbeiten.
 *
 * Zweiter, stillerer Teil desselben Problems: das History-Budget kuerzt
 * Tool-Ergebnisse (Strings auf 400 Zeichen). Ein `get_*`, dessen Ergebnis
 * Grundlage eines `update_*` ist, MUSS in FULL_RESULT_TOOLS stehen — sonst
 * schreibt der Agent den gekuerzten Body zurueck und der Rest ist weg.
 */
import fs from "fs"
import path from "path"
import { KNOWLEDGE_AGENT_TOOLS } from "../tool-schema"

const ROUTE = path.join(process.cwd(), "app/api/knowledge/agent/route.ts")

/** Schreib-Tool -> Lese-Tool, dessen Ergebnis die Schreib-Grundlage ist. */
const READ_BEFORE_WRITE: ReadonlyArray<readonly [string, string]> = [
  ["update_skill", "get_skill"],
  ["update_standard_answer", "get_standard_answer"],
  ["update_chunk_content", "get_chunk_details"],
]

const toolNames = new Set(
  (KNOWLEDGE_AGENT_TOOLS as readonly any[]).map((t) => t?.function?.name).filter(Boolean),
)

function toolByName(name: string): any {
  return (KNOWLEDGE_AGENT_TOOLS as readonly any[]).find((t) => t?.function?.name === name)
}

describe("Skills sind lesbar, nicht nur schreibbar", () => {
  it("stellt get_skill mit Pflichtparameter skill_id bereit", () => {
    const tool = toolByName("get_skill")
    expect(tool).toBeDefined()
    expect(tool.function.parameters.required).toEqual(["skill_id"])
  })

  it("stellt delete_skill bereit (Zusammenfuehren braucht Loeschen)", () => {
    const tool = toolByName("delete_skill")
    expect(tool).toBeDefined()
    expect(tool.function.parameters.required).toEqual(["skill_id"])
  })

  it("hat zu jedem update_* das passende Lese-Tool", () => {
    const missing = READ_BEFORE_WRITE.filter(
      ([write, read]) => toolNames.has(write) && !toolNames.has(read),
    ).map(([write, read]) => `${write} ohne ${read}`)
    expect(missing).toEqual([])
  })
})

describe("Lesequellen fuer Read-Modify-Write werden nicht gekuerzt", () => {
  const src = fs.readFileSync(ROUTE, "utf8")
  const fullResult = src.match(/const FULL_RESULT_TOOLS = new Set\(\[([^\]]*)\]\)/)

  it("findet die FULL_RESULT_TOOLS-Deklaration", () => {
    expect(fullResult).not.toBeNull()
  })

  it.each(READ_BEFORE_WRITE.map(([, read]) => read))(
    "%s steht in FULL_RESULT_TOOLS",
    (read) => {
      expect(fullResult![1]).toContain(`"${read}"`)
    },
  )
})
