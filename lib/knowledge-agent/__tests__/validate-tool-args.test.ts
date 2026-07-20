/**
 * @jest-environment node
 *
 * Regression: GLM (Scaleway) haelt `required` im Tool-Schema NICHT ein (kein
 * constrained decoding). Live-Fall 2026-07-20: `update_chunk_content` ohne
 * `chunk_id` → nacktes asString() → "Ungueltiger Parameter: chunk_id" → der
 * Lauf starb nach ~420s, weil das Modell aus der Meldung nicht ableiten konnte,
 * was fehlt oder woher es den Wert bekommt.
 *
 * Die Validierung muss den Fehler VOR der Ausfuehrung fangen UND eine
 * handlungsfaehige Anweisung liefern — sonst ist sie nur ein huebscherer Abbruch.
 */
import { ToolArgumentError, validateToolArgs } from "../validate-tool-args"
import { KNOWLEDGE_AGENT_TOOLS } from "../tool-schema"

function expectRejection(tool: string, args: unknown): ToolArgumentError {
  try {
    validateToolArgs(tool, args)
  } catch (error) {
    if (error instanceof ToolArgumentError) return error
    throw error
  }
  throw new Error(`${tool} haette abgelehnt werden muessen`)
}

describe("validateToolArgs — der Live-Bug", () => {
  it("lehnt update_chunk_content ohne chunk_id ab", () => {
    const err = expectRejection("update_chunk_content", { content: "Neuer, ausreichend langer Inhalt." })
    expect(err.problems).toHaveLength(1)
    expect(err.problems[0]).toMatchObject({ param: "chunk_id", issue: "missing" })
  })

  it("nennt den Weg zur Beschaffung — sonst kann sich das Modell nicht korrigieren", () => {
    const err = expectRejection("update_chunk_content", { content: "Neuer, ausreichend langer Inhalt." })
    expect(err.hint).toMatch(/search_kb_text/)
    // Der Kern des Live-Fehlers: nach dem Upload gibt es noch keinen Chunk.
    expect(err.hint.length).toBeGreaterThan(40)
  })

  it("markiert den Fehler als korrigierbar, nicht als Systemausfall", () => {
    const payload = expectRejection("update_chunk_content", {}).toPayload()
    expect(payload.retryable).toBe(true)
    expect(payload.tool).toBe("update_chunk_content")
    expect(payload.invalid_arguments.map((a) => a.param)).toEqual(
      expect.arrayContaining(["chunk_id", "content"])
    )
  })
})

describe("validateToolArgs — darf gueltige Aufrufe NIE blockieren", () => {
  it("laesst einen vollstaendigen update_chunk_content durch", () => {
    expect(() =>
      validateToolArgs("update_chunk_content", {
        chunk_id: "6c9cc058-5d89-46db-9f70-1fb7a2c3d4e5",
        content: "Ein ausreichend langer, korrigierter Chunk-Inhalt.",
      })
    ).not.toThrow()
  })

  it("akzeptiert get_chunk_details mit chunk_id, obwohl das Schema chunk_ids fordert", () => {
    // Entweder/Oder: Das Schema deklariert required=['chunk_ids'], die
    // Implementierung nimmt ausdruecklich auch ein einzelnes chunk_id. Ohne die
    // Alternativgruppe waere der Fix selbst die Regression.
    expect(() =>
      validateToolArgs("get_chunk_details", { chunk_id: "6c9cc058-5d89-46db-9f70-1fb7a2c3d4e5" })
    ).not.toThrow()
  })

  it("akzeptiert get_chunk_details mit chunk_ids", () => {
    expect(() =>
      validateToolArgs("get_chunk_details", { chunk_ids: ["6c9cc058-5d89-46db-9f70-1fb7a2c3d4e5"] })
    ).not.toThrow()
  })

  it("lehnt get_chunk_details ab, wenn BEIDE Alternativen fehlen", () => {
    const err = expectRejection("get_chunk_details", {})
    expect(err.problems[0].detail).toMatch(/chunk_ids oder chunk_id/)
  })

  it("ignoriert unbekannte (Legacy-)Tools statt sie zu blockieren", () => {
    expect(() => validateToolArgs("irgendein_legacy_tool", {})).not.toThrow()
  })

  it("laesst optionale Felder weg, ohne zu meckern", () => {
    expect(() =>
      validateToolArgs("upload_text_document", { title: "Titel", content: "Langer Inhalt ueber 20 Zeichen." })
    ).not.toThrow()
  })
})

describe("validateToolArgs — Rundum-Schutz ueber ALLE Tools", () => {
  /**
   * Der gefaehrlichste Fehlermodus dieser Validierung ist nicht "faengt zu
   * wenig", sondern "blockiert Gueltiges". Handverlesene Testfaelle decken
   * immer nur die Tools ab, an die man gerade denkt — dieser Test baut fuer
   * JEDES der 46 Tools einen schema-konformen Minimal-Aufruf und verlangt, dass
   * er durchgeht. Neue Tools und Schema-Aenderungen sind damit automatisch
   * mitgeprueft (insbesondere neue Entweder/Oder-Faelle, die eine Ergaenzung in
   * ALTERNATIVE_PARAM_GROUPS brauchen).
   */
  const sampleFor = (spec: any, name: string): unknown => {
    if (Array.isArray(spec?.enum) && spec.enum.length > 0) return spec.enum[0]
    switch (spec?.type) {
      case "string":
        return /uuid/i.test(spec?.description || "")
          ? "6c9cc058-5d89-46db-9f70-1fb7a2c3d4e5"
          : `wert-${name}`
      case "number":
      case "integer":
        return 1
      case "boolean":
        return true
      case "array":
        return [spec?.items?.type === "string" ? "6c9cc058-5d89-46db-9f70-1fb7a2c3d4e5" : 1]
      case "object":
        return { key: "value" }
      default:
        return `wert-${name}`
    }
  }

  it("laesst fuer jedes Tool einen schema-konformen Aufruf durch", () => {
    const blocked: string[] = []
    for (const tool of KNOWLEDGE_AGENT_TOOLS as unknown as any[]) {
      const name = tool.function.name
      const params = tool.function.parameters || {}
      const args: Record<string, unknown> = {}
      for (const required of params.required || []) {
        if (params.properties?.[required]) args[required] = sampleFor(params.properties[required], required)
      }
      try {
        validateToolArgs(name, args)
      } catch (error: any) {
        blocked.push(`${name}: ${error.message}`)
      }
    }
    expect(blocked).toEqual([])
  })
})

describe("validateToolArgs — typische GLM-Artefakte", () => {
  it("erkennt leere Strings als fehlend", () => {
    const err = expectRejection("update_chunk_content", { chunk_id: "   ", content: "Langer Inhalt hier." })
    expect(err.problems[0]).toMatchObject({ param: "chunk_id", issue: "missing" })
  })

  it("erkennt Platzhalterwerte", () => {
    for (const junk of ["undefined", "null", "<chunk_id>", "chunk_id", "{{chunk_id}}"]) {
      const err = expectRejection("update_chunk_content", { chunk_id: junk, content: "Langer Inhalt hier." })
      expect(err.problems[0].param).toBe("chunk_id")
      expect(["placeholder", "malformed_uuid"]).toContain(err.problems[0].issue)
    }
  })

  it("erkennt abgeschnittene UUIDs, bevor sie als DB-Fehler zurueckkommen", () => {
    // Genau die Form, die in der UI auffiel: letzte Gruppe zu kurz.
    const err = expectRejection("update_chunk_content", {
      chunk_id: "6c9cc058-5d89-46db-9f70-1fb7",
      content: "Langer Inhalt hier.",
    })
    expect(err.problems[0]).toMatchObject({ param: "chunk_id", issue: "malformed_uuid" })
  })

  it("erkennt falsche Typen", () => {
    const err = expectRejection("update_chunk_content", {
      chunk_id: "6c9cc058-5d89-46db-9f70-1fb7a2c3d4e5",
      content: { text: "als Objekt statt String" },
    })
    expect(err.problems[0]).toMatchObject({ param: "content", issue: "wrong_type" })
  })

  it("erkennt Argumente, die gar kein Objekt sind", () => {
    const err = expectRejection("update_chunk_content", "chunk_id=abc")
    expect(err.problems[0].issue).toBe("not_an_object")
  })

  it("sammelt mehrere Probleme in EINER Meldung statt Runde fuer Runde", () => {
    const err = expectRejection("update_chunk_content", {})
    expect(err.problems.length).toBeGreaterThanOrEqual(2)
    expect(err.message).toMatch(/chunk_id/)
    expect(err.message).toMatch(/content/)
  })
})
