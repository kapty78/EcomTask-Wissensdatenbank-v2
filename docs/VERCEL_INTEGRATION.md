# Vercel-Integration für die Dokumentenverarbeitung

Diese Dokumentation beschreibt, wie die parallele Dokumentenverarbeitung auf Vercel eingerichtet wird.

## Übersicht

Die Dokumentenverarbeitung wurde so umgestaltet, dass sie auf Vercel's serverless Architektur optimal funktioniert. Hierzu wurde der Verarbeitungsprozess in kleinere, unabhängige Schritte aufgeteilt:

1. **Initiale Verarbeitung**: Extrahiert Text und teilt das Dokument in Chunks auf
2. **Parallele Chunk-Verarbeitung**: Verarbeitet jeden Chunk unabhängig in separaten Serverless-Funktionen
3. **Status-Monitoring**: Überwacht den Fortschritt aller Chunk-Verarbeitungen

Dieser Ansatz vermeidet Vercel's Timeout-Limits (10s im Hobby-Plan, 60s im Pro-Plan) und ermöglicht die effiziente Verarbeitung auch größerer Dokumente.

## Einrichtung

### 1. Datenbank-Migration

Zuerst müssen neue Felder zur `document_chunks`-Tabelle hinzugefügt werden:

```sql
-- Führen Sie das Migrationsskript aus
-- Siehe: db_migrations/add_chunk_processing_fields.sql
```

Sie können das SQL-Skript in der Supabase SQL-Konsole ausführen oder mit einem anderen SQL-Client.

### 2. Umgebungsvariablen

Folgende Umgebungsvariablen müssen in Vercel eingerichtet werden:

```
# Bestehende Variablen (müssen bereits gesetzt sein)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=your-openai-api-key

# Neue Variablen für parallele Verarbeitung
API_SECRET_KEY=ein-sicherer-zufälliger-schlüssel-für-interne-api-aufrufe
API_LOG_LEVEL=info
LOG_LEVEL=info
```

Der `API_SECRET_KEY` wird für die interne Kommunikation zwischen den Serverless-Funktionen verwendet. Generieren Sie einen sicheren Zufallsschlüssel (z.B. mit `openssl rand -base64 32`).

### 3. Vercel-Konfiguration

Passen Sie die `vercel.json` Datei an, um die längere Laufzeit für die Chunk-Verarbeitung zu ermöglichen:

```json
{
  "functions": {
    "app/api/cursor/process-chunk/route.ts": {
      "maxDuration": 60
    }
  }
}
```

## Wie es funktioniert

1. **Upload-Phase**:
   - Wenn ein Dokument hochgeladen wird, extrahiert die `processDocumentFile`-Funktion den Text und teilt ihn in Chunks auf
   - Die Chunks werden in der Datenbank gespeichert und mit `processing_complete=false` markiert
   - Die Upload-Route startet dann die asynchrone Verarbeitung der Chunks

2. **Verteilte Verarbeitung**:
   - Für jeden Chunk wird ein separater API-Aufruf an den `/api/cursor/process-chunk`-Endpunkt gesendet
   - Jede Anfrage verarbeitet einen einzelnen Chunk (Textaufbereitung, Faktenextraktion, Embedding-Generierung)
   - Nach Abschluss wird der Chunk-Status in der Datenbank auf `processing_complete=true` gesetzt

3. **Status-Überwachung**:
   - Ein Hintergrundprozess überwacht den Fortschritt aller Chunks
   - Die UI pollt den Dokumentstatus und zeigt den Gesamtfortschritt an

## Fehlerbehebung

### Timeouts bei der Verarbeitung

Wenn einzelne Chunks zu groß sind und Timeouts verursachen:

1. Passen Sie die Chunking-Parameter in `lib/cursor-documents/processing.ts` an:
   ```typescript
   const CHUNK_SIZE = 2000; // Verkleinern für kürzere Verarbeitungszeiten
   const CHUNK_OVERLAP = 100;
   ```

2. Stellen Sie sicher, dass das `maxDuration`-Limit in `vercel.json` ausreichend ist

### Fehler beim API-Aufruf

Wenn die Chunk-Verarbeitung nicht gestartet wird:

1. Überprüfen Sie, ob `API_SECRET_KEY` korrekt gesetzt ist
2. Prüfen Sie die Logs in der Vercel-Konsole auf Fehlermeldungen
3. Stellen Sie sicher, dass die Base-URL korrekt ist:
   ```typescript
   const baseUrl = `${process.env.NEXT_PUBLIC_VERCEL_URL || process.env.VERCEL_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'}`;
   ```

## Leistungsoptimierung

- Reduzieren Sie die Parallelität (standardmäßig werden alle Chunks gleichzeitig verarbeitet)
- Verwenden Sie ein leichtgewichtigeres Modell für die Textvorverarbeitung
- Aktivieren Sie Vercel Serverless Cache für wiederholte Anfragen

## Fazit

Mit dieser Architektur können nun auch große Dokumente auf Vercel verarbeitet werden, ohne die Timeout-Grenzen zu überschreiten. Die parallele Verarbeitung sorgt zudem für schnellere Gesamtverarbeitungszeiten. 