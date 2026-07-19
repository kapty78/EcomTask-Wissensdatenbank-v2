/**
 * Zentrale Server-Env-Validierung (WP-A5, Feature 007)
 * =====================================================================
 * EINZIGE Stelle, an der externe Service-URLs/Secrets aus process.env
 * gelesen werden duerfen. Defaults fuer Service-URLs sind NUR hier
 * erlaubt (sichtbar, nie an Call-Sites). Fehlende/ungueltige
 * Pflicht-Variablen lassen Build & Boot sofort benennend scheitern
 * (fail-fast statt stiller Fallback auf fremde Produktions-URLs oder
 * hardcodierte Keys).
 */
import { z } from "zod"

// Kein "server-only"-Paket in diesem Repo installiert — manueller Guard:
if (typeof window !== "undefined") {
  throw new Error("lib/env.ts ist server-only")
}

const ServerEnvSchema = z.object({
  // — Knowledge-Retrieval (Support-Backend /api/knowledge/retrieve) —
  KNOWLEDGE_API_URL: z
    .string()
    .url()
    .default("https://outlook-ai-frontend-v3-2s1l.onrender.com/api/knowledge/retrieve"),
  KNOWLEDGE_API_KEY: z.string().min(16),

  // — Support-Backend (Skills-Proxy, Graph-Extraction) —
  SUPPORT_BACKEND_URL: z.string().url(),
  SUPPORT_BACKEND_API_KEY: z.string().min(16),

  // — Cross-Agent-Auth (Service-zu-Service-Aufrufe) —
  CROSS_AGENT_SECRET: z.string().min(32),
  // WP-D2: solange false, wird das statische Legacy-Secret (X-Cross-Agent-Secret)
  // neben der HMAC-Signatur toleriert (Warn-Log + Zaehler). Cutover analog D1:
  // Logs zeigen nur noch HMAC → Flag auf true, Legacy-Pfad im Folge-Release raus.
  REQUIRE_CROSS_AGENT_HMAC: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // — Wissensbasis-Pipeline (PDF-Generierung) —
  WISSENSBASIS_PIPELINE_URL: z
    .string()
    .url()
    .default("https://wissensbasis-pipeline.onrender.com"),
  WISSENSBASIS_API_KEY: z.string().min(8),

  // — Kern-Secrets (Pflicht) —
  OPENAI_API_KEY: z.string().min(20),
  // Optional im globalen Schema, damit nicht-agentische Builds/Tests ohne
  // Scaleway laufen. Der Knowledge-Agent selbst prueft den Key fail-fast.
  SCALEWAY_API_KEY: z.string().min(20).optional(),
  SCALEWAY_BASE_URL: z.string().url().default("https://api.scaleway.ai/v1"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // — Modell-Auswahl: Hauptagent fest ueber Scaleway, OpenAI nur fuer
  // Hilfspfade wie Vision, native Websuche und Fragenprompt-Generierung. —
  KNOWLEDGE_AGENT_MODEL: z.string().min(1).default("glm-5.2"),
  KNOWLEDGE_AGENT_AUX_MODEL: z.string().min(1).default("gpt-4.1"),
})

export type ServerEnv = z.infer<typeof ServerEnvSchema>

/** Exportierte Factory, damit Tests das Schema gegen beliebige Quellen pruefen koennen. */
export function buildServerEnv(
  source: Record<string, string | undefined> = process.env
): ServerEnv {
  const merged: Record<string, string | undefined> = {}
  // Leere Strings (z.B. `VAR=` in .env) wie "nicht gesetzt" behandeln,
  // damit zod-Defaults greifen und Pflicht-Fehler "Required" lauten.
  for (const [key, value] of Object.entries(source)) {
    merged[key] = value?.trim() === "" ? undefined : value
  }
  // Legacy OPENAI_MODEL darf nur noch OpenAI-Hilfspfade beeinflussen. Der
  // Hauptagent bleibt auch in alten Deployments sicher auf Scaleway/GLM.
  if (!merged.KNOWLEDGE_AGENT_AUX_MODEL && merged.OPENAI_MODEL) {
    merged.KNOWLEDGE_AGENT_AUX_MODEL = merged.OPENAI_MODEL
  }
  // Legacy-Alias: Pipeline-Auth lief frueher ueber die NEXT_PUBLIC_-Variante.
  // Deployments, die nur den alten Namen gesetzt haben, bleiben funktionsfaehig.
  // Precedence: der NEUE Name gewinnt, wenn beide gesetzt sind.
  if (!merged.WISSENSBASIS_API_KEY && merged.NEXT_PUBLIC_WISSENSBASIS_API_KEY) {
    merged.WISSENSBASIS_API_KEY = merged.NEXT_PUBLIC_WISSENSBASIS_API_KEY
  }
  const parsed = ServerEnvSchema.safeParse(merged)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")
    throw new Error(
      `Ungueltige Server-Umgebungskonfiguration — fehlende/ungueltige Variablen (siehe .env.example):\n${details}`
    )
  }
  return parsed.data
}

export const env = buildServerEnv()
