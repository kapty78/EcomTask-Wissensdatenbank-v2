# AI-Mitarbeiter - Bereinigte Version für Vercel-Deployment

Diese Version der Anwendung wurde automatisch für die Bereitstellung auf Vercel optimiert.
Sie enthält nur die wesentlichen Komponenten für:

1. Login und Registrierung
2. Dashboard
3. Dokumenten-Management (Upload, Anzeige, Löschen)

## Bereitstellung auf Vercel

1. Importieren Sie dieses Verzeichnis in ein Git-Repository
2. Verbinden Sie das Repository mit Ihrer Vercel-Instanz
3. Stellen Sie sicher, dass die folgenden Umgebungsvariablen in Vercel konfiguriert sind:

   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY (für Admin-Funktionen)

## Lokales Testen vor der Bereitstellung

```
npm install
npm run dev
```

## Erstellt am Fri May  9 16:09:29 CEST 2025
