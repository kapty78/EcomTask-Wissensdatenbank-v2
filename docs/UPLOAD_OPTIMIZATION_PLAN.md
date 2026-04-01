## Upload & Verarbeitung – Optimierungsplan (Fokus: Schnelligkeit)

### Ziele
- Maximale Serverless-Performance auf Vercel (unter 60s je Invocation)
- Kürzere End-to-End-Zeit bis „Dokument verarbeitet“
- Stabilität/Genauigkeit beibehalten (oder verbessern)

---

### Priorisierte Roadmap

1) Serverseitige Selbst-Fortsetzung (ohne Client)
- In `app/api/cursor/process-document-chunks/route.ts` am Ende bei `shouldContinue === true` selbständig die nächste Orchestrierungsrunde starten (fetch auf sich selbst), z. B. mit `setTimeout(1500ms)`.
- Parameter unverändert (documentId, userId, knowledgeBaseId, apiKey), Fehlerlogik wie bisher.
- Wirkung: keine Lücke zwischen Orchestrierungsrunden; kein Client-Zwang.

2) Konservative Parallelität erhöhen (Messung + Guard)
- `ORCHESTRATION_CONFIG.MAX_CONCURRENT_CHUNKS`: von 1 → 2 (Test), ggf. 3.
- Guard: Bei ≥1 Timeout/Minute automatisch auf 1 zurückschalten (Backoff). Bei stabilen Runs (z. B. 5 Runden ohne 408/5xx) wieder erhöhen.
- Wirkung: spürbar schneller bei vielen Chunks, kontrolliertes Risiko für Serverless-Limits.

3) Mikro-Batching kleiner Chunks
- Heuristik: Wenn Chunk-Text < X Zeichen (z. B. 600), in `process-chunk` mehrere solcher Chunks in einem Aufruf verarbeiten (BATCH_SIZE_LOGISCH, nicht HTTP).
- Umsetzung: Orchestrierung gruppiert aufeinanderfolgende Mini-Chunks in einer internen Schleife, schreibt Status atomar.
- Wirkung: reduziert HTTP-Overhead, bessere Ausnutzung der 50s-Zeit.

4) Schnellere Status-Feedback-Schleife
- Status-Updates nur bei echter Änderung (de-duped) und maximal alle 1–2s.
- Client-Polling dynamisch: schnell (1.5s) → normal (3–4s) → langsam (6–8s), abhängig vom letzten Fortschrittsdelta.
- Wirkung: weniger Datenverkehr und CPU, UI wirkt dennoch responsiv.

5) Embedding-Optimierung
- Batch-Embeddings sind bereits aktiv; zusätzlich:
  - Retry nur bei 5xx/429, Exponential Backoff, Jitter.
  - Fallback: beim Embedding-Fehler Fakten persistieren ohne Embeddings; späterer Re-Indexer füllt Embeddings nach.
- Wirkung: weniger Wartezeiten auf fehlerhafte Embedding-Calls, Pipeline fließt weiter.

6) Fakten-Deduplizierung & Validierung (schnell + genau)
- Hash aus normalisiertem Fakt (kleinschreiben, trimmen, Mehrfach-Leerzeichen entfernen) → Duplikate nicht erneut speichern.
- Validierung: Länge 20–350 Zeichen; satzähnliche Struktur; keine reinen Zitat-/Artefakt-Zeilen.
- Wirkung: weniger Einträge, weniger Embeddings, schnellere Verarbeitung, bessere Qualität.

7) Preprocessing-Kosten senken
- `preprocessTextChunk`: nur für „schwierige“ Chunks aktivieren (Heuristik über Zeichenlänge/Noise), sonst Rohtext direkt nutzen.
- Optional: Cache pro Chunk (Fingerprint des Inhalts) → Preprocessing-Ergebnis wiederverwenden.
- Wirkung: weniger LLM-Aufrufe, schneller insgesamt.

8) Große Uploads – Best Practices festziehen
- `upload-large`: nach Bestätigung den Orchestrator sofort starten (ist implementiert), Wartezeit beibehalten/verkürzen.
- Bei extrem vielen Chunks (>N): Anfangs nur die ersten M Chunks anstoßen, dann fortsetzen (Smooth Start, vermeidet Kaltstarts).

9) Logging & Monitoring
- `API_LOG_LEVEL` in Prod → `warn`/`error`.
- Metriken: durchschnittliche Chunk-Dauer, Timeouts, Success-Rate, Embedding-Fehlerquote.
- Wirkung: klare Sicht auf Bottlenecks, datengetriebene Parameterwahl.

10) Optionale Verbesserungen (nach Speed-Zielen)
- Graceful Cancel: expliziter Abbruch setzt Status und markiert Rest-Chunks „skipped“.
- UI: „Fit View“/Auto-Zoom in Graph; keine Performance-Relevanz, aber UX.

---

### Umsetzungsvorschläge (konkret)

Kurzausschnitte – Details implementieren wir in den genannten Dateien:

1) Selbst-Fortsetzung am Ende der Orchestrierung
```ts
// app/api/cursor/process-document-chunks/route.ts (am Ende, vor return)
if (shouldContinue) {
  setTimeout(async () => {
    try {
      await fetch(`${baseUrl}/api/cursor/process-document-chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, userId, knowledgeBaseId, apiKey: process.env.API_SECRET_KEY })
      })
    } catch {}
  }, 1500)
}
```

2) Parallelität steuerbar machen
```ts
// ORCHESTRATION_CONFIG.MAX_CONCURRENT_CHUNKS = 2;
// processBatchWithRetry: bis zu MAX_CONCURRENT_CHUNKS parallel laufen lassen
```

3) Mikro-Batching-Heuristik
```ts
// process-chunk: wenn processedText.length < 600 → mehrere nacheinander in einem Request verarbeiten
```

4) Client-Polling dynamisch
```ts
// KnowledgeItemUpload.tsx – Poll-Intervall abhängig vom Fortschritt anpassen
```

5) Dedupe & Validation für Fakten
```ts
// Beim Insert in knowledge_items: vorab Hash prüfen, Mindestlänge, Satz-Ende-Punkt
```

---

### Erfolgsmessung (KPIs)
- T95 Upload→„chunks ready“ (Sekunden)
- T95 „chunks ready“→„completed“ (Sekunden)
- Average per-chunk processing ms
- Timeout-Quote (%) und Retry-Quote (%)
- Einfügequote validierter Fakten vs. Rohfakten

---

### Reihenfolge für Umsetzung (Sprint-geeignet)
1. Selbst-Fortsetzung Orchestrierung (größter Speed-Impact, minimal invasiv)
2. Parallelität 2 (mit Backoff) + dynamisches Client-Polling
3. Fakten-Dedupe/Validation (spart Embeddings/IO)
4. Mikro-Batching kleiner Chunks
5. Preprocessing-Heuristik/Cache
6. Logging/Monitoring-Härtung
7. Optionale Features (Cancel, UI-Feinschliff)

---

Bei Freigabe kann ich Schritt 1–3 direkt implementieren und mit Metriken versehen, damit wir die Beschleunigung sichtbar machen.


