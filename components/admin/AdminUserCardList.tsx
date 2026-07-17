"use client"

import { Shield, ChevronRight, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { UserPermission } from './types';

interface AdminUserCardListProps {
  users: UserPermission[];
  searchTerm: string;
  totalCount: number;
  onSelectUser: (user: UserPermission) => void;
}

export default function AdminUserCardList({
  users,
  searchTerm,
  totalCount,
  onSelectUser,
}: AdminUserCardListProps) {
  if (users.length === 0 && searchTerm) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-[#1d1d1d] p-8 text-center">
        <div className="mx-auto mb-2.5 grid size-10 place-items-center rounded-xl bg-white/[0.04]">
          <Search className="size-5 text-muted-foreground opacity-70" />
        </div>
        <p className="text-sm text-muted-foreground">
          Keine Benutzer für &quot;{searchTerm}&quot; gefunden.
        </p>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-[#1d1d1d] p-8 text-center">
        <div className="mx-auto mb-2.5 grid size-10 place-items-center rounded-xl bg-white/[0.04]">
          <Users className="size-5 text-muted-foreground opacity-70" />
        </div>
        <p className="text-sm text-muted-foreground">Keine Benutzer gefunden.</p>
      </div>
    );
  }

  const getActiveSolutions = (user: UserPermission) => {
    const flags = user.solution_flags;
    if (!flags) return [];
    const solutions: string[] = [];
    if (flags.chatbot) solutions.push('Chatbot');
    if (flags.phone) solutions.push('Phone');
    if (flags.mail) solutions.push('Mail');
    if (flags.assistant) solutions.push('Assistant');
    if (flags.follow_up) solutions.push('Follow-up');
    return solutions;
  };

  return (
    <div className="space-y-2">
      {users.map((user) => {
        const initial =
          user.full_name?.charAt(0)?.toUpperCase() ||
          user.email?.charAt(0)?.toUpperCase() ||
          'U';
        const activeSolutions = getActiveSolutions(user);

        return (
          <button
            key={user.user_id}
            onClick={() => onSelectUser(user)}
            className="w-full rounded-2xl border border-white/[0.07] bg-[#1d1d1d] p-3 text-left transition-all hover:border-primary/20 active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/[0.06] text-sm font-semibold text-primary ring-1 ring-inset ring-white/10">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-white">
                    {user.full_name || 'Unbekannt'}
                  </p>
                  {user.is_super_admin && (
                    <Shield className="size-3 flex-shrink-0 text-primary" />
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                {user.company_name && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                    {user.company_name}
                  </p>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {user.can_upload ? (
                  <Badge
                    variant="outline"
                    className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                  >
                    Aktiv
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-white/10 text-[10px] text-muted-foreground"
                  >
                    Wartend
                  </Badge>
                )}
                <ChevronRight className="size-4 text-muted-foreground/50" />
              </div>
            </div>
            {activeSolutions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 pl-[52px]">
                {activeSolutions.map((label) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="border-white/10 bg-white/[0.03] text-[10px] text-muted-foreground"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
