"use client"

import { Shield, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserPermission, SolutionFlagKey } from './types';

interface AdminUserTableProps {
  users: UserPermission[];
  searchTerm: string;
  totalCount: number;
  isUpdateLoading: string | null;
  onSelectUser: (user: UserPermission) => void;
  onToggleUpload: (userId: string, canUpload: boolean) => void;
}

export default function AdminUserTable({
  users,
  searchTerm,
  totalCount,
  isUpdateLoading,
  onSelectUser,
  onToggleUpload,
}: AdminUserTableProps) {
  if (users.length === 0 && searchTerm) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-[#1e1e1e] p-8 text-center">
        <Search className="mx-auto mb-3 size-10 text-muted-foreground opacity-50" />
        <h3 className="mb-1 text-sm font-medium text-white">Keine Benutzer gefunden</h3>
        <p className="text-xs text-muted-foreground">
          Keine Benutzer entsprechen Ihrer Suche nach &quot;{searchTerm}&quot;.
        </p>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-[#1e1e1e] p-8 text-center">
        <Users className="mx-auto mb-3 size-10 text-muted-foreground opacity-50" />
        <h3 className="mb-1 text-sm font-medium text-white">Keine Benutzer</h3>
        <p className="text-xs text-muted-foreground">Es wurden keine Benutzer gefunden.</p>
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
    <div className="rounded-xl border border-white/10 bg-[#1e1e1e] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Benutzer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                Unternehmen
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                Limits
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider hidden xl:table-cell">
                Lösungen
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Aktionen
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map((user) => {
              const activeSolutions = getActiveSolutions(user);
              const initial = user.full_name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || 'U';

              return (
                <tr
                  key={user.user_id}
                  className="hover:bg-white/[0.03] transition-colors cursor-pointer"
                  onClick={() => onSelectUser(user)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-full bg-white/10 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {user.full_name || 'Unbekannt'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {user.company_name || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {user.can_upload ? (
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px]">
                          Aktiv
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-white/10 text-muted-foreground text-[10px]">
                          Wartend
                        </Badge>
                      )}
                      {user.is_super_admin && (
                        <div className="flex items-center gap-1">
                          <Shield className="size-3 text-primary" />
                          <span className="text-[10px] text-primary">Admin</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center hidden lg:table-cell">
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>{user.email_limit?.toLocaleString() || '2,000'} Mails</div>
                      <div>{user.knowledge_base_limit || 5} KBs</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center hidden xl:table-cell" onClick={(e) => e.stopPropagation()}>
                    {activeSolutions.length > 0 ? (
                      <div className="flex flex-wrap justify-center gap-1">
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
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      {!user.is_super_admin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onToggleUpload(user.user_id, !user.can_upload)}
                          disabled={isUpdateLoading === user.user_id}
                          className="text-xs h-7 px-2"
                        >
                          {isUpdateLoading === user.user_id
                            ? '...'
                            : user.can_upload
                            ? 'Sperren'
                            : 'Freischalten'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
