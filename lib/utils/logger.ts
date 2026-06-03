/**
 * Production-safe Logger
 * Entfernt Debug-Ausgaben in Production und minimiert Console-Spam
 * Zusätzliche Environment-Variable ENABLE_DEBUG_LOGS für feinere Kontrolle
 */

const isProd = process.env.NODE_ENV === 'production'
const isClient = typeof window !== 'undefined'
const debugEnabled = process.env.ENABLE_DEBUG_LOGS === 'true' || !isProd
const verboseEnabled = process.env.ENABLE_VERBOSE_LOGS === 'true' || !isProd

class ProductionLogger {
  debug(message: string, ...args: any[]) {
    // Debug-Logs nur wenn explizit aktiviert
    if (debugEnabled) {
      console.log(`[DEBUG] ${message}`, ...args)
    }
  }

  info(message: string, ...args: any[]) {
    // Info-Logs nur in Development oder wenn Debug aktiviert
    if (debugEnabled) {
      console.log(`[INFO] ${message}`, ...args)
    }
  }

  verbose(message: string, ...args: any[]) {
    // Verbose-Logs für detaillierte API-Calls etc.
    if (verboseEnabled) {
      console.log(`[VERBOSE] ${message}`, ...args)
    }
  }

  warn(message: string, ...args: any[]) {
    // Warnungen auch in Production, aber minimiert
    if (isProd && isClient) {
      // In Production auf Client: Stumm
      return
    }
    console.warn(`[WARN] ${message}`, ...args)
  }

  error(message: string, ...args: any[]) {
    // Fehler immer loggen, aber ohne sensitive Daten
    if (isProd && isClient) {
      // In Production auf Client: Nur Basis-Message
      console.error(`[ERROR] ${message}`)
      return
    }
    console.error(`[ERROR] ${message}`, ...args)
  }

  // Für Server-side kritische Fehler
  serverError(message: string, error?: any) {
    if (isProd) {
      // In Production: Nur Basis-Info, keine Stack Traces
      console.error(`[SERVER-ERROR] ${message}`)
    } else {
      console.error(`[SERVER-ERROR] ${message}`, error)
    }
  }

  // Für API-spezifische Logs
  apiCall(endpoint: string, method: string, ...args: any[]) {
    if (verboseEnabled) {
      console.log(`[API] ${method} ${endpoint}`, ...args)
    }
  }

  apiError(endpoint: string, method: string, error: any) {
    if (isProd) {
      console.error(`[API-ERROR] ${method} ${endpoint}`)
    } else {
      console.error(`[API-ERROR] ${method} ${endpoint}`, error)
    }
  }
}

export const logger = new ProductionLogger()

// Legacy console overrides für bessere Migration
export const debugLog = logger.debug.bind(logger)
export const infoLog = logger.info.bind(logger)
export const verboseLog = logger.verbose.bind(logger)
export const warnLog = logger.warn.bind(logger)
export const errorLog = logger.error.bind(logger)

// Helper für spezifische Use Cases
export const apiLog = logger.apiCall.bind(logger)
export const apiErrorLog = logger.apiError.bind(logger)
export const serverErrorLog = logger.serverError.bind(logger) 