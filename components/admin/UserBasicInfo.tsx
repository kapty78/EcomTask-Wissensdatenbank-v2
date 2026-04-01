"use client"

import { Shield } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { UserPermission } from './types';

interface UserBasicInfoProps {
  user: UserPermission;
  isUpdateLoading: string | null;
  onToggleUpload: (userId: string, canUpload: boolean) => void;
}

export default function UserBasicInfo({ user, isUpdateLoading, onToggleUpload }: UserBasicInfoProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Grunddaten</h4>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Unternehmen</span>
          <span className="text-sm text-white">{user.company_name || '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Upload-Berechtigung</span>
          <div className="flex items-center gap-2">
            {!user.is_super_admin ? (
              <>
                <span className="text-xs text-muted-foreground">
                  {user.can_upload ? 'Aktiv' : 'Gesperrt'}
                </span>
                <Switch
                  checked={user.can_upload}
                  onCheckedChange={(checked) => onToggleUpload(user.user_id, checked)}
                  disabled={isUpdateLoading === user.user_id}
                />
              </>
            ) : (
              <Badge variant="outline" className="border-primary/30 text-primary">
                <Shield className="size-3 mr-1" />
                Super Admin
              </Badge>
            )}
          </div>
        </div>
        {user.is_super_admin && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Super Admin</span>
            <Badge variant="outline" className="border-primary/30 text-primary text-xs">Ja</Badge>
          </div>
        )}
      </div>
    </div>
  );
}
