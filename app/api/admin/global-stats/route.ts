import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    const [processLogsResult, knowledgeBasesResult, documentsResult, usersResult, superAdminsResult] = await Promise.all([
      supabase.from('process_logs').select('*', { count: 'exact', head: true }),
      supabase.from('knowledge_bases').select('*', { count: 'exact', head: true }),
      supabase.from('documents').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_super_admin', true)
    ]);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: uniqueActiveUsers } = await supabase
      .from('process_logs')
      .select('user_id')
      .gte('created_at', thirtyDaysAgo.toISOString());

    const activeUsersLast30Days = uniqueActiveUsers
      ? [...new Set(uniqueActiveUsers.map(row => row.user_id))].length
      : 0;

    return NextResponse.json({
      totalProcessLogs: processLogsResult.count || 0,
      totalKnowledgeBases: knowledgeBasesResult.count || 0,
      totalDocuments: documentsResult.count || 0,
      totalUsers: usersResult.count || 0,
      totalSuperAdmins: superAdminsResult.count || 0,
      activeUsersLast30Days,
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
