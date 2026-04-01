import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin-auth';

export async function POST(
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
      .select('executive_report_enabled, executive_report_email, full_name, email')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!profile.executive_report_enabled) {
      return NextResponse.json({ error: 'Executive report not enabled for this user' }, { status: 400 });
    }

    const { data: metrics } = await supabase
      .from('user_metrics')
      .select('*')
      .eq('user_id', userId)
      .single();

    const reportData = {
      user: profile,
      metrics: metrics || {},
      generatedAt: new Date().toISOString(),
      period: 'current_month'
    };

    return NextResponse.json({
      success: true,
      message: 'Executive report triggered successfully',
      reportData
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
