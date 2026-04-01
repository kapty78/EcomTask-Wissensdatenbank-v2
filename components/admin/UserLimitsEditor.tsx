"use client"

import { useState } from 'react';
import { Edit2, Save, X } from 'lucide-react';
import { UserPermission } from './types';

interface UserLimitsEditorProps {
  user: UserPermission;
  isUpdateLoading: string | null;
  onUpdateEmailLimit: (userId: string, limit: number) => Promise<void>;
  onUpdateKBLimit: (userId: string, limit: number) => Promise<void>;
  onUpdateEmailAccountLimit: (userId: string, limit: number) => Promise<void>;
}

interface EditableLimitProps {
  label: string;
  value: number;
  defaultValue: number;
  max: number;
  userId: string;
  isLoading: boolean;
  onSave: (userId: string, value: number) => Promise<void>;
}

function EditableLimit({ label, value, defaultValue, max, userId, isLoading, onSave }: EditableLimitProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || defaultValue);

  const handleSave = async () => {
    await onSave(userId, editValue);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(parseInt(e.target.value) || 0)}
            className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-center text-sm text-white focus:border-white/20 focus:outline-none"
            min="0"
            max={max}
            autoFocus
          />
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="p-1 text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={isLoading}
            className="p-1 text-muted-foreground hover:text-white disabled:opacity-50 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-white font-medium">
          {(value || defaultValue).toLocaleString()}
        </span>
        <button
          onClick={() => {
            setEditValue(value || defaultValue);
            setEditing(true);
          }}
          className="p-1 text-muted-foreground hover:text-white transition-colors"
        >
          <Edit2 size={12} />
        </button>
      </div>
    </div>
  );
}

export default function UserLimitsEditor({
  user,
  isUpdateLoading,
  onUpdateEmailLimit,
  onUpdateKBLimit,
  onUpdateEmailAccountLimit,
}: UserLimitsEditorProps) {
  const isLoading = isUpdateLoading === user.user_id;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Limits</h4>
      <div className="space-y-3">
        <EditableLimit
          label="Email-Limit"
          value={user.email_limit}
          defaultValue={2000}
          max={999999}
          userId={user.user_id}
          isLoading={isLoading}
          onSave={onUpdateEmailLimit}
        />
        <EditableLimit
          label="KB-Limit"
          value={user.knowledge_base_limit}
          defaultValue={5}
          max={1000}
          userId={user.user_id}
          isLoading={isLoading}
          onSave={onUpdateKBLimit}
        />
        <EditableLimit
          label="Email-Account-Limit"
          value={user.email_account_limit}
          defaultValue={3}
          max={100}
          userId={user.user_id}
          isLoading={isLoading}
          onSave={onUpdateEmailAccountLimit}
        />
      </div>
    </div>
  );
}
