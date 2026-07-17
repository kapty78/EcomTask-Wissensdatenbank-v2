"use client"

import { Shield, Search, Users, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { UserPermission } from './types';

interface AdminUserTableProps {
  users: UserPermission[];
  searchTerm: string;
  totalCount: number;
  isUpdateLoading: string | null;
  onSelectUser: (user: UserPermission) => void;
  onToggleUpload: (userId: string, canUpload: boolean) => void;
}

const TH =
  'px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70';

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
      <div className="rounded-2xl border border-dashed border-white/10 bg-[#1d1d1d] p-10 text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-white/[0.04]">
          <Search className="size-6 text-muted-foreground opacity-70" />
        </div>
        <h3 className="mb-1 text-sm font-medium text-white">Keine Benutzer gefunden</h3>
        <p className="text-xs text-muted-foreground">
          Keine Benutzer entsprechen der Suche nach &quot;{searchTerm}&quot;.
        </p>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-[#1d1d1d] p-10 text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-white/[0.04]">
          <Users className="size-6 text-muted-foreground opacity-70" />
        </div>
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
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#1d1d1d] shadow-[0_8px_28px_-20px_rgba(0,0,0,0.8)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0">
          <thead>
            <tr className="bg-white/[0.02]">
              <th className={`${TH} text-left`}>Benutzer</th>
              <th className={`${TH} hidden text-left md:table-cell`}>Unternehmen</th>
              <th className={`${TH} text-center`}>Status</th>
              <th className={`${TH} hidden text-center lg:table-cell`}>Limits</th>
              <th className={`${TH} hidden text-center xl:table-cell`}>Lösungen</th>
              <th className={`${TH} text-right`}>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const activeSolutions = getActiveSolutions(user);
              const initial =
                user.full_name?.charAt(0)?.toUpperCase() ||
                user.email?.charAt(0)?.toUpperCase() ||
                'U';

              return (
                <tr
                  key={user.user_id}
                  className="group cursor-pointer border-t border-white/[0.05] transition-colors hover:bg-primary/[0.04]"
                  onClick={() => onSelectUser(user)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/[0.06] text-sm font-semibold text-primary ring-1 ring-inset ring-white/10">
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {user.full_name || 'Unbekannt'}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {user.company_name || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {user.can_upload ? (
                        <Badge
                          variant="outline"
                          className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                        >
                          <span className="mr-1 inline-block size-1.5 rounded-full bg-primary" />
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
                      {user.is_super_admin && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                          <Shield className="size-3" />
                          Admin
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-center lg:table-cell">
                    <div className="space-y-0.5 text-xs text-muted-foreground tabular-nums">
                      <div>
                        <span className="text-white/80">
                          {user.email_limit?.toLocaleString('de-DE') || '2.000'}
                        </span>{' '}
                        Mails
                      </div>
                      <div>
                        <span className="text-white/80">{user.knowledge_base_limit || 5}</span> KBs
                      </div>
                    </div>
                  </td>
                  <td
                    className="hidden px-4 py-3 text-center xl:table-cell"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {activeSolutions.length > 0 ? (
                      <div className="flex flex-wrap justify-center gap-1">
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
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {!user.is_super_admin && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleUpload(user.user_id, !user.can_upload);
                          }}
                          disabled={isUpdateLoading === user.user_id}
                          className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                        >
                          {isUpdateLoading === user.user_id
                            ? '…'
                            : user.can_upload
                            ? 'Sperren'
                            : 'Freischalten'}
                        </button>
                      )}
                      <ChevronRight className="size-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
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
