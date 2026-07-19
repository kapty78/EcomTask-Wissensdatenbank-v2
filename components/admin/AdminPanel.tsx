"use client"

import { useMemo, useState } from 'react';
import { AlertTriangle, ShieldCheck, ArrowLeft, Building2 } from 'lucide-react';
import { LogoSpinner } from '@/components/DynamicLogo';
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
import AdminCompanyGallery, { CompanyGroup, companyMonogram } from './AdminCompanyGallery';
import CompanyMailModelSetting from './CompanyMailModelSetting';

interface AdminPanelProps {
  user: User;
}

const NONE_KEY = '__none__';

/** selectedCompanyId ist nur bei einer echten Firma eine UUID (sonst name:/__none__). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stabiler Gruppenschlüssel: company_id, sonst der Name, sonst „ohne Firma". */
function companyKeyOf(u: UserPermission): string {
  if (u.company_id) return u.company_id;
  if (u.company_name) return `name:${u.company_name}`;
  return NONE_KEY;
}

/** Nutzer nach Unternehmen bündeln (inkl. Aktiv-/Admin-/Lösungs-Aggregat). */
function buildCompanyGroups(list: UserPermission[]): CompanyGroup[] {
  const map = new Map<string, CompanyGroup>();

  for (const u of list) {
    const key = companyKeyOf(u);
    let group = map.get(key);
    if (!group) {
      group = {
        id: key,
        name: u.company_name || 'Ohne Unternehmen',
        users: [],
        activeCount: 0,
        adminCount: 0,
        solutions: [],
        hasCompany: Boolean(u.company_name),
      };
      map.set(key, group);
    }
    group.users.push(u);
    if (u.can_upload) group.activeCount += 1;
    if (u.is_super_admin) group.adminCount += 1;
  }

  for (const group of map.values()) {
    const set = new Set<string>();
    for (const u of group.users) {
      const flags = u.solution_flags;
      if (!flags) continue;
      if (flags.chatbot) set.add('Chatbot');
      if (flags.phone) set.add('Phone');
      if (flags.mail) set.add('Mail');
      if (flags.assistant) set.add('Assistant');
      if (flags.follow_up) set.add('Follow-up');
    }
    group.solutions = Array.from(set);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.hasCompany !== b.hasCompany) return a.hasCompany ? -1 : 1;
    if (b.users.length !== a.users.length) return b.users.length - a.users.length;
    return a.name.localeCompare(b.name, 'de');
  });
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

  // Ebene 1 = Firmen-Galerie, Ebene 2 = Nutzer der gewählten Firma.
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const companyGroups = useMemo(() => buildCompanyGroups(filteredUsers), [filteredUsers]);
  const totalCompanies = useMemo(() => buildCompanyGroups(users).length, [users]);

  const companyUsers = useMemo(
    () =>
      selectedCompanyId
        ? filteredUsers.filter((u) => companyKeyOf(u) === selectedCompanyId)
        : [],
    [filteredUsers, selectedCompanyId],
  );

  // Firmen-Kopf stabil aus allen Nutzern ableiten (bleibt auch bei leerer Suche).
  const selectedCompany = useMemo(() => {
    if (!selectedCompanyId) return null;
    const match = users.find((u) => companyKeyOf(u) === selectedCompanyId);
    const total = users.filter((u) => companyKeyOf(u) === selectedCompanyId).length;
    return {
      name: match?.company_name || 'Ohne Unternehmen',
      hasCompany: Boolean(match?.company_name),
      total,
    };
  }, [users, selectedCompanyId]);

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
        <LogoSpinner size={40} className="select-none" />
        <span className="text-xs text-muted-foreground">Lade Benutzer…</span>
      </div>
    );
  }

  const inCompanyView = Boolean(selectedCompanyId && selectedCompany);

  return (
    <div className="space-y-4 px-1.5 pb-4 sm:px-3 md:px-4 lg:px-8">
      {/* Kopfbereich: Panel-Identität ODER Firmen-Kopf mit Zurück-Button */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {inCompanyView && selectedCompany ? (
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedCompanyId(null)}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
            >
              <ArrowLeft className="size-3.5" />
              Unternehmen
            </button>
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={
                  selectedCompany.hasCompany
                    ? 'grid size-9 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/[0.06] text-xs font-bold text-primary ring-1 ring-inset ring-white/10'
                    : 'grid size-9 flex-shrink-0 place-items-center rounded-xl bg-white/[0.05] text-muted-foreground ring-1 ring-inset ring-white/10'
                }
              >
                {selectedCompany.hasCompany ? (
                  companyMonogram(selectedCompany.name)
                ) : (
                  <Building2 className="size-4" />
                )}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold leading-tight text-white sm:text-lg">
                  {selectedCompany.name}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {selectedCompany.total} {selectedCompany.total === 1 ? 'Nutzer' : 'Nutzer'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="grid size-10 flex-shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight text-white sm:text-lg">
                Unternehmen
              </h2>
              <p className="text-xs text-muted-foreground">
                Unternehmen wählen, um Nutzer &amp; Berechtigungen zu verwalten
              </p>
            </div>
          </div>
        )}

        <div className="w-full sm:w-72 md:w-80">
          <AdminUserSearch
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            resultCount={inCompanyView ? companyUsers.length : companyGroups.length}
            totalCount={inCompanyView ? selectedCompany?.total ?? 0 : totalCompanies}
            placeholder={
              inCompanyView
                ? `In ${selectedCompany?.name ?? 'Unternehmen'} suchen…`
                : 'Unternehmen oder Nutzer suchen…'
            }
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

      {inCompanyView ? (
        <>
          {/* Mailagent-Modell pro Unternehmen (nur bei echter Firma mit UUID) */}
          {selectedCompanyId &&
            UUID_RE.test(selectedCompanyId) &&
            selectedCompany?.hasCompany && (
              <CompanyMailModelSetting
                companyId={selectedCompanyId}
                companyName={selectedCompany.name}
              />
            )}

          {/* Desktop Table (Nutzer der Firma) */}
          <div className="hidden md:block">
            <AdminUserTable
              users={companyUsers}
              searchTerm={searchTerm}
              totalCount={selectedCompany?.total ?? 0}
              isUpdateLoading={mutations.isUpdateLoading}
              onSelectUser={handleSelectUser}
              onToggleUpload={mutations.updateUploadPermission}
            />
          </div>

          {/* Mobile Card List */}
          <div className="block md:hidden">
            <AdminUserCardList
              users={companyUsers}
              searchTerm={searchTerm}
              totalCount={selectedCompany?.total ?? 0}
              onSelectUser={handleSelectUser}
            />
          </div>
        </>
      ) : (
        <>
          {/* Globale Übersicht */}
          <AdminStatsGrid stats={stats} userCount={users.length} />

          {/* Firmen-Galerie (Kacheln) */}
          <AdminCompanyGallery
            companies={companyGroups}
            searchTerm={searchTerm}
            onSelectCompany={setSelectedCompanyId}
          />
        </>
      )}

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
