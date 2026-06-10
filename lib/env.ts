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

  // — Wissensbasis-Pipeline (PDF-Generierung) —
  WISSENSBASIS_PIPELINE_URL: z
    .string()
    .url()
    .default("https://wissensbasis-pipeline.onrender.com"),
  WISSENSBASIS_API_KEY: z.string().min(8),

  // — Kern-Secrets (Pflicht) —
  OPENAI_API_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // — Modell-Auswahl (Legacy-Kette siehe buildServerEnv) —
  KNOWLEDGE_AGENT_MODEL: z.string().min(1).default("gpt-5.5-2026-04-23"),
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
  // Legacy-Kette: KNOWLEDGE_AGENT_MODEL ?? OPENAI_MODEL ?? Schema-Default.
  if (!merged.KNOWLEDGE_AGENT_MODEL && merged.OPENAI_MODEL) {
    merged.KNOWLEDGE_AGENT_MODEL = merged.OPENAI_MODEL
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
