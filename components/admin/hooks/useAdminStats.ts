"use client"

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { GlobalStats } from '../types';

export function useAdminStats(isSuperAdmin: boolean) {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabaseClient();

  const fetchStats = useCallback(async () => {
    if (!isSuperAdmin) return;

    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/admin/global-stats', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch {
      // Silently handle - stats are non-critical
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, supabase]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, refresh: fetchStats };
}
