# Wissensdatenbank (EcomTask)

Next.js-Anwendung für die **Wissensdatenbank** des SupportAI-Systems: Verwaltung von
Wissensbasen, Dokumenten, Chunks und Fakten sowie der **Knowledge Agent** — ein
Tool-aufrufender Agent, der über RAG (Vektor-, Hybrid-, Graph- und Fragen-Suche)
auf den Wissensbestand zugreift und von der Support-AI-App per
Service-to-Service-Aufruf angesprochen wird.

Produktion: <https://wissensdatenbank.ecomtask.de> (Vercel)

## Was dieses Repo IST

- Eine **Next.js 14 App-Router**-Anwendung (TypeScript) für die Wissensdatenbank.
- Der **Knowledge Agent** unter [`app/api/knowledge/agent/route.ts`](app/api/knowledge/agent/route.ts):
  Tool-Loop für Suche, Chunk-/Fakten-/Dokument-Pflege, Skills und Wissensbasis-Verwaltung.
- Die **Retrieve-Proxy-/Pipeline-Endpunkte** unter `app/api/knowledge/*` und
  `app/api/wissensbasis-pipeline/*`.
- Die **UI** für Wissensbasen, Chat und den 3D-Wissensgraphen unter `app/` und `components/`.
- Geteilte Server-Logik unter `lib/` (u. a. zentrale Env-Validierung [`lib/env.ts`](lib/env.ts),
  Cross-Agent-HMAC-Verifikation [`lib/cross-agent-auth.ts`](lib/cross-agent-auth.ts)).
- Persistenz über **Supabase** (PostgreSQL, RLS) — Migrationen unter `supabase/`.

## Was dieses Repo NICHT IST

Dieses Repo ist **nicht** der TimeGlobe-WhatsApp-Salon-Agent. Es ist **nicht** der
Telefon-Agent, **nicht** das Support-Backend (AI-Gateway / RAG-Pipeline laufen dort,
in Python auf Render) und **nicht** der Mail- oder Internal-Agent.

Historische TimeGlobe-Artefakte (FastAPI-Salon-Backend `app/**.py`, SQLite-Backups
`timeglobewhatsappassistant.db.backup*`, Hessen-KMU-Scraper, `doc2vec-main/`,
`requirements.txt`) wurden aus `main` entfernt. Sie liegen unverändert im Branch
[`legacy-archive`](https://github.com/kapty78/EcomTask-Wissensdatenbank-v2/tree/legacy-archive),
falls jemals nötig. **Dieses Repo enthält keinen Python-Code mehr** — sämtliche Logik
ist TypeScript/Next.js.

## Architektur-Einordnung (SupportAI)

| System            | Aufgabe                                       | Repo / Laufzeit            |
|-------------------|-----------------------------------------------|----------------------------|
| Support AI        | Orchestrator + Sub-Agenten, Frontend          | Next.js (Vercel)           |
| **Wissensdatenbank** | **Knowledge Agent + KB-Verwaltung (dieses Repo)** | **Next.js (Vercel)**   |
| Support-Backend   | AI-Gateway, RAG-Pipeline, Graph-Extraktion    | Python/FastAPI (Render)    |
| Phone-Agent       | Twilio zu OpenAI Realtime                      | Python/FastAPI (Hetzner)   |

Die Support-AI-App ruft den Knowledge Agent dieses Repos service-to-service auf,
HMAC-signiert (`X-Cross-Agent-*`-Header, siehe `lib/cross-agent-auth.ts`).

## Entwicklung

```bash
npm install
npm run dev          # next dev
npm run build        # next build
npm run type-check   # tsc --noEmit
npm run lint
```

Erforderliche Umgebungsvariablen werden beim Start zentral via zod validiert
([`lib/env.ts`](lib/env.ts)); Vorlage siehe [`.env.example`](.env.example).
