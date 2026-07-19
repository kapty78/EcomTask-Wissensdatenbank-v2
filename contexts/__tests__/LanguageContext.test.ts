/**
 * @jest-environment node
 *
 * Adapter-Vertrag der WDB-LanguageContext-Bruecke fuer die geteilte
 * SupportAI-Chat-Render-Engine. Die portierten Komponenten rufen
 * `useLanguage().t(key)` (+ `.language`); dieser Test sichert, dass der
 * Adapter die erwarteten deutschen Strings liefert und bei unbekannten
 * Keys den Key zurueckgibt (identische Semantik zu SupportAI).
 */
import { useLanguage } from "@/contexts/LanguageContext"

describe("LanguageContext adapter (WDB)", () => {
  const { t, language } = useLanguage()

  it("liefert deutsche Strings fuer bekannte agentChatCore-Keys", () => {
    expect(t("agentChatCore.trace.working")).toBe("Agent arbeitet")
    expect(t("agentChatCore.trace.thinking")).toBe("Agent überlegt")
    expect(t("agentChatCore.history.untitled")).toBe("Chat")
    expect(t("general.cancel")).toBe("Abbrechen")
  })

  it("gibt bei unbekanntem Key den Key selbst zurueck (Fallback wie SupportAI)", () => {
    expect(t("agentChatCore.does.not.exist")).toBe("agentChatCore.does.not.exist")
  })

  it("behaelt Interpolations-Platzhalter bei (Consumer ersetzt selbst)", () => {
    expect(t("agentChatCore.trace.stepsPlural")).toContain("{count}")
    expect(t("agentChatCore.form.missingFieldsError")).toContain("{fields}")
  })

  it("exponiert language='de' fuer Locale-Formatierung (chat-charts, ConversationList)", () => {
    expect(language).toBe("de")
  })
})
