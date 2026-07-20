/**
 * @jest-environment node
 */
import { normalizeSkillName, resolveSkillName, SKILL_NAME_MAX } from "../skill-name"

describe("normalizeSkillName", () => {
  it("kuerzt den Live-Bug-Namen an der Segmentgrenze", () => {
    const raw = "klassifizierung-vorverarbeitung-beschwerden"
    expect(raw.length).toBeGreaterThan(SKILL_NAME_MAX)
    expect(normalizeSkillName(raw)).toBe("klassifizierung-vorverarbeitung")
  })

  it("laesst gueltige kurze Namen unveraendert", () => {
    expect(normalizeSkillName("grosshaendler-bestellung")).toBe("grosshaendler-bestellung")
  })

  it("slugifiziert Leerzeichen und Grossbuchstaben", () => {
    expect(normalizeSkillName("Foo Bar")).toBe("foo-bar")
  })

  it("resolveSkillName meldet shortened", () => {
    const r = resolveSkillName("klassifizierung-vorverarbeitung-beschwerden")
    expect(r.name_used).toBe("klassifizierung-vorverarbeitung")
    expect(r.shortened).toBe(true)
  })
})
