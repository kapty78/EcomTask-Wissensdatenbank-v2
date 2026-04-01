# Deployment Anweisungen für AI-Mitarbeiter App

## Übersicht
Diese Zip-Datei enthält eine Next.js Anwendung namens "AI-Mitarbeiter" (Chatbot-UI), die für das Deployment auf Vercel oder anderen Hosting-Plattformen vorbereitet ist.

## Voraussetzungen
- Node.js 18+ installiert
- npm oder yarn als Package Manager
- Supabase Account für die Datenbank
- Vercel Account (falls Vercel als Deployment-Plattform gewählt wird)

## Deployment-Schritte

### 1. Dateien entpacken
```bash
unzip deployment.zip
cd Wissensdatenbank_EcomTask
```

### 2. Abhängigkeiten installieren
```bash
npm install
```

### 3. Umgebungsvariablen konfigurieren
Erstelle eine `.env.local` Datei mit folgenden Variablen:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Database
DATABASE_URL=your_supabase_database_url

# AI Provider Keys (mindestens einen konfigurieren)
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
GOOGLE_GEMINI_API_KEY=your_google_gemini_api_key

# NextAuth
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=https://your-domain.com

# Optional: Weitere AI Provider
MISTRAL_API_KEY=your_mistral_api_key
AZURE_OPENAI_API_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=your_azure_endpoint
```

### 4. Datenbank Setup (Supabase)
1. Erstelle ein neues Supabase Projekt
2. Führe die Migrationen aus:
```bash
# Supabase CLI installieren (falls nicht vorhanden)
npm install -g supabase

# Mit Supabase verbinden
supabase link --project-ref your-project-ref

# Migrationen ausführen
supabase db push
```

### 5. Build und Deployment

#### Option A: Vercel Deployment
```bash
# Vercel CLI installieren
npm install -g vercel

# Deployment starten
vercel

# Bei der ersten Bereitstellung Umgebungsvariablen in Vercel Dashboard konfigurieren
```

#### Option B: Manueller Build
```bash
# Production Build
npm run build

# Starten
npm run start
```

### 6. Post-Deployment Konfiguration

1. **Admin-Benutzer erstellen**: Verwende die `/register` Route, um den ersten Admin-Benutzer zu erstellen

2. **Wissensdatenbank konfigurieren**: Lade Dokumente in die Wissensdatenbank hoch über das Dashboard

3. **AI-Provider testen**: Stelle sicher, dass mindestens ein AI-Provider korrekt konfiguriert ist

## Wichtige Dateien

- `vercel.json`: Vercel-spezifische Konfiguration
- `next.config.js`: Next.js Konfiguration
- `package.json`: Abhängigkeiten und Skripte
- `supabase/migrations/`: Datenbankmigrationen
- `middleware.ts`: Authentication Middleware

## Features der App

- **Chat-Interface**: KI-gestützter Chat mit verschiedenen AI-Providern
- **Wissensdatenbank**: Upload und Verwaltung von Dokumenten
- **Cursor-Integration**: Spezielle Integration für Cursor IDE
- **Multi-Tenant**: Unterstützung für mehrere Benutzer und Workspaces
- **Admin-Panel**: Benutzerverwaltung und Berechtigungen

## Troubleshooting

### Häufige Probleme:

1. **Build-Fehler**: Stelle sicher, dass alle Umgebungsvariablen gesetzt sind
2. **Datenbank-Verbindung**: Überprüfe die Supabase-Konfiguration
3. **AI-Provider-Fehler**: Validiere die API-Keys für die verwendeten AI-Services

### Support
Bei Problemen konsultiere die Original-Dokumentation oder kontaktiere das Entwicklungsteam.

## Sicherheitshinweise

- Niemals API-Keys in den Code committen
- Verwende starke Secrets für NextAuth
- Konfiguriere Supabase RLS (Row Level Security) korrekt
- Implementiere Rate-Limiting für API-Endpunkte in der Produktionsumgebung

## Performance-Optimierungen

- Die App nutzt Next.js SSR und statische Optimierungen
- Vercel-spezifische Funktionskonfiguration ist in `vercel.json` definiert
- Große Uploads werden mit spezieller Speicher- und Timeout-Konfiguration behandelt 