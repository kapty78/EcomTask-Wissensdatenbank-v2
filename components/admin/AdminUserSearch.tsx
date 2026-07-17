"use client"

import { Search } from 'lucide-react';

interface AdminUserSearchProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
}

export default function AdminUserSearch({
  searchTerm,
  onSearchChange,
  resultCount,
  totalCount,
}: AdminUserSearchProps) {
  return (
    <div className="group relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
      <input
        type="text"
        placeholder="Benutzer suchen (Name, Email, Unternehmen)…"
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full rounded-xl border border-white/[0.08] bg-[#1d1d1d] py-2.5 pl-10 pr-20 text-sm text-white outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
      />
      {searchTerm && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
          {resultCount}/{totalCount}
        </span>
      )}
    </div>
  );
}
