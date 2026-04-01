"use client"

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { User } from '@supabase/supabase-js';
import {
  UserPermission,
  CompanyOption,
  SolutionFlags,
  normalizeSolutionFlags,
} from '../types';

export function useAdminUsers(user: User) {
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserPermission[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserPermission | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);

  const supabase = getSupabaseClient();

  // Check super admin status
  useEffect(() => {
    const checkSuperAdmin = async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_super_admin')
          .eq('id', user.id)
          .single();
        setIsSuperAdmin(profile?.is_super_admin || false);
      } catch {
        setIsSuperAdmin(false);
      }
    };
    if (user?.id) checkSuperAdmin();
  }, [user, supabase]);

  // Fetch companies
  const fetchCompanies = useCallback(async () => {
    try {
      setCompaniesLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const response = await fetch('/api/admin/companies', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Fehler beim Laden der Unternehmen');
      }

      const payload = await response.json();
      setCompanies(payload.companies || []);
    } catch (err: any) {
      console.error('Fehler beim Laden der Unternehmen:', err);
    } finally {
      setCompaniesLoading(false);
    }
  }, [supabase]);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    if (!isSuperAdmin) return;

    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const response = await fetch('/api/admin/manage-permissions', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const responseData = await response.json();
      if (!response.ok) {
        const errorMessage = responseData.details
          ? `${responseData.error}: ${responseData.details}`
          : responseData.error || 'Fehler beim Laden der Benutzer';
        throw new Error(errorMessage);
      }

      // Process users with metrics
      const usersWithMetrics = await Promise.all(
        (responseData.users || []).map(async (u: any) => {
          let directMetrics = null;
          try {
            const [plResult, kbResult, emailResult] = await Promise.all([
              supabase.from('process_logs').select('*', { count: 'exact', head: true }).eq('user_id', u.user_id),
              supabase.from('knowledge_bases').select('*', { count: 'exact', head: true }).eq('user_id', u.user_id),
              supabase.from('user_email_accounts').select('*', { count: 'exact', head: true }).eq('user_id', u.user_id),
            ]);

            if (!plResult.error && !kbResult.error && !emailResult.error) {
              directMetrics = {
                totalProcessLogs: plResult.count || 0,
                avgFirstResponseTime: 0,
                lastActivityAt: null,
                lastEmailProcessedAt: null,
                additionalStats: {
                  knowledgeBasesCount: kbResult.count || 0,
                  emailAccountsCount: emailResult.count || 0,
                  totalProcessLogs: plResult.count || 0,
                },
              };
            }
          } catch { /* ignore */ }

          const normalizedFlags = normalizeSolutionFlags(
            u.solution_flags,
            u.user_id,
            u.company_id ?? null
          );

          return {
            ...u,
            company_id: u.company_id ?? normalizedFlags.company_id,
            knowledge_base_limit: u.knowledge_base_limit || 5,
            email_account_limit: u.email_account_limit || 3,
            executive_report_enabled: u.executive_report_enabled || false,
            executive_report_frequency: u.executive_report_frequency || 'monthly',
            executive_report_email: u.executive_report_email || null,
            metrics: directMetrics,
            solution_flags: normalizedFlags,
          };
        })
      );

      // Fetch global stats and attach
      try {
        const statsResponse = await fetch('/api/admin/global-stats', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (statsResponse.ok) {
          const globalStatsData = await statsResponse.json();
          const usersWithGlobalStats = usersWithMetrics.map((u: any) => ({
            ...u,
            globalStats: globalStatsData,
          }));
          setUsers(usersWithGlobalStats);
          setFilteredUsers(usersWithGlobalStats);
        } else {
          setUsers(usersWithMetrics);
          setFilteredUsers(usersWithMetrics);
        }
      } catch {
        setUsers(usersWithMetrics);
        setFilteredUsers(usersWithMetrics);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, supabase]);

  // Load data when super admin confirmed
  useEffect(() => {
    if (isSuperAdmin) {
      fetchUsers();
      fetchCompanies();
    }
  }, [isSuperAdmin, fetchUsers, fetchCompanies]);

  // Search filtering
  useEffect(() => {
    const filtered = users.filter(u =>
      (u.email && u.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (u.full_name && u.full_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (u.company_name && u.company_name.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    setFilteredUsers(filtered);
  }, [searchTerm, users]);

  // Update user locally after mutations
  const updateUserLocally = useCallback((targetUserId: string, updates: Partial<UserPermission>) => {
    const updater = (prev: UserPermission[]) =>
      prev.map(u => u.user_id === targetUserId ? { ...u, ...updates } : u);

    setUsers(updater);
    setFilteredUsers(updater);

    if (selectedUser?.user_id === targetUserId) {
      setSelectedUser(prev => prev ? { ...prev, ...updates } : null);
    }
  }, [selectedUser]);

  // Update solution flags specifically
  const applySolutionFlagsUpdate = useCallback((targetUserId: string, normalizedFlags: SolutionFlags) => {
    const updates = { company_id: normalizedFlags.company_id, solution_flags: normalizedFlags };
    const updater = (prev: UserPermission[]) =>
      prev.map(u => u.user_id === targetUserId ? { ...u, ...updates } : u);

    setUsers(updater);
    setFilteredUsers(updater);

    if (selectedUser?.user_id === targetUserId) {
      setSelectedUser(prev => prev ? { ...prev, ...updates } : null);
    }
  }, [selectedUser]);

  return {
    users,
    filteredUsers,
    searchTerm,
    setSearchTerm,
    loading,
    error,
    setError,
    isSuperAdmin,
    selectedUser,
    setSelectedUser,
    companies,
    companiesLoading,
    refreshUsers: fetchUsers,
    updateUserLocally,
    applySolutionFlagsUpdate,
  };
}
