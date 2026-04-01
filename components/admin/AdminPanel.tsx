"use client"

import { AlertTriangle } from 'lucide-react';
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
      <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-[#1e1e1e] p-8">
        <AlertTriangle className="mb-4 size-12 text-muted-foreground opacity-50" />
        <h3 className="mb-2 text-lg font-medium text-white">Zugriff verweigert</h3>
        <p className="text-center text-sm text-muted-foreground">
          Sie haben keine Berechtigung, das Admin-Panel zu nutzen.
        </p>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-1.5 sm:px-3 md:px-4 lg:px-8 pb-4">
      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Search */}
      <AdminUserSearch
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        resultCount={filteredUsers.length}
        totalCount={users.length}
      />

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
