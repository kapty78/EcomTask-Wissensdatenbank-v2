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
    <div className="relative">
      <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        placeholder="Benutzer suchen (Name, Email, Unternehmen)..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-[#1e1e1e] pl-10 pr-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
      />
      {searchTerm && (
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {resultCount} von {totalCount}
        </span>
      )}
    </div>
  );
}
