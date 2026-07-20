/**
 * @jest-environment node
 *
 * Regression: KEINE `system`-Nachricht mitten im Gespraech.
 *
 * Live-Ausfall 2026-07-20 beim Wechsel glm-5.2 -> mistral-medium: der Agent
 * schob pro Runde einen BUDGET-Hinweis und am Ende eine Abschluss-Aufforderung
 * als `role: "system"` in den laufenden Verlauf — also direkt nach `tool`-
 * Nachrichten. Mistral lehnt das hart ab:
 *
 *     400 Unexpected role 'system' after role 'tool'
 *
 * GLM war an dieser Stelle tolerant, deshalb fiel es jahrelang nicht auf. Die
 * Regel ist provider-neutral und simpel: `system` gehoert an den ANFANG,
 * laufende Steuerung ist eine `user`-Nachricht.
 *
 * Der Test liest die Route-Quelle statt den Handler auszufuehren (der braucht
 * Auth, DB und einen echten Modell-Endpunkt) und prueft die
 * `conversation.push`-Stellen — genau dort entsteht der Fehler.
 */
import fs from "fs"
import path from "path"

const ROUTE = path.join(process.cwd(), "app/api/knowledge/agent/route.ts")

describe("Nachrichten-Rollen im Agent-Verlauf", () => {
  const src = fs.readFileSync(ROUTE, "utf8")

  it("pusht NIE eine system-Nachricht in den laufenden Verlauf", () => {
    // Alle conversation.push({...}) einsammeln und auf role:"system" pruefen.
    // Die initialen system-Prompts entstehen ueber das Array-Literal bei der
    // Deklaration (`const conversation: any[] = [...]`), nicht ueber push —
    // die bleiben dadurch korrekt unberuehrt.
    const offenders: string[] = []
    const re = /conversation\.push\(\s*\{([\s\S]*?)\}\s*\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const block = m[1]
      if (/role:\s*["']system["']/.test(block)) {
        const line = src.slice(0, m.index).split("\n").length
        offenders.push(`Zeile ~${line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("haelt die Steuerungs-Nachrichten (Budget/Abschluss) als user-Rolle", () => {
    // Positivprobe: die beiden bekannten Steuerungstexte existieren noch und
    // sind user — sonst waere die Steuerung versehentlich entfallen.
    expect(src).toMatch(/role:\s*["']user["'][\s\S]{0,400}?BUDGET: Runde/)
    expect(src).toMatch(/role:\s*["']user["'][\s\S]{0,400}?budgetExhausted/)
  })
})
