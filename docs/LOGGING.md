# Logging Configuration

## Überblick

Die Anwendung verwendet ein zentrales Logging-System, das in der Produktion automatisch Debug-Logs deaktiviert und die Konsolen-Ausgaben minimiert.

## Environment-Variablen

### Verfügbare Logging-Einstellungen:

```bash
# Aktiviert Debug-Logs auch in der Produktion (default: false)
ENABLE_DEBUG_LOGS=false

# Aktiviert verbose API-Logs auch in der Produktion (default: false)
ENABLE_VERBOSE_LOGS=false
```

## Logger-Funktionen

### Verfügbare Log-Level:

```typescript
import { logger } from '@/lib/utils/logger'

// Debug-Logs (nur in Development oder wenn ENABLE_DEBUG_LOGS=true)
logger.debug("Debug message", { data: "example" })

// Info-Logs (nur in Development oder wenn ENABLE_DEBUG_LOGS=true)
logger.info("Info message", { data: "example" })

// Verbose-Logs für detaillierte API-Calls (nur wenn ENABLE_VERBOSE_LOGS=true)
logger.verbose("Verbose message", { data: "example" })

// Warnungen (in Production auf Client stumm)
logger.warn("Warning message", { data: "example" })

// Fehler (immer sichtbar, aber ohne sensitive Daten in Production)
logger.error("Error message", { error: errorObject })

// Server-Errors (minimiert in Production)
logger.serverError("Server error", errorObject)

// API-spezifische Logs
logger.apiCall("/api/endpoint", "POST", { requestData: "example" })
logger.apiError("/api/endpoint", "POST", errorObject)
```

## Verhalten in verschiedenen Environments

### Development (NODE_ENV=development)
- **Alle Logs** werden angezeigt
- Vollständige Stack Traces und Error-Details
- Detaillierte Debug-Informationen

### Production (NODE_ENV=production)
- **Debug/Info/Verbose Logs**: Stumm (außer wenn explizit aktiviert)
- **Warnings**: Auf Client stumm, auf Server sichtbar
- **Errors**: Minimiert, ohne sensitive Daten
- **Server Errors**: Nur Basis-Informationen

## Für Vercel Deployment

### Empfohlene Einstellungen:

```bash
# In Vercel Environment Variables
NODE_ENV=production
ENABLE_DEBUG_LOGS=false
ENABLE_VERBOSE_LOGS=false
```

### Bei Debugging-Bedarf in Production:

```bash
# Temporär für Debugging aktivieren
ENABLE_DEBUG_LOGS=true
ENABLE_VERBOSE_LOGS=true
```

**Wichtig**: Nach dem Debugging wieder deaktivieren, um die Performance zu optimieren und sensitive Daten zu schützen.

## Legacy Console-Replacements

Für einfache Migration sind auch diese Helper verfügbar:

```typescript
import { debugLog, infoLog, verboseLog, warnLog, errorLog, apiLog, apiErrorLog, serverErrorLog } from '@/lib/utils/logger'

debugLog("Debug message")
infoLog("Info message")
errorLog("Error message", errorObject)
```

## Best Practices

1. **Verwende den passenden Log-Level**:
   - `debug`: Entwicklungs-Debugging
   - `info`: Allgemeine Informationen
   - `verbose`: Detaillierte API-Calls und Datenfluss
   - `warn`: Potenzielle Probleme
   - `error`: Echte Fehler

2. **Keine sensitiven Daten loggen**:
   - Keine Passwörter, API-Keys oder persönliche Daten
   - In Production werden Logs automatisch gefiltert

3. **Strukturierte Logs verwenden**:
   ```typescript
   logger.error("Database connection failed", {
     endpoint: "/api/users",
     userId: "user123",
     timestamp: new Date().toISOString()
   })
   ```

4. **API-Logs für besseres Monitoring**:
   ```typescript
   logger.apiCall("/api/knowledge/sources", "POST", { kb_id: "123" })
   logger.apiError("/api/knowledge/sources", "POST", error)
   ```
