"use client"

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { UserActivity } from './types';

interface UserActivityMetricsProps {
  userId: string;
}

export default function UserActivityMetrics({ userId }: UserActivityMetricsProps) {
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`/api/admin/user-activity/${userId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (response.ok) {
        setActivity(await response.json());
      }
    } catch {
      setActivity(null);
    } finally {
      setLoading(false);
    }
  }, [userId, supabase]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  if (loading) {
    return (
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Aktivität</h4>
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 animate-pulse">
              <div className="h-6 w-12 bg-white/10 rounded mb-1.5" />
              <div className="h-3 w-16 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Aktivität</h4>
        <p className="text-xs text-muted-foreground">Keine Aktivitätsdaten verfügbar.</p>
      </div>
    );
  }

  const metrics = [
    { label: 'Process Logs', value: activity.totalProcessLogs },
    { label: 'Knowledge Bases', value: activity.additionalStats.knowledgeBasesCount },
    { label: 'Email Accounts', value: activity.additionalStats.emailAccountsCount },
    {
      label: 'Avg Response',
      value: activity.avgFirstResponseTime
        ? `${activity.avgFirstResponseTime.toFixed(1)}s`
        : 'N/A',
    },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Aktivität</h4>
      <div className="grid grid-cols-2 gap-2">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-center"
          >
            <p className="text-lg font-bold text-white">{metric.value}</p>
            <p className="text-[10px] text-muted-foreground">{metric.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
