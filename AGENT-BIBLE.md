# Wissensdatenbank — Agent-Bibel

> Vollständige Referenz für den QA-Agenten der Wissensdatenbank.
> Dieses Dokument beschreibt exakt, wie die Datenbank aufgebaut ist,
> wie Wissen verarbeitet, gespeichert, gesucht und getestet wird.

---

## 1. Architektur-Überblick

Die Wissensdatenbank ist ein mehrstufiges RAG-System (Retrieval-Augmented Generation):

```
Dokument-Upload
    ↓
Textextraktion (PDF, DOCX, XLSX, TXT, MD, Bilder)
    ↓
Dokumenttyp-Erkennung (automatisch)
    ↓
Chunking (KI-semantisch oder traditionell)
    ↓
Chunks → Datenbank (document_chunks)
    ↓
Embedding-Erzeugung (OpenAI text-embedding-3-small, 1536 Dimensionen)
    ↓
Fakten-Extraktion per LLM (GPT-4.1-mini)
    ↓
Fakten → Datenbank (knowledge_items)
    ↓
Volltextindex aktualisiert (GIN tsvector, deutsch)
    ↓
Verfügbar für Suche & Retrieval
```

**Technologie-Stack:**
- Backend: Next.js (Vercel)
- Datenbank: Supabase (PostgreSQL)
- Embeddings: OpenAI `text-embedding-3-small` (1536 Dimensionen)
- LLM für Extraktion: `gpt-4.1-mini-2025-04-14` (Temperature 0.0)
- Workflow-Orchestrierung: n8n (optional)
- Clients: Web-Dashboard, iOS-App

---

## 2. Datenbank-Schema

### 2.1 Kerntabellen

| Tabelle | Zweck | Wichtige Spalten |
|---------|-------|-----------------|
| `knowledge_bases` | KB-Container | id, title, user_id, company_id, sharing (JSONB) |
| `documents` | Quelldokumente | id, knowledge_base_id, title, file_name, file_type, file_size, storage_url, user_id, company_id |
| `document_chunks` | Textabschnitte | id, document_id, content, content_length, content_tokens, quality_score, document_type, processing_complete, facts_count, processing_error, processing_duration_ms, company_id |
| `knowledge_items` | Fakten/Fragen | id, knowledge_base_id, content, question, fact_type, source_chunk, source_name, user_id, company_id, openai_embedding, local_embedding |

### 2.2 Beziehungen

```
knowledge_bases (1) → (n) documents
documents (1) → (n) document_chunks
document_chunks (1) → (n) knowledge_items (via source_chunk FK)
```

### 2.3 Indizes

- `idx_knowledge_items_content_search` — GIN tsvector für deutsche Volltextsuche auf `content` + `question`
- `idx_knowledge_items_fact_type` — Schnelle Filterung nach Faktentyp
- `idx_knowledge_items_company_id` — Multi-Tenancy-Isolation
- `idx_document_chunks_processing_complete` — Status-Abfragen
- `idx_document_chunks_quality_score` — Qualitäts-Ranking

### 2.4 Multi-Tenancy

Alle Tabellen haben `company_id`. Row-Level Security (RLS) stellt sicher, dass Unternehmen nur ihre eigenen Daten sehen. Der QA-Agent muss immer mit der richtigen `company_id` arbeiten.

---

## 3. Dokument-Verarbeitung im Detail

### 3.1 Upload & Textextraktion

**Endpoint:** `POST /api/cursor/upload`
- Max 60 MB (>4 MB via `/api/cursor/upload-large`)
- Dateien werden in Supabase Storage gespeichert: `uploads_test/{fileId}.{ext}`

**Textextraktion nach Dateityp:**

| Format | Methode | Fallbacks |
|--------|---------|-----------|
| PDF | LangChain PDFLoader (seitenweise) | pdf-parse → Minimal-Extraktion → Raw-Binary |
| DOCX | mammoth | — |
| XLSX | xlsx-Bibliothek | — |
| TXT/MD | Direkt | — |

### 3.2 Chunking-Strategie

Es gibt **zwei Chunking-Methoden**, die automatisch gewählt werden:

#### KI-Semantisches Chunking (bevorzugt)
- Bedingung: Dokument zwischen 1 KB und 3 MB, kein strukturiertes Format (JSON/CSV/XML)
- Endpoint: `POST /api/knowledge/intelligent-chunking`
- GPT-4 gruppiert Text thematisch in sinnvolle Abschnitte
- Validierung: Kein Textverlust, jeder Chunk muss im Original vorkommen

#### Traditionelles Chunking (Fallback)
- Nutzt LangChain `RecursiveCharacterTextSplitter`
- Deutsche Trennzeichen-Hierarchie:
  1. Markdown-Header (`## `, `### `, `#### `)
  2. Benannte Abschnitte (`Kapitel `, `Abschnitt `, `Anlage `)
  3. Listen (Striche, Punkte, Nummerierung)
  4. Absätze (`\n\n`)
- Überlappende Fenster für Kontexterhalt

#### Dokumenttyp-spezifische Parameter

| Dokumenttyp | Chunk-Größe | Überlappung | Minimum | Anwendungsfall |
|------------|-------------|-------------|---------|---------------|
| contract | 2000 Zeichen | 400 | 100 | Vertragsklauseln |
| manual | 3500 Zeichen | 250 | 200 | Prozessdokumentation |
| specification | 2200 Zeichen | 350 | 150 | Technische Details |
| report | 2800 Zeichen | 300 | 180 | Berichte (ausgewogen) |
| email | 1500 Zeichen | 200 | 80 | E-Mail-Themenseparation |
| table | 1800 Zeichen | 100 | 50 | Tabellarische Daten |
| default | 2500 Zeichen | 300 | 150 | Standardfall |

### 3.3 Chunk-Qualitätsbewertung

Jeder Chunk bekommt einen **Quality Score (0-100)** basierend auf:
- Textlänge (zu kurz = schlecht, zu lang = schlecht)
- Satzstruktur (vollständige Sätze vorhanden?)
- Deutsche Sprachmuster (korrekte Sprache?)
- OCR-Fehlererkennung (Artefakte?)
- Informationsdichte (sinnvoller Inhalt vs. Leertext?)
- Excessive Großbuchstaben

**Grenzwerte für den QA-Agenten:**
- Score < 30: Kritisch schlecht, manuell prüfen
- Score 30-60: Verbesserungswürdig
- Score 60-80: Akzeptabel
- Score > 80: Gut

---

## 4. Fakten-Extraktion — Das Herzstück

### 4.1 Wie Fakten erzeugt werden

Jeder Chunk wird durch GPT-4.1-mini analysiert (`extractFactsFromText()`):
- Temperature: 0.0 (deterministisch)
- Max Tokens: 2200

**Minimum-Fakten pro Chunk:**
- Kleiner Text (<150 Zeichen): mindestens 4 Fakten
- Mittlerer Text (150-600 Zeichen): mindestens 12 Fakten
- Großer Text (>600 Zeichen): mindestens 24 Fakten

**Fakten-Qualitätsregeln:**
- Jeder Fakt ist **atomar und selbsterklärend** (15-22 Wörter)
- Jeder Fakt muss ohne den Kontext des Quelltexts verständlich sein
- Kein Meta-Sprache ("Der Text beschreibt..." ist KEIN Fakt)
- Länge: 10-160 Zeichen
- Duplikate werden automatisch entfernt

### 4.2 Faktentypen (fact_type)

| Typ | Beschreibung | Beispiel |
|-----|-------------|---------|
| `date` | Zeitangaben, Fristen | "Die Kündigungsfrist beträgt 3 Monate." |
| `amount` | Beträge, Zahlen, Mengen | "Der Grundpreis liegt bei 49,90 EUR monatlich." |
| `person` | Personen, Ansprechpartner | "Herr Müller ist zuständig für Beschwerden." |
| `role` | Funktionen, Positionen | "Der Teamleiter genehmigt Urlaubsanträge." |
| `step` | Prozessschritte, Anleitungen | "Zuerst den Router 30 Sekunden vom Strom nehmen." |
| `rule` | Regeln, Vorschriften | "Rücksendungen sind nur innerhalb von 14 Tagen möglich." |
| `spec` | Technische Spezifikationen | "Die maximale Bandbreite beträgt 250 Mbit/s." |
| `contact` | Kontaktdaten | "Hotline erreichbar unter 0800-123456." |
| `condition` | Bedingungen, Wenn-Dann | "Bei Störung über 24h gibt es automatisch Gutschrift." |
| `feature` | Produktmerkmale | "Der Premium-Tarif enthält unbegrenztes Datenvolumen." |
| `organization` | Firmen, Abteilungen | "Die Buchhaltung sitzt in der Zentrale München." |
| `location` | Orte, Adressen | "Das Lager befindet sich in Hamburg-Harburg." |
| `definition` | Begriffsdefinitionen | "SLA bedeutet Service Level Agreement." |
| `other` | Nicht einordenbares | Sonstige relevante Informationen |

### 4.3 JSON-Output-Format der Extraktion

```json
{
  "facts": [
    { "text": "Die Kündigungsfrist beträgt 3 Monate zum Quartalsende.", "type": "rule" },
    { "text": "Der Grundpreis für den Premium-Tarif liegt bei 49,90 EUR.", "type": "amount" },
    { "text": "Bei Totalausfall erhalten Kunden eine Gutschrift von 1/30 des Monatsbetrags.", "type": "condition" }
  ]
}
```

### 4.4 Fallback-Kette bei Extraktion

1. JSON-Response parsen → Fakten extrahieren
2. Falls leer: Nummerierte-Listen-Format versuchen
3. Falls immer noch leer: Nach Sätzen splitten
4. Letzter Ausweg: Original-Chunk-Text als einzelnen Fakt verwenden
5. Danach: Deduplizieren, nach Länge filtern (10-160 Zeichen), Meta-Sprache entfernen

---

## 5. Fragen-Generierung — Die fünf Fragen

### 5.1 Konzept

Zu jedem Fakt wird eine **optimierte Suchfrage** generiert und in `knowledge_items.question` gespeichert. Diese Frage repräsentiert, *wie ein Nutzer nach diesem Fakt suchen würde*. Sie verbessert den Retrieval-Recall dramatisch.

### 5.2 Fragenprompts (Question Prompts) — Retrieval-Optimierung

**Tabelle:** `question_prompts`

Fragenprompts sind **aktive Regeln**, die steuern, wie Suchanfragen formuliert werden. Sie sind der wichtigste Hebel für die Suchqualität.

**Struktur:**
```
- id: UUID
- company_id: Zugehörige Firma
- problem_type: specificity | missing_context | wrong_scope | format | custom
- generated_prompt: Regeltext (max ~28 Wörter)
- is_active: Boolean
```

**Problemtypen und ihre Bedeutung:**

| Typ | Problem | Lösung |
|-----|---------|--------|
| `specificity` | Frage zu ungenau | "Extrahiere immer alle Nummern und IDs aus dem User-Input" |
| `missing_context` | Kontext fehlt | "Erweitere die Suchanfrage um gängige Synonyme und Fachbegriffe" |
| `wrong_scope` | Falscher Suchbereich | "Formuliere die Suchfrage präzise mit wichtigsten Substantiven" |
| `format` | Formatierungsproblem | "Verwende keine Sonderzeichen in der Suchanfrage" |
| `custom` | Sonderfälle | Individuell definierte Regeln |

**Kategorien der Regeln:**
- `präzision` — Genauigkeit der Suchformulierung
- `kontext` — Kontextanreicherung
- `synonyme` — Synonymerweiterung
- `filter` — Eingrenzung der Ergebnisse
- `keywords` — Schlüsselwort-Extraktion
- `sprache` — Sprachliche Anpassung
- `format` — Formatvorgaben
- `ausschluss` — Ausschlusskriterien

### 5.3 Diagnostik-Reihenfolge bei schlechten Antworten

Wenn der Agent schlechte Antworten liefert, prüfe in dieser Reihenfolge:

1. **Fragenprompt:** Wird die Suchfrage optimal formuliert?
2. **Wissen:** Existieren die Fakten in der KB? Sind sie klar geschrieben?
3. **Konfiguration:** Stimmt der Ton/Format der Antwort?
4. **Sonderfall:** Sollte eine harte Regel (Edge Case Prompt) greifen?

---

## 6. Suche & Retrieval

### 6.1 Drei-Schicht-Suchstrategie

Die Wissenssuche nutzt eine **hybride Suchstrategie** mit drei Schichten:

#### Schicht 1: Query-Optimierung
- Funktion: `buildKnowledgeSearchQuery(userQuestion)`
- GPT-4.1-mini transformiert die Nutzerfrage in eine optimale Suchfrage
- Limit: 300 Zeichen
- Prompt: "Formuliere eine praezise Suchfrage fuer Retrieval"

#### Schicht 2: Primäre Suche (n8n Webhook)
- Endpoint: `https://automation.ecomtask.de/webhook/wdb-chat/v1`
- Timeout: 9000ms
- Payload: `{ message, knowledgeBaseId, userId }`
- Liefert gewichtete Ergebnisse mit Similarity-Scores

#### Schicht 3: Lokale Fallback-Suche
Wird aktiviert wenn Webhook 0 Ergebnisse liefert:

**a) Embedding-Suche:**
- RPC-Funktion: `match_knowledge_items`
- Similarity-Schwellenwert: 0.18
- Max. 10 Ergebnisse, sortiert nach Ähnlichkeit

**b) Volltextsuche:**
- Keyword-Extraktion aus der Frage
- Deutsche Stoppwörter werden entfernt
- Sucht in: `content`, `question`, `source_name`, `fact_type`
- ILIKE für Case-insensitive Suche
- Max. 8 Ergebnisse

### 6.2 Similarity-Schwellenwerte

| Schwellenwert | Bedeutung | Aktion |
|---------------|-----------|--------|
| ≥ 0.85 | Exzellente Übereinstimmung | Direkt verwendbar |
| 0.70 - 0.84 | Gute Übereinstimmung | Zuverlässig |
| 0.50 - 0.69 | Moderate Übereinstimmung | Kontext prüfen |
| 0.30 - 0.49 | Schwache Übereinstimmung | Vorsicht geboten |
| 0.18 - 0.29 | Grenzwertig | Nur als Ergänzung |
| < 0.18 | Irrelevant | Wird verworfen |

### 6.3 Ergebnis-Verarbeitung

1. Ergebnisse aus allen Quellen zusammenführen
2. Deduplizierung nach `knowledge_item_id` (Webhook kann Duplikate liefern)
3. Zusätzliche Deduplizierung: Erste 200 Zeichen des Contents
4. Ranking nach Similarity-Score
5. Top 5 einzigartige Ergebnisse werden verwendet

### 6.4 Cosine Similarity — Mathematik

```
similarity = dotProduct(vecA, vecB) / (||vecA|| × ||vecB||)
```

Wobei:
- `vecA` = Embedding der Suchanfrage (1536 Dimensionen)
- `vecB` = Embedding des knowledge_items (1536 Dimensionen)
- Ergebnis: Wert zwischen -1 und 1 (in der Praxis 0 bis 1)

### 6.5 Erweiterte Suche (Dashboard)

**Endpoint:** `POST /api/knowledge/search-enhanced`
- RPC: `search_knowledge_items_in_base()`
- Unterstützt:
  - Volltextsuche auf `content` + `question`
  - Quellenfilter (Dokumenttitel)
  - Datumsfilter: heute, Woche, Monat, 3 Monate
  - Pagination: limit, offset
- Gibt `total_count` für Pagination zurück

---

## 7. Qualitätssicherungs-Tools

### 7.1 Mismatch-Erkennung

**Endpoint:** `POST /api/knowledge/find-mismatches`

Findet **Widersprüche** zwischen ähnlichen Knowledge Items:
- Cosine Similarity Schwellenwert für Vergleich: 0.72
- GPT-4 analysiert semantische, faktische und logische Konflikte
- Ergebnisse in `mismatch_analysis_jobs` gespeichert
- Batch-Verarbeitung: 50 Items pro Durchlauf

**Für den QA-Agenten:** Widersprüchliche Fakten sind ein kritisches Problem. Wenn zwei Fakten das Gegenteil behaupten, bekommt der Endnutzer widersprüchliche Antworten. Der Agent sollte regelmäßig Mismatches suchen und zur Klärung vorlegen.

### 7.2 Duplikat-Erkennung & Zusammenführung

**Endpoint:** `POST /api/knowledge/combine-suggestions`

- Gruppiert ähnliche Chunks und Knowledge Items
- Berechnet Similarity-Scores
- Erstellt Merge-Vorschläge mit Vorschau
- Max. 25 Vorschläge pro Batch

**Warum Duplikate problematisch sind:** Wenn 3 fast identische Einträge die Top-5-Ergebnisse belegen, bleibt kein Platz für andere relevante Treffer. Das verwässert die Ergebnisqualität.

### 7.3 Qualitäts-Neuberechnung

**Endpoint:** `POST /api/knowledge/recalculate-quality`

Berechnet den Quality Score aller Chunks in einer Knowledge Base neu. Nützlich nach:
- Großem Datenimport
- Änderung der Scoring-Kriterien
- Regelmäßigem Audit

### 7.4 Fakten-Regenerierung

**Endpoint:** `POST /api/knowledge/regenerate-facts`

Extrahiert Fakten aus einem Chunk neu. Nützlich wenn:
- LLM-Modell verbessert wurde
- Extraktionslogik geändert wurde
- Faktenqualität unzureichend ist
- Felder `pending_regeneration` und `regeneration_reason` tracken den Status

---

## 8. Graph-Algorithmen & Ähnlichkeitsmetriken

### 8.1 Verfügbare Metriken

| Metrik | Gewichtung | Beschreibung |
|--------|-----------|-------------|
| Cosine Similarity | 60% | Semantische Ähnlichkeit via Embeddings |
| Lexical Similarity | 20% | N-Gram-Überlappung (n=3) |
| Jaccard Similarity | 20% | Keyword-Set Überschneidung |
| **Combined Similarity** | 100% | Gewichteter Blend aller drei |

### 8.2 TF-IDF Keyword-Extraktion

- Deutsche und englische Stoppwörter werden gefiltert
- Top-N Keywords pro Chunk extrahiert
- Verwendet für keyword-basierte Ähnlichkeitsberechnung

### 8.3 Graph-Clustering

- Community Detection auf Knowledge-Nodes
- Kohärenz-Scoring für Cluster
- Themen-Extraktion aus Cluster-Zentroiden
- Zeigt thematische Gruppierungen in der Datenbank

---

## 9. Agent-Integration

### 9.1 Prioritäts-Stack des Agenten

Wenn ein Agent (Chat, Telefon, E-Mail) eine Anfrage beantwortet, gilt diese Prioritätsreihenfolge:

```
1. Sonderfallprompts (Edge Cases)     ← HÖCHSTE PRIORITÄT
   Tabelle: edge_case_prompts
   Überschreibt alles andere.

2. Fragenprompts (Question Prompts)   ← RETRIEVAL-STEUERUNG
   Tabelle: question_prompts
   Steuert, wie gesucht wird.

3. Verhaltenskonfiguration            ← PERSÖNLICHKEIT
   Tabelle: ai_agent_configurations
   Ton, Formalität, Empathie.

4. Wissensdatenbank                   ← INHALT
   Tabellen: knowledge_items, document_chunks
   Die eigentlichen Fakten.
```

### 9.2 Goldene Regeln für den Agenten

1. **Fakten NUR aus der Wissensdatenbank** — niemals Modellwissen verwenden
2. **Keine erfundenen Informationen** — wenn die KB es nicht hergibt, sage das
3. **Similarity-Score beachten** — unter 0.3 ist ein Ergebnis fragwürdig
4. **Deduplizierung ernst nehmen** — doppelte Ergebnisse verzerren die Antwort
5. **Quellenangabe ermöglichen** — `source_name` und `source_chunk` mitliefern

### 9.3 Voice-spezifische Constraints

Wenn Fakten für den Telefonagenten aufbereitet werden:
- Max. 1-3 klare Sätze
- Kein Markdown, keine URLs, keine Sonderzeichen
- Keine IDs, UUIDs oder Tool-Namen nennen
- Niemals behaupten, dass eine Aktion bereits durchgeführt wurde
- Sanitisierung entfernt Aktionsbehauptungen ("weitergeleitet", "erstellt")

---

## 10. Test-Szenarien für den QA-Agenten

### 10.1 Regressionstests

**Ziel:** Sicherstellen, dass bestehende Suchergebnisse nach Änderungen stabil bleiben.

**Vorgehen:**
1. Echte vergangene Anfragen sammeln (aus Logs, E-Mails)
2. Erwartete korrekte Ergebnisse (Fakten-IDs oder Content-Matches) dokumentieren
3. Anfragen regelmäßig an die Suchfunktion stellen
4. Prüfen: Kommen die gleichen Top-5-Ergebnisse?
5. Alarm bei Abweichung (neuer Fakt verdrängt korrekten, Score-Drift)

**Metriken:**
- Hit Rate: Wie oft ist die korrekte Antwort in den Top-5?
- MRR (Mean Reciprocal Rank): Auf welcher Position ist die korrekte Antwort?
- Score-Stabilität: Schwankt der Similarity-Score über Zeit?

### 10.2 Query-Varianten-Tests

**Ziel:** Robustheit der Suche gegenüber Umformulierungen prüfen.

**Vorgehen:**
1. Eine Referenzfrage definieren (z.B. "Was kostet der Premium-Tarif?")
2. 5 Varianten erstellen:
   - Umgangssprachlich: "Was muss ich für Premium zahlen?"
   - Formal: "Wie hoch ist der monatliche Grundpreis des Premium-Tarifs?"
   - Keyword-basiert: "Preis Premium Tarif"
   - Fehlerhaft: "Was kosted der Premim-Tarif?"
   - Indirekt: "Ich möchte wissen, ob Premium teuer ist"
3. Alle 5 Varianten suchen
4. Prüfen: Kommen jeweils die gleichen Top-3-Ergebnisse?

**Erwartung:** Mindestens 80% Übereinstimmung bei den Top-3-Ergebnissen.

### 10.3 Lückenanalyse

**Ziel:** Themengebiete identifizieren, für die keine guten Ergebnisse existieren.

**Vorgehen:**
1. Eingehende Anfragen über einen Zeitraum clustern
2. Für jedes Cluster: Durchschnittlichen Top-1-Similarity-Score berechnen
3. Cluster mit Score < 0.5 markieren als "Lücke"
4. Report erstellen: Welche Themen fehlen in der KB?

### 10.4 Duplikat-Audit

**Vorgehen:**
1. `/api/knowledge/combine-suggestions` aufrufen
2. Vorschläge mit Similarity > 0.85 automatisch markieren
3. Vorschläge mit Similarity 0.72-0.85 zur manuellen Prüfung
4. Statistik: Wie viel % der KB sind (Nah-)Duplikate?

### 10.5 Widerspruchs-Audit

**Vorgehen:**
1. `/api/knowledge/find-mismatches` aufrufen
2. Konflikte nach Schweregrad sortieren
3. Kritische Konflikte (entgegengesetzte Aussagen) sofort eskalieren
4. Leichte Konflikte (unterschiedliche Detailtiefe) zur Prüfung

### 10.6 Chunk-Qualitäts-Audit

**Vorgehen:**
1. Alle Chunks mit `quality_score < 50` identifizieren
2. Chunks mit `processing_error IS NOT NULL` prüfen
3. Chunks mit `facts_count = 0` und `processing_complete = true` untersuchen
4. Verhältnis berechnen: `facts_count / content_tokens` — zu niedrig = schlechte Extraktion

### 10.7 Score-Monitoring

**Ziel:** Kontinuierliche Überwachung der Suchqualität.

**Metriken:**
- Durchschnittlicher Top-1 Similarity Score pro Woche
- Anteil der Anfragen mit Score < 0.3 (= keine gute Antwort)
- Anteil der Anfragen mit Score > 0.7 (= zuverlässige Antwort)
- Trend: Verbessert oder verschlechtert sich die Qualität?

---

## 11. API-Referenz

### 11.1 Kern-Endpoints

| Endpoint | Methode | Zweck |
|----------|---------|-------|
| `/api/cursor/upload` | POST | Dokument hochladen & verarbeiten |
| `/api/cursor/upload-large` | POST | Große Dateien (4-60 MB) |
| `/api/cursor/search` | POST | Vektor-/Semantische Suche |
| `/api/knowledge/search-enhanced` | POST | Volltextsuche mit Filtern |
| `/api/knowledge/intelligent-chunking` | POST | KI-gestütztes Chunking |
| `/api/knowledge/regenerate-facts` | POST | Fakten neu extrahieren |
| `/api/knowledge/find-mismatches` | POST | Widersprüche erkennen |
| `/api/knowledge/combine-suggestions` | POST | Duplikat-Zusammenführung vorschlagen |
| `/api/knowledge/recalculate-quality` | POST | Qualitätsscores neu berechnen |
| `/api/knowledge/delete-chunk` | POST | Chunk + verknüpfte Fakten löschen |
| `/api/knowledge/delete-document` | POST | Dokument + alles darunter löschen |
| `/api/knowledge/sources` | GET | Dokumente in einer KB auflisten |

### 11.2 RPC-Funktionen (Supabase)

| Funktion | Zweck |
|----------|-------|
| `match_knowledge_items` | Vektor-Similarity-Suche |
| `cursor_vector_search` | Cursor-spezifische Vektorsuche |
| `search_knowledge_items_in_base` | Erweiterte Suche mit Filtern |

---

## 12. Datei-Referenz

### Backend-Bibliothek (Wissensdatenbank/)

| Datei | Inhalt |
|-------|--------|
| `lib/knowledge-base/chunking.ts` | Chunking-Logik & Dokumenttyp-Erkennung |
| `lib/knowledge-base/embedding.ts` | Embedding-Erzeugung (OpenAI + lokal) |
| `lib/knowledge-base/extraction.ts` | Textextraktion aus Dateien |
| `lib/knowledge-base/llm-processing.ts` | Fakten-Extraktion via LLM |
| `lib/knowledge-base/graph-algorithms.ts` | Ähnlichkeitsmetriken & Clustering |
| `lib/knowledge-base/n8n.ts` | n8n Workflow-Integration |
| `lib/cursor-documents/processing.ts` | Dokument-Verarbeitungs-Orchestrator |

### API-Routen (Wissensdatenbank/)

| Datei | Endpoint |
|-------|----------|
| `app/api/cursor/upload/route.ts` | Datei-Upload |
| `app/api/cursor/search/route.ts` | Semantische Suche |
| `app/api/knowledge/search-enhanced/route.ts` | Erweiterte Suche |
| `app/api/knowledge/intelligent-chunking/route.ts` | KI-Chunking |
| `app/api/knowledge/find-mismatches/route.ts` | Konflikt-Erkennung |
| `app/api/knowledge/combine-suggestions/route.ts` | Merge-Vorschläge |

### Support AI Integration

| Datei | Inhalt |
|-------|--------|
| `Support AI/src/lib/support-agent/tool-schema.ts` | Alle Agent-Tools |
| `Support AI/src/lib/support-agent/system-prompt.ts` | Prompt-Pipeline |
| `Support AI/src/lib/support-agent/tool-executor.ts` | Tool-Ausführungslogik |
| `Support AI/src/lib/question-prompt-generator.ts` | Fragenprompt-Erzeugung |
| `Support AI/src/lib/smart-prompt-generator.ts` | Smart Prompt Generator |
| `Support AI/src/app/api/voice/chat/route.ts` | Voice KB-Suche |

### Phone Agent

| Datei | Inhalt |
|-------|--------|
| `Phone-Agent/app/prompt_contract.py` | Prompt-Vertrag & Regeln |
| `Phone-Agent/app/realtime_bridge.py` | Twilio ↔ OpenAI Bridge |

---

## 13. Glossar

| Begriff | Bedeutung |
|---------|-----------|
| **Chunk** | Textabschnitt eines Dokuments (typisch 1500-3500 Zeichen) |
| **Fakt / Knowledge Item** | Atomare, selbsterklärende Aussage aus einem Chunk |
| **Embedding** | 1536-dimensionaler Vektor, der die Bedeutung eines Textes numerisch kodiert |
| **Similarity Score** | Cosine-Ähnlichkeit zwischen zwei Embeddings (0.0 = völlig verschieden, 1.0 = identisch) |
| **Fragenprompt** | Regel, die steuert, wie Suchanfragen formuliert werden |
| **Sonderfallprompt** | Harte Regel mit höchster Priorität (überschreibt alles) |
| **Quality Score** | 0-100 Bewertung der Chunk-Qualität |
| **RAG** | Retrieval-Augmented Generation — Fakten aus DB holen, dann Antwort generieren |
| **TF-IDF** | Term Frequency–Inverse Document Frequency — statistische Keyword-Relevanz |
| **GIN Index** | Generalized Inverted Index — PostgreSQL-Index für Volltextsuche |
| **RPC** | Remote Procedure Call — Supabase-Datenbankfunktionen |
| **Multi-Tenancy** | Datenisolation zwischen Unternehmen via company_id |

---

## 14. Checkliste für den QA-Agenten

### Tägliche Prüfungen
- [ ] Gibt es Chunks mit `processing_complete = false` und `processing_error IS NOT NULL`?
- [ ] Gibt es Knowledge Items mit leerem `content`?
- [ ] Durchschnittlicher Similarity-Score der letzten 24h Anfragen?

### Wöchentliche Prüfungen
- [ ] Mismatch-Analyse durchführen
- [ ] Duplikat-Audit durchführen
- [ ] Quality-Score-Verteilung prüfen (Trend)
- [ ] Lückenanalyse auf Basis der Wochenanfragen

### Monatliche Prüfungen
- [ ] Vollständiger Regressionstests-Durchlauf
- [ ] Query-Varianten-Tests für Top-20-Anfragen
- [ ] Chunk-Qualitäts-Audit (Score < 50)
- [ ] Report: KB-Wachstum, Qualitätstrend, offene Probleme
