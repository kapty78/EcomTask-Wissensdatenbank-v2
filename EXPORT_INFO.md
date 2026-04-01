# AI-Mitarbeiter - Sauberer Export

## Export-Informationen

- **Erstellt am:** 2025-07-15 23:45:03
- **Export-Typ:** Bereinigte Applikation (ohne RAGFlow)
- **Plattform:** Next.js + Supabase

## Enthaltene Komponenten

### ✅ Eingeschlossen:
- **app/** - Next.js App Router und Seiten
- **components/** - React-Komponenten
- **lib/** - Utility-Funktionen und Bibliotheken
- **types/** - TypeScript-Typen
- **hooks/** - React Hooks
- **supabase/** - Datenbank-Konfiguration und Migrationen
- **public/** - Statische Assets (Bilder, Icons)
- **Konfigurationsdateien** - package.json, next.config.js, etc.

### ❌ Ausgeschlossen:
- **ragflow/** - Python RAGFlow-System (nicht für Applikation benötigt)
- **node_modules/** - NPM Dependencies (npm install erforderlich)
- **.next/** - Build-Artefakte (npm run build erforderlich)
- **.git/** - Git-Repository-Daten
- **Log-Dateien** - *.log, dev.log
- **Temporäre Dateien** - *.tmp, *.csv, etc.

## Deployment-Anweisungen

1. **Dateien extrahieren:**
   ```bash
   unzip ai_mitarbeiter_clean_*.zip
   cd extracted_folder
   ```

2. **Dependencies installieren:**
   ```bash
   npm install
   ```

3. **Umgebungsvariablen konfigurieren:**
   - Erstelle `.env.local` mit Supabase-Credentials
   - Siehe `DEPLOYMENT_README.md` für Details

4. **Applikation starten:**
   ```bash
   npm run dev    # Entwicklung
   npm run build  # Produktion
   ```

## Support

Für Deployment-Hilfe siehe:
- `DEPLOYMENT_README.md` - Detaillierte Anweisungen
- `README-VERCEL.md` - Vercel-spezifische Anweisungen

---
*Generiert vom AI-Mitarbeiter Export-Tool*
