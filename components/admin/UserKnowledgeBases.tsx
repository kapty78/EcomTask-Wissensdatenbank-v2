"use client"

import { useState } from 'react';
import { Copy, Check, Database } from 'lucide-react';
import { UserPermission } from './types';

interface UserKnowledgeBasesProps {
  user: UserPermission;
}

export default function UserKnowledgeBases({ user }: UserKnowledgeBasesProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (user.knowledge_bases.length === 0) return null;

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Knowledge Bases ({user.knowledge_bases.length})
      </h4>
      <div className="space-y-1.5">
        {user.knowledge_bases.map((kb) => (
          <div
            key={kb.id}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Database className="size-3.5 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{kb.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">{kb.id}</p>
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(kb.id)}
              className="p-1.5 text-muted-foreground hover:text-white transition-colors flex-shrink-0"
              title="ID kopieren"
            >
              {copiedId === kb.id ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
