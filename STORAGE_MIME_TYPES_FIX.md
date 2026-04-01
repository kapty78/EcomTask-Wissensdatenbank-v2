# Storage MIME Types Fix - .docx und andere Dateitypen aktivieren

## Problem
Die Wissensdatenbank zeigt den Fehler: "Storage error: Failed to upload file to storage: mime type application/vnd.openxmlformats-officedocument.wordprocessingml.document is not supported"

Dies passiert, weil der Supabase Storage Bucket die MIME-Types für Word-Dokumente (.doc, .docx) und andere Dateitypen nicht konfiguriert hat.

## Lösung

### Option 1: Migration über Supabase Dashboard (Empfohlen)

1. Öffnen Sie das Supabase Dashboard: https://app.supabase.com
2. Wählen Sie Ihr Projekt aus
3. Gehen Sie zu **SQL Editor** in der linken Navigation
4. Erstellen Sie eine neue Query
5. Kopieren Sie den folgenden SQL-Code und führen Sie ihn aus:

```sql
-- Update Storage Bucket to support all required document MIME types
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents', 
  true,
  209715200, -- 200MB limit
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/html',
    'application/msword', -- .doc files
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- .docx files
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', -- .xlsx files
    'application/vnd.ms-excel' -- .xls files
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
```

6. Klicken Sie auf **Run** / **Ausführen**
7. Überprüfen Sie, dass die Meldung "Success" angezeigt wird

### Option 2: Migration über Supabase CLI

Wenn Sie die Supabase CLI installiert haben:

```bash
# Mit Ihrer Produktionsdatenbank verbinden
supabase link --project-ref IHR_PROJECT_REF

# Migration ausführen
supabase db push
```

## Überprüfung

Nach der Ausführung sollten folgende Dateitypen funktionieren:
- ✅ .pdf (PDF-Dokumente)
- ✅ .doc (Word 97-2003)
- ✅ .docx (Word 2007+)
- ✅ .txt (Textdateien)
- ✅ .md (Markdown)
- ✅ .html (HTML-Dateien)
- ✅ .xls (Excel 97-2003)
- ✅ .xlsx (Excel 2007+)

## Testen

1. Gehen Sie zur Wissensdatenbank
2. Versuchen Sie, eine .docx-Datei hochzuladen
3. Der Upload sollte jetzt erfolgreich sein

## Troubleshooting

### Fehler: "Bucket 'documents' existiert nicht"
Führen Sie zuerst die Storage-Policies-Migration aus:
```bash
supabase migration up 20250111_fix_storage_policies.sql
```

### Fehler bleibt bestehen
1. Überprüfen Sie in der Supabase-Konsole unter **Storage** > **Buckets** > **documents**
2. Prüfen Sie die "Allowed MIME types" Einstellung
3. Stellen Sie sicher, dass die Liste alle oben genannten MIME-Types enthält

## Technische Details

Die Migration aktualisiert die `storage.buckets` Tabelle und setzt:
- `file_size_limit`: 200MB (war vorher 50MB)
- `allowed_mime_types`: Erweiterte Liste mit allen Office-Formaten
- `public`: true (für öffentlichen Lesezugriff)

Die Frontend- und Backend-Validierung unterstützt diese Dateitypen bereits - nur die Storage-Konfiguration musste aktualisiert werden.



