/**
 * @jest-environment node
 *
 * Sicherheits-Regression fuer das KB-Retrieval-Test-Tool (ChatInterface).
 * Die Chunk-Vorschau nutzte frueher Regex + `dangerouslySetInnerHTML`
 * (XSS-Risiko) und liess Debug-`console.log` stehen. Dieser Test verhindert
 * eine Rueckkehr dieses Musters.
 */
import { readFileSync } from "fs"
import { join } from "path"

const source = readFileSync(
  join(__dirname, "..", "ChatInterface.tsx"),
  "utf8",
)

describe("ChatInterface — Sicherheit der Chunk-Vorschau", () => {
  it("nutzt kein dangerouslySetInnerHTML mehr (JSX-Attribut)", () => {
    // Prüft die tatsächliche Attribut-Verwendung, nicht bloße Erwähnung im Kommentar.
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*=/)
  })

  it("enthaelt keine Debug-console.log-Statements", () => {
    expect(source).not.toMatch(/console\.log\(/)
  })

  it("rendert die Vorschau ueber react-markdown (sichere Escaping-Pipeline)", () => {
    expect(source).toContain("ReactMarkdown")
  })
})
