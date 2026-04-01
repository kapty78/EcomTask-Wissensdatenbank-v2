"use client"

import { X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { UserPermission, CompanyOption, SolutionFlagKey } from './types';
import UserBasicInfo from './UserBasicInfo';
import UserLimitsEditor from './UserLimitsEditor';
import UserSolutionFlags from './UserSolutionFlags';
import UserKnowledgeBases from './UserKnowledgeBases';
import UserActivityMetrics from './UserActivityMetrics';

interface AdminUserDetailSheetProps {
  user: UserPermission | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: CompanyOption[];
  companiesLoading: boolean;
  isUpdateLoading: string | null;
  solutionFlagLoading: string | null;
  solutionCompanyLoading: string | null;
  onToggleUpload: (userId: string, canUpload: boolean) => void;
  onUpdateEmailLimit: (userId: string, limit: number) => Promise<void>;
  onUpdateKBLimit: (userId: string, limit: number) => Promise<void>;
  onUpdateEmailAccountLimit: (userId: string, limit: number) => Promise<void>;
  onToggleFlag: (userId: string, flag: SolutionFlagKey, value: boolean, companyId?: string | null) => Promise<void>;
  onChangeCompany: (userId: string, companyId: string | null) => Promise<void>;
}

export default function AdminUserDetailSheet({
  user,
  open,
  onOpenChange,
  companies,
  companiesLoading,
  isUpdateLoading,
  solutionFlagLoading,
  solutionCompanyLoading,
  onToggleUpload,
  onUpdateEmailLimit,
  onUpdateKBLimit,
  onUpdateEmailAccountLimit,
  onToggleFlag,
  onChangeCompany,
}: AdminUserDetailSheetProps) {
  if (!user) return null;

  const initial = user.full_name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || 'U';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg bg-[#1a1a1a] border-white/10 p-0 flex flex-col"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex-shrink-0">
          <SheetHeader className="flex-row items-center gap-3 space-y-0">
            <div className="size-11 rounded-full bg-white/10 flex items-center justify-center text-white text-lg font-semibold flex-shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-white text-left truncate">
                {user.full_name || 'Unbekannt'}
              </SheetTitle>
              <SheetDescription className="text-left truncate">
                {user.email}
              </SheetDescription>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <X size={18} />
            </button>
          </SheetHeader>
        </div>

        <Separator className="bg-white/10" />

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <UserBasicInfo
            user={user}
            isUpdateLoading={isUpdateLoading}
            onToggleUpload={onToggleUpload}
          />

          <Separator className="bg-white/10" />

          <UserLimitsEditor
            user={user}
            isUpdateLoading={isUpdateLoading}
            onUpdateEmailLimit={onUpdateEmailLimit}
            onUpdateKBLimit={onUpdateKBLimit}
            onUpdateEmailAccountLimit={onUpdateEmailAccountLimit}
          />

          <Separator className="bg-white/10" />

          <UserSolutionFlags
            user={user}
            companies={companies}
            companiesLoading={companiesLoading}
            solutionFlagLoading={solutionFlagLoading}
            solutionCompanyLoading={solutionCompanyLoading}
            onToggleFlag={onToggleFlag}
            onChangeCompany={onChangeCompany}
          />

          {user.knowledge_bases.length > 0 && (
            <>
              <Separator className="bg-white/10" />
              <UserKnowledgeBases user={user} />
            </>
          )}

          <Separator className="bg-white/10" />

          <UserActivityMetrics userId={user.user_id} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
