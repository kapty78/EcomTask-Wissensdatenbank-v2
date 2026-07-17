"use client"

import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { UserPermission } from './types';
import { useAdminUsers } from './hooks/useAdminUsers';
import { useAdminStats } from './hooks/useAdminStats';
import { useUserMutations } from './hooks/useUserMutations';
import AdminStatsGrid from './AdminStatsGrid';
import AdminUserSearch from './AdminUserSearch';
import AdminUserTable from './AdminUserTable';
import AdminUserCardList from './AdminUserCardList';
import AdminUserDetailSheet from './AdminUserDetailSheet';

interface AdminPanelProps {
  user: User;
}

export default function AdminPanel({ user }: AdminPanelProps) {
  const {
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
    updateUserLocally,
    applySolutionFlagsUpdate,
  } = useAdminUsers(user);

  const { stats } = useAdminStats(isSuperAdmin);

  const mutations = useUserMutations({
    updateUserLocally,
    applySolutionFlagsUpdate,
    setError,
  });

  const handleSelectUser = (u: UserPermission) => {
    setSelectedUser(u);
  };

  // Access denied
  if (!loading && !isSuperAdmin) {
    return (
      <div className="mx-auto mt-8 flex max-w-md flex-col items-center rounded-2xl border border-white/[0.08] bg-[#1d1d1d] p-8 text-center">
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <AlertTriangle className="size-6" />
        </span>
        <h3 className="mb-1.5 text-base font-semibold text-white">Zugriff verweigert</h3>
        <p className="text-sm text-muted-foreground">
          Sie haben keine Berechtigung, das Admin-Panel zu nutzen.
        </p>
      </div>
    );
  }

  // Loading — Marken-Logo statt generischem Spinner
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/wissensdatenbank-logo-v2.png"
          alt=""
          aria-hidden
          className="size-10 animate-pulse select-none"
          draggable={false}
        />
        <span className="text-xs text-muted-foreground">Lade Benutzer…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-1.5 pb-4 sm:px-3 md:px-4 lg:px-8">
      {/* Kopfbereich: Identität des Panels + Suche */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 flex-shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-white sm:text-lg">
              Benutzerverwaltung
            </h2>
            <p className="text-xs text-muted-foreground">
              Berechtigungen, Limits &amp; Lösungen zentral steuern
            </p>
          </div>
        </div>
        <div className="w-full sm:w-72 md:w-80">
          <AdminUserSearch
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            resultCount={filteredUsers.length}
            totalCount={users.length}
          />
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 flex-shrink-0 text-red-400" />
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Stats */}
      <AdminStatsGrid stats={stats} userCount={users.length} />

      {/* Desktop Table */}
      <div className="hidden md:block">
        <AdminUserTable
          users={filteredUsers}
          searchTerm={searchTerm}
          totalCount={users.length}
          isUpdateLoading={mutations.isUpdateLoading}
          onSelectUser={handleSelectUser}
          onToggleUpload={mutations.updateUploadPermission}
        />
      </div>

      {/* Mobile Card List */}
      <div className="block md:hidden">
        <AdminUserCardList
          users={filteredUsers}
          searchTerm={searchTerm}
          totalCount={users.length}
          onSelectUser={handleSelectUser}
        />
      </div>

      {/* Detail Sheet */}
      <AdminUserDetailSheet
        user={selectedUser}
        open={!!selectedUser}
        onOpenChange={(open) => { if (!open) setSelectedUser(null); }}
        companies={companies}
        companiesLoading={companiesLoading}
        isUpdateLoading={mutations.isUpdateLoading}
        solutionFlagLoading={mutations.solutionFlagLoading}
        solutionCompanyLoading={mutations.solutionCompanyLoading}
        onToggleUpload={mutations.updateUploadPermission}
        onUpdateEmailLimit={mutations.updateEmailLimit}
        onUpdateKBLimit={mutations.updateKnowledgeBaseLimit}
        onUpdateEmailAccountLimit={mutations.updateEmailAccountLimit}
        onToggleFlag={mutations.updateSolutionFlag}
        onChangeCompany={mutations.updateSolutionCompany}
      />
    </div>
  );
}
