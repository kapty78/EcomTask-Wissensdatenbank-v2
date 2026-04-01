"use client"

import { Users, Shield, Database, Settings, FileText, Activity } from 'lucide-react';
import { GlobalStats } from './types';

interface AdminStatsGridProps {
  stats: GlobalStats | null;
  userCount: number;
}

const statCards = [
  { key: 'totalUsers', label: 'Gesamt Benutzer', icon: Users, fallbackKey: 'userCount' },
  { key: 'totalSuperAdmins', label: 'Super Admins', icon: Shield },
  { key: 'totalKnowledgeBases', label: 'Knowledge Bases', icon: Database },
  { key: 'totalProcessLogs', label: 'Process Logs', icon: Settings, format: true },
  { key: 'activeUsersLast30Days', label: 'Aktive Benutzer (30T)', icon: Activity },
  { key: 'totalDocuments', label: 'Dokumente', icon: FileText, format: true },
] as const;

export default function AdminStatsGrid({ stats, userCount }: AdminStatsGridProps) {
  const getValue = (card: typeof statCards[number]) => {
    if (!stats) {
      if (card.key === 'totalUsers') return userCount;
      return 0;
    }
    const val = (stats as any)[card.key] ?? 0;
    return card.format ? val.toLocaleString() : val;
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {statCards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            className="rounded-xl border border-white/10 bg-[#1e1e1e] p-4 transition-colors hover:border-white/20"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="rounded-lg bg-white/5 p-1.5">
                <Icon className="size-3.5 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground truncate">{card.label}</span>
            </div>
            <p className="text-2xl font-bold text-white">{getValue(card)}</p>
          </div>
        );
      })}
    </div>
  );
}
