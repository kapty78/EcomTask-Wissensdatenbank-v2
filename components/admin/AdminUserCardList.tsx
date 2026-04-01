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
      <div className="rounded-xl border border-dashed border-white/10 bg-[#1e1e1e] p-6 text-center">
        <Search className="mx-auto mb-2 size-8 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">
          Keine Benutzer für &quot;{searchTerm}&quot; gefunden.
        </p>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-[#1e1e1e] p-6 text-center">
        <Users className="mx-auto mb-2 size-8 text-muted-foreground opacity-50" />
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
        const initial = user.full_name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || 'U';
        const activeSolutions = getActiveSolutions(user);

        return (
          <button
            key={user.user_id}
            onClick={() => onSelectUser(user)}
            className="w-full rounded-xl border border-white/10 bg-[#1e1e1e] p-3 text-left transition-colors hover:border-white/20 active:bg-white/5"
          >
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-white/10 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                {initial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">
                    {user.full_name || 'Unbekannt'}
                  </p>
                  {user.is_super_admin && <Shield className="size-3 text-primary flex-shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                {user.company_name && (
                  <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{user.company_name}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {user.can_upload ? (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px]">
                    Aktiv
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-white/10 text-muted-foreground text-[10px]">
                    Wartend
                  </Badge>
                )}
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            </div>
            {activeSolutions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 pl-[52px]">
                {activeSolutions.map((label) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="border-primary/30 text-primary bg-primary/10 text-[10px]"
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
