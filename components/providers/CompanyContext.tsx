"use client"

import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { useUser } from '@supabase/auth-helpers-react';

interface CompanyProfile {
  company_id: string | null;
  company_name: string | null;
  is_admin: boolean;
}

interface CompanyContextType extends CompanyProfile {
  loading: boolean;
  error: string | null;
  refreshCompanyProfile: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    company_id: null,
    company_name: null,
    is_admin: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => getSupabaseClient(), []);

  const fetchCompanyProfile = useCallback(async () => {
    if (!user?.id) {
      setCompanyProfile({ company_id: null, company_name: null, is_admin: false });
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // 1. Lade Profil mit company_id und company_name
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("company_id, company_name")
        .eq("id", user.id)
        .single();

      if (profileError) {
        console.error("Fehler beim Laden des Profils:", profileError);
        setError("Fehler beim Laden der Company-Daten");
        setLoading(false);
        return;
      }

      if (!profile?.company_id) {
        // User hat keine Company zugewiesen - das ist okay für manche Anwendungsfälle
        setCompanyProfile({ company_id: null, company_name: null, is_admin: false });
        setError(null); // Kein Fehler, nur keine Company
        setLoading(false);
        return;
      }

      // 2. Prüfe ob Admin für diese Company
      const { data: adminData } = await supabase
        .from("company_admins")
        .select("company_id")
        .eq("user_id", user.id)
        .eq("company_id", profile.company_id)
        .maybeSingle();

      setCompanyProfile({
        company_id: profile.company_id,
        company_name: profile.company_name || null,
        is_admin: !!adminData,
      });
      setError(null);
    } catch (err) {
      console.error("Unerwarteter Fehler beim Laden der Company-Daten:", err);
      setError("Fehler beim Laden der Company-Daten");
    } finally {
      setLoading(false);
    }
  }, [user?.id, supabase]);

  useEffect(() => {
    // Warte bis User-Status bekannt ist
    if (user !== undefined) {
      fetchCompanyProfile();
    }
  }, [user, fetchCompanyProfile]);

  const value = useMemo(() => ({
    ...companyProfile,
    loading,
    error,
    refreshCompanyProfile: fetchCompanyProfile,
  }), [companyProfile, loading, error, fetchCompanyProfile]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error("useCompany must be used within CompanyProvider");
  }
  return context;
}

// Helper-Hook für company_id mit Fehlerbehandlung
export function useCompanyId(): string | null {
  const { company_id } = useCompany();
  return company_id;
}

// Helper-Hook für INSERT-Operationen
export function useCompanyForInsert() {
  const { company_id, loading, error } = useCompany();
  
  return {
    company_id,
    isReady: !loading && !!company_id,
    error: error || (!loading && !company_id ? "Keine Company zugewiesen" : null)
  };
}
