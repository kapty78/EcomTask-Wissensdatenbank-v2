"use client"

import { useState, useEffect } from 'react';
import { Bot, Sparkles, Phone, Mail, MessageSquare, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPermission, CompanyOption, SolutionFlagKey, SOLUTION_FLAG_CONFIG } from './types';

const ICONS: Record<SolutionFlagKey, React.ComponentType<{ className?: string }>> = {
  chatbot: Bot,
  assistant: Sparkles,
  phone: Phone,
  mail: Mail,
  follow_up: MessageSquare,
};

interface UserSolutionFlagsProps {
  user: UserPermission;
  companies: CompanyOption[];
  companiesLoading: boolean;
  solutionFlagLoading: string | null;
  solutionCompanyLoading: string | null;
  onToggleFlag: (userId: string, flag: SolutionFlagKey, value: boolean, companyId?: string | null) => Promise<void>;
  onChangeCompany: (userId: string, companyId: string | null) => Promise<void>;
}

export default function UserSolutionFlags({
  user,
  companies,
  companiesLoading,
  solutionFlagLoading,
  solutionCompanyLoading,
  onToggleFlag,
  onChangeCompany,
}: UserSolutionFlagsProps) {
  const [selectedCompany, setSelectedCompany] = useState<string>('none');

  useEffect(() => {
    const initial = user.solution_flags?.company_id ?? user.company_id ?? null;
    setSelectedCompany(initial ?? 'none');
  }, [user.user_id, user.solution_flags?.company_id, user.company_id]);

  const handleCompanyChange = async (value: string) => {
    const companyId = value === 'none' ? null : value;
    setSelectedCompany(value);
    await onChangeCompany(user.user_id, companyId);
  };

  return (
    <div className="space-y-4">
      {/* Company Assignment */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Unternehmen-Zuordnung</h4>
        <Select
          value={selectedCompany}
          onValueChange={handleCompanyChange}
          disabled={companiesLoading || solutionCompanyLoading === user.user_id}
        >
          <SelectTrigger className="w-full border-white/10 bg-white/5 text-white focus:ring-1 focus:ring-primary/30">
            <SelectValue placeholder="Unternehmen auswählen" />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-[#1e1e1e]">
            <SelectItem value="none">Kein Unternehmen</SelectItem>
            {companies.map((company) => (
              <SelectItem key={company.id} value={company.id}>
                {company.name || company.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {solutionCompanyLoading === user.user_id && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            Speichere...
          </p>
        )}
      </div>

      {/* Solution Toggles */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Lösungen</h4>
        <div className="space-y-2">
          {SOLUTION_FLAG_CONFIG.map(({ key, label, description }) => {
            const Icon = ICONS[key];
            const loadingKey = `${user.user_id}:${key}`;
            const isLoading = solutionFlagLoading === loadingKey;
            const isEnabled = user.solution_flags?.[key] ?? false;
            const targetCompanyId = user.solution_flags?.company_id ?? user.company_id ?? null;

            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-white/5 p-1.5">
                    <Icon className="size-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => onToggleFlag(user.user_id, key, checked, targetCompanyId)}
                    disabled={isLoading}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
