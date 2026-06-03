/**
 * RLS (Row Level Security) Fehlerbehandlung
 * 
 * Diese Hilfsfunktionen helfen bei der Erkennung und Behandlung von
 * RLS-bezogenen Fehlern, die auftreten können, wenn ein Benutzer
 * keine company_id zugewiesen hat oder die RLS-Policies den Zugriff verweigern.
 */

import { PostgrestError } from '@supabase/supabase-js';

export interface RLSErrorResult {
  isRLSError: boolean;
  userFriendlyMessage: string;
  shouldShowNoCompanyWarning: boolean;
}

/**
 * Prüft ob ein Supabase-Fehler ein RLS-bezogener Fehler ist
 */
export function isRLSError(error: PostgrestError | null | undefined): boolean {
  if (!error) return false;
  
  // PostgreSQL permission denied error
  if (error.code === '42501') return true;
  
  // RLS-spezifische Fehlermeldungen
  if (error.message?.toLowerCase().includes('permission denied')) return true;
  if (error.message?.toLowerCase().includes('row level security')) return true;
  if (error.message?.toLowerCase().includes('violates row-level security policy')) return true;
  if (error.message?.toLowerCase().includes('rls')) return true;
  
  return false;
}

/**
 * Analysiert einen Supabase-Fehler und gibt benutzerfreundliche Informationen zurück
 */
export function handleRLSError(error: PostgrestError | null | undefined): RLSErrorResult {
  if (!error) {
    return {
      isRLSError: false,
      userFriendlyMessage: '',
      shouldShowNoCompanyWarning: false,
    };
  }

  if (isRLSError(error)) {
    return {
      isRLSError: true,
      userFriendlyMessage: 'Keine Berechtigung. Bitte prüfen Sie, ob Ihrem Account eine Company zugewiesen ist.',
      shouldShowNoCompanyWarning: true,
    };
  }

  // Andere häufige Fehler
  if (error.code === 'PGRST116') {
    return {
      isRLSError: false,
      userFriendlyMessage: 'Keine Daten gefunden.',
      shouldShowNoCompanyWarning: false,
    };
  }

  return {
    isRLSError: false,
    userFriendlyMessage: error.message || 'Ein unerwarteter Fehler ist aufgetreten.',
    shouldShowNoCompanyWarning: false,
  };
}

/**
 * Wrapper-Funktion für sichere Supabase-Queries mit RLS-Fehlerbehandlung
 */
export async function safeSupabaseQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: PostgrestError | null }>,
  options?: {
    onRLSError?: () => void;
    fallbackData?: T;
  }
): Promise<{ data: T | null; error: string | null; isRLSError: boolean }> {
  try {
    const { data, error } = await queryFn();
    
    if (error) {
      const rlsResult = handleRLSError(error);
      
      if (rlsResult.isRLSError && options?.onRLSError) {
        options.onRLSError();
      }
      
      return {
        data: options?.fallbackData ?? null,
        error: rlsResult.userFriendlyMessage,
        isRLSError: rlsResult.isRLSError,
      };
    }
    
    return {
      data,
      error: null,
      isRLSError: false,
    };
  } catch (err) {
    return {
      data: options?.fallbackData ?? null,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
      isRLSError: false,
    };
  }
}

/**
 * Prüft ob ein Benutzer eine company_id zugewiesen hat
 * Nützlich für Pre-Checks vor INSERT-Operationen
 */
export function validateCompanyId(companyId: string | null | undefined): {
  isValid: boolean;
  errorMessage: string | null;
} {
  if (!companyId || companyId.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Keine Company zugewiesen. Bitte kontaktieren Sie einen Administrator.',
    };
  }
  
  // UUID-Format-Prüfung (optional, aber hilfreich)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(companyId)) {
    return {
      isValid: false,
      errorMessage: 'Ungültiges Company-ID Format.',
    };
  }
  
  return {
    isValid: true,
    errorMessage: null,
  };
}
