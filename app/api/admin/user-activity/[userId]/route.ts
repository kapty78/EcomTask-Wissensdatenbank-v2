import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;
    const { userId } = params;

    const [processLogsResult, knowledgeBasesResult, emailAccountsResult] = await Promise.all([
      supabase.from('process_logs').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('knowledge_bases').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('user_email_accounts').select('*', { count: 'exact', head: true }).eq('user_id', userId)
    ]);

    const { data: avgData } = await supabase
      .from('process_logs')
      .select('processing_time')
      .eq('user_id', userId)
      .not('processing_time', 'is', null)
      .gt('processing_time', 0);

    let avgResponseTime = 0;
    if (avgData && avgData.length > 0) {
      const total = avgData.reduce((sum, log) => sum + (log.processing_time || 0), 0);
      avgResponseTime = total / avgData.length;
    }

    const { data: lastActivity } = await supabase
      .from('process_logs')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: lastEmailProcessed } = await supabase
      .from('process_logs')
      .select('created_at')
      .eq('user_id', userId)
      .not('customer_mail', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      totalProcessLogs: processLogsResult.count || 0,
      avgFirstResponseTime: avgResponseTime,
      lastActivityAt: lastActivity?.created_at || null,
      lastEmailProcessedAt: lastEmailProcessed?.created_at || null,
      additionalStats: {
        knowledgeBasesCount: knowledgeBasesResult.count || 0,
        emailAccountsCount: emailAccountsResult.count || 0,
        totalProcessLogs: processLogsResult.count || 0,
        documentsCount: 0
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
