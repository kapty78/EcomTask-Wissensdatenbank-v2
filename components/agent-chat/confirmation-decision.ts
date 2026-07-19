// =========================================================================
// Shared: Confirmation-Entscheidungen aus dem Message-Verlauf ableiten.
// Wird von beiden Chat-Oberflaechen (SupportAgentLauncher + Dashboard-Chat)
// benutzt — vorher war die Logik dupliziert und driftete auseinander.
// =========================================================================

import type { AgentRichBlock, ChatMessage } from "./types"

type ConfirmationBlock = Extract<AgentRichBlock, { type: "confirmation" }>

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Map message-id → getroffene Confirmation-Entscheidung.
 *
 * Zwei Quellen, in Prioritaetsreihenfolge:
 *
 * 1. `block.decision` — wird vom execute-action-Endpoint server-seitig in
 *    das persistierte rich_content geschrieben, sobald eine Direkt-Aktion
 *    (confirmAction via REST) ausgefuehrt wurde. Das ist die einzige
 *    zuverlaessige Quelle fuer Direkt-Aktionen, weil dort KEINE User-Message
 *    entsteht, an der man die Entscheidung ablesen koennte.
 *
 * 2. Heuristik ueber die naechste User-Message — deckt den plan_execute-Flow
 *    ("Ja, fuehre den Plan aus.") und den Fallback-Flow
 *    ("<responsePrefix>: <Label>") ab. Die Antwort nach dem Prefix wird
 *    gegen das cancelLabel des Blocks verglichen, damit ein Abbruch nicht
 *    faelschlich als "confirmed" klassifiziert wird.
 */
export function computeConfirmationDecisions(
  messages: ChatMessage[]
): Map<string, "confirmed" | "cancelled"> {
  const map = new Map<string, "confirmed" | "cancelled">()
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== "assistant") continue
    const blocks = m.richContent?.blocks
    if (!Array.isArray(blocks)) continue
    const confirmation = blocks.find((b): b is ConfirmationBlock => b.type === "confirmation")
    if (!confirmation) continue

    if (confirmation.decision === "confirmed" || confirmation.decision === "cancelled") {
      map.set(m.id, confirmation.decision)
      continue
    }

    const cancelLabel = (confirmation.cancelLabel || "Abbrechen").trim().toLowerCase()
    const customPrefix = (confirmation.responsePrefix || "").trim()
    const prefixPattern = new RegExp(
      `^(?:Entscheidung|Bestaetigung|Bestätigung|Antwort${customPrefix ? `|${escapeRegExp(customPrefix)}` : ""}):\\s*(.*)$`,
      "i"
    )

    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]
      if (next.role !== "user") continue
      const c = (next.content || "").trim()
      if (/^Ja, f[üu]hre den Plan aus\.?$/i.test(c)) { map.set(m.id, "confirmed"); break }
      if (/^Nein, brich den Plan ab\.?$/i.test(c)) { map.set(m.id, "cancelled"); break }
      const prefixMatch = c.match(prefixPattern)
      if (prefixMatch) {
        const answer = prefixMatch[1].trim().toLowerCase()
        map.set(m.id, answer === cancelLabel ? "cancelled" : "confirmed")
        break
      }
      // Andere User-Message-Form direkt nach dem Confirmation-Block →
      // Entscheidung wurde nicht klassisch getroffen, raus.
      break
    }
  }
  return map
}

/**
 * Message-ids der Confirmation-Blocks, deren plan_execute-Lauf bereits eine
 * fertige Assistant-Antwort produziert hat.
 *
 * Hintergrund (USD-Befund 2026-07-02): Der plan_execute-Pfad laeuft als
 * Chat-Message durch den SSE-Stream. Der Confirmation-Block setzte beim
 * Klick "wird ausgefuehrt…" + Spinner, aber niemand meldete ihm je das Ende
 * des Laufs — der Spinner drehte fuer immer weiter, obwohl das Ergebnis
 * laengst darunter im Chat stand.
 *
 * Kriterium: Nach dem Confirmation-Block existiert eine spaetere
 * Assistant-Message UND es streamt gerade nichts (isThinking=false).
 * Waehrend der Plan noch laeuft ist isThinking=true → nicht fertig.
 */
export function computePlanRunsFinished(
  messages: ChatMessage[],
  isThinking: boolean
): Set<string> {
  const finished = new Set<string>()
  if (isThinking) return finished
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== "assistant") continue
    const blocks = m.richContent?.blocks
    if (!Array.isArray(blocks)) continue
    if (!blocks.some((b) => b.type === "confirmation")) continue
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === "assistant") {
        finished.add(m.id)
        break
      }
    }
  }
  return finished
}
