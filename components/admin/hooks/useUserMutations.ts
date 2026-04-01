"use client"

import { useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { SolutionFlagKey, SolutionFlags, UserPermission, normalizeSolutionFlags } from '../types';

interface UseUserMutationsProps {
  updateUserLocally: (userId: string, updates: Partial<UserPermission>) => void;
  applySolutionFlagsUpdate: (userId: string, flags: SolutionFlags) => void;
  setError: (error: string | null) => void;
}

export function useUserMutations({
  updateUserLocally,
  applySolutionFlagsUpdate,
  setError,
}: UseUserMutationsProps) {
  const [isUpdateLoading, setIsUpdateLoading] = useState<string | null>(null);
  const [solutionFlagLoading, setSolutionFlagLoading] = useState<string | null>(null);
  const [solutionCompanyLoading, setSolutionCompanyLoading] = useState<string | null>(null);

  const supabase = getSupabaseClient();

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No active session');
    return session;
  }, [supabase]);

  const updateUploadPermission = useCallback(async (targetUserId: string, canUpload: boolean) => {
    try {
      setIsUpdateLoading(targetUserId);
      setError(null);
      const session = await getSession();

      const response = await fetch('/api/admin/manage-permissions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ targetUserId, canUpload }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update permission');
      }

      updateUserLocally(targetUserId, { can_upload: canUpload });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUpdateLoading(null);
    }
  }, [getSession, updateUserLocally, setError]);

  const updateEmailLimit = useCallback(async (targetUserId: string, newLimit: number) => {
    try {
      setIsUpdateLoading(targetUserId);
      setError(null);
      const session = await getSession();

      const response = await fetch('/api/admin/manage-permissions', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ targetUserId, emailLimit: newLimit }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update email limit');
      }

      updateUserLocally(targetUserId, { email_limit: newLimit });
    } catch (err: any) {
      setError(`Fehler beim Aktualisieren des Email-Limits: ${err.message}`);
    } finally {
      setIsUpdateLoading(null);
    }
  }, [getSession, updateUserLocally, setError]);

  const updateKnowledgeBaseLimit = useCallback(async (targetUserId: string, newLimit: number) => {
    try {
      setIsUpdateLoading(targetUserId);
      setError(null);
      const session = await getSession();

      const response = await fetch(`/api/admin/user-limits/${targetUserId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ knowledgeBaseLimit: newLimit }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update KB limit');
      }

      updateUserLocally(targetUserId, { knowledge_base_limit: newLimit });
    } catch (err: any) {
      setError(`Fehler beim Aktualisieren des KB-Limits: ${err.message}`);
    } finally {
      setIsUpdateLoading(null);
    }
  }, [getSession, updateUserLocally, setError]);

  const updateEmailAccountLimit = useCallback(async (targetUserId: string, newLimit: number) => {
    try {
      setIsUpdateLoading(targetUserId);
      setError(null);
      const session = await getSession();

      const response = await fetch(`/api/admin/user-limits/${targetUserId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ emailAccountLimit: newLimit }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update email account limit');
      }

      updateUserLocally(targetUserId, { email_account_limit: newLimit });
    } catch (err: any) {
      setError(`Fehler beim Aktualisieren des Email Account-Limits: ${err.message}`);
    } finally {
      setIsUpdateLoading(null);
    }
  }, [getSession, updateUserLocally, setError]);

  const updateSolutionFlag = useCallback(async (
    targetUserId: string,
    flag: SolutionFlagKey,
    value: boolean,
    companyId?: string | null
  ) => {
    try {
      const loadingKey = `${targetUserId}:${flag}`;
      setSolutionFlagLoading(loadingKey);
      setError(null);
      const session = await getSession();

      const response = await fetch(`/api/admin/user-solution-flags/${targetUserId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ [flag]: value, companyId: companyId ?? null }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update solution flag');
      }

      const updatedFlags = await response.json();
      const normalizedFlags = normalizeSolutionFlags(updatedFlags, targetUserId, companyId ?? null);
      applySolutionFlagsUpdate(targetUserId, normalizedFlags);
    } catch (err: any) {
      setError(`Fehler beim Aktualisieren der Lösungen: ${err.message}`);
    } finally {
      setSolutionFlagLoading(null);
    }
  }, [getSession, applySolutionFlagsUpdate, setError]);

  const updateSolutionCompany = useCallback(async (
    targetUserId: string,
    companyId: string | null
  ) => {
    try {
      setSolutionCompanyLoading(targetUserId);
      setError(null);
      const session = await getSession();

      const response = await fetch(`/api/admin/user-solution-flags/${targetUserId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companyId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update solution company');
      }

      const updatedFlags = await response.json();
      const normalizedFlags = normalizeSolutionFlags(updatedFlags, targetUserId, companyId ?? null);
      applySolutionFlagsUpdate(targetUserId, normalizedFlags);
    } catch (err: any) {
      setError(`Fehler beim Aktualisieren der Company: ${err.message}`);
    } finally {
      setSolutionCompanyLoading(null);
    }
  }, [getSession, applySolutionFlagsUpdate, setError]);

  return {
    isUpdateLoading,
    solutionFlagLoading,
    solutionCompanyLoading,
    updateUploadPermission,
    updateEmailLimit,
    updateKnowledgeBaseLimit,
    updateEmailAccountLimit,
    updateSolutionFlag,
    updateSolutionCompany,
  };
}
