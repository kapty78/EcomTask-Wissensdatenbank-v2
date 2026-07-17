"use client"

import { Users, Shield, Building2, ChevronRight, Search } from 'lucide-react';
import { UserPermission } from './types';

export interface CompanyGroup {
  /** company_id, `name:<name>` oder `__none__` — stabiler Gruppenschlüssel */
  id: string;
  name: string;
  users: UserPermission[];
  activeCount: number;
  adminCount: number;
  solutions: string[];
  hasCompany: boolean;
}

/** Initialen einer Firma (max. 2 Wörter) für das Kachel-Monogramm. */
export function companyMonogram(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase();
  return initials || '—';
}

interface AdminCompanyGalleryProps {
  companies: CompanyGroup[];
  searchTerm: string;
  onSelectCompany: (id: string) => void;
}

export default function AdminCompanyGallery({
  companies,
  searchTerm,
  onSelectCompany,
}: AdminCompanyGalleryProps) {
  if (companies.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-[#1d1d1d] p-12 text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-white/[0.04]">
          {searchTerm ? (
            <Search className="size-6 text-muted-foreground opacity-70" />
          ) : (
            <Building2 className="size-6 text-muted-foreground opacity-70" />
          )}
        </div>
        <h3 className="mb-1 text-sm font-medium text-white">
          {searchTerm ? 'Keine Unternehmen gefunden' : 'Keine Unternehmen'}
        </h3>
        <p className="text-xs text-muted-foreground">
          {searchTerm
            ? `Keine Unternehmen entsprechen der Suche nach "${searchTerm}".`
            : 'Es wurden noch keine Unternehmen angelegt.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {companies.map((company) => (
        <button
          key={company.id}
          type="button"
          onClick={() => onSelectCompany(company.id)}
          className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#1d1d1d] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-primary/[0.02]"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          <div className="flex items-start gap-3">
            <span
              className={
                company.hasCompany
                  ? 'grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/[0.06] text-sm font-bold text-primary ring-1 ring-inset ring-white/10'
                  : 'grid size-11 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-muted-foreground ring-1 ring-inset ring-white/10'
              }
            >
              {company.hasCompany ? companyMonogram(company.name) : <Building2 className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{company.name}</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="size-3" />
                {company.users.length} {company.users.length === 1 ? 'Nutzer' : 'Nutzer'}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
          </div>

          <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-primary" />
              {company.activeCount} aktiv
            </span>
            {company.adminCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Shield className="size-3 text-primary" />
                {company.adminCount} Admin
              </span>
            )}
          </div>

          {company.solutions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {company.solutions.map((label) => (
                <span
                  key={label}
                  className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
