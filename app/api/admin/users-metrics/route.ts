import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    const { data: metrics, error } = await supabase
      .from('user_metrics')
      .select(`*, profiles:profiles(full_name, email)`);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const totalUsers = metrics?.length || 0;
    const totalProcessLogs = metrics?.reduce((sum: number, m: any) => sum + (m.total_process_logs || 0), 0) || 0;
    const avgResponseTime = metrics && metrics.length > 0
      ? metrics.reduce((sum: number, m: any) => sum + (m.avg_first_response_time || 0), 0) / metrics.length
      : 0;

    return NextResponse.json({
      users: metrics || [],
      summary: { totalUsers, totalProcessLogs, averageResponseTime: avgResponseTime }
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
