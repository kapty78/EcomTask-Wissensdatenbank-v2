"use client"

import { Users, Shield, Database, Settings, FileText, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlobalStats } from './types';

interface AdminStatsGridProps {
  stats: GlobalStats | null;
  userCount: number;
}

const statCards = [
  { key: 'totalUsers', label: 'Gesamt Benutzer', icon: Users, fallbackKey: 'userCount', accent: true },
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
    const shouldFormat = 'format' in card && card.format;
    return shouldFormat ? val.toLocaleString('de-DE') : val;
  };

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 sm:gap-3 lg:grid-cols-6">
      {statCards.map((card) => {
        const Icon = card.icon;
        const isAccent = 'accent' in card && card.accent;
        return (
          <div
            key={card.key}
            className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#1d1d1d] p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/20 sm:p-4"
          >
            {/* obere Lichtkante — flache Boxen bekommen so Tiefe */}
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            {isAccent && (
              <span className="pointer-events-none absolute -right-6 -top-6 size-16 rounded-full bg-primary/20 blur-2xl" />
            )}
            <div className="relative mb-2.5 flex items-center gap-2">
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-lg transition-colors',
                  isAccent
                    ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                    : 'bg-white/5 text-muted-foreground group-hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="truncate text-[11px] font-medium text-muted-foreground">{card.label}</span>
            </div>
            <p className="relative text-2xl font-semibold tracking-tight text-white tabular-nums">
              {getValue(card)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
