import React from "react"

/** Wörter, die in Success-Toasts pink hervorgehoben werden */
const SUCCESS_KEYWORDS = ["erfolgreich", "gespeichert", "abgeschlossen", "erstellt", "aktualisiert", "generiert", "gestartet"]

export function highlightToastMessage(
  message: string,
  type: "success" | "error" | "warning" | "info"
): React.ReactNode {
  if (type !== "success") return message

  const regex = new RegExp(
    `(${SUCCESS_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  )
  const parts = message.split(regex)

  return (
    <span>
      {parts.map((part, i) =>
        SUCCESS_KEYWORDS.some((k) => k.toLowerCase() === part.toLowerCase()) ? (
          <span key={i} className="text-primary font-medium">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </span>
  )
}
