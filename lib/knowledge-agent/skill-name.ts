/**
 * Skill-/Standardantwort-Namen: kebab-case, 2–40 Zeichen.
 *
 * Live 2026-07-20: Agent versuchte `klassifizierung-vorverarbeitung-beschwerden`
 * (43 Zeichen) und blieb in einer create_skill-Retry-Schleife haengen, weil die
 * Backend-Validierung nur "2-40 chars" zurückgab — ohne Auto-Kuerzung und ohne
 * konkreten Vorschlag. Hier normalisieren wir VOR dem API-Call und melden
 * `name_requested` / `name_used`, damit das Modell den gekuerzten Namen kennt.
 */

export const SKILL_NAME_MAX = 40
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/

export function normalizeSkillName(raw: string): string {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")

  if (s.length <= SKILL_NAME_MAX) return s

  let cut = s.slice(0, SKILL_NAME_MAX)
  const lastHyphen = cut.lastIndexOf("-")
  if (lastHyphen >= 2) {
    cut = cut.slice(0, lastHyphen)
  }
  return cut.replace(/-+$/g, "")
}

export type NormalizedSkillName = {
  name_requested: string
  name_used: string
  shortened: boolean
}

/** Normalisiert und wirft, wenn danach immer noch ungueltig. */
export function resolveSkillName(raw: string): NormalizedSkillName {
  const name_requested = String(raw || "").trim()
  const name_used = normalizeSkillName(name_requested)
  if (!SKILL_NAME_RE.test(name_used)) {
    throw new Error(
      `Ungueltiger Skill-Name: ${JSON.stringify(name_requested)} ` +
        `(${name_requested.length} Zeichen). Erlaubt: kebab-case, 2–${SKILL_NAME_MAX} Zeichen, ` +
        `nur a–z/0–9/Bindestrich, Start+Ende alphanumerisch. ` +
        `Beispiel: "klassifizierung-beschwerden". Nicht denselben zu langen Namen erneut senden.`
    )
  }
  return {
    name_requested,
    name_used,
    shortened: name_used !== name_requested,
  }
}
