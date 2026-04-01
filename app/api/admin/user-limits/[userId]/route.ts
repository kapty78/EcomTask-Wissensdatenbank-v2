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

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('knowledge_base_limit, email_account_limit, executive_report_enabled, executive_report_frequency, executive_report_email')
      .eq('id', userId)
      .single();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const [knowledgeBasesResult, emailAccountsResult] = await Promise.all([
      supabase.from('knowledge_bases').select('id', { count: 'exact' }).eq('user_id', userId),
      supabase.from('user_email_accounts').select('id', { count: 'exact' }).eq('user_id', userId)
    ]);

    return NextResponse.json({
      ...profile,
      currentCounts: {
        knowledgeBases: knowledgeBasesResult.count || 0,
        emailAccounts: emailAccountsResult.count || 0
      }
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;
    const { userId } = params;
    const body = await request.json();

    const updateData: any = {};
    if (body.knowledgeBaseLimit !== undefined) updateData.knowledge_base_limit = body.knowledgeBaseLimit;
    if (body.emailAccountLimit !== undefined) updateData.email_account_limit = body.emailAccountLimit;
    if (body.executiveReportEnabled !== undefined) updateData.executive_report_enabled = body.executiveReportEnabled;
    if (body.executiveReportFrequency !== undefined) updateData.executive_report_frequency = body.executiveReportFrequency;
    if (body.executiveReportEmail !== undefined) updateData.executive_report_email = body.executiveReportEmail;

    const { error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
