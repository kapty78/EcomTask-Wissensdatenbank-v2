import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase, userId: adminUserId } = auth;

    const { data: users, error: usersError } = await supabase
      .rpc('get_all_users_with_permissions', { admin_user_id: adminUserId });

    if (usersError) {
      return NextResponse.json(
        { error: 'Failed to fetch users', details: usersError.message, code: usersError.code },
        { status: 500 }
      );
    }

    if (!users) {
      return NextResponse.json(
        { error: 'No users returned from database function', details: 'RPC function returned null/undefined' },
        { status: 500 }
      );
    }

    const userIds = Array.isArray(users)
      ? (users as any[]).map((usr) => usr.user_id).filter(Boolean)
      : [];

    let solutionFlagsMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: solutionFlagsData, error: solutionFlagsError } = await supabase
        .from('user_solution_flags')
        .select('id, user_id, company_id, phone, chatbot, assistant, mail, follow_up')
        .in('user_id', userIds);

      if (!solutionFlagsError && solutionFlagsData) {
        solutionFlagsMap = new Map(
          solutionFlagsData.map((entry) => [entry.user_id, entry])
        );
      }
    }

    const enhancedUsers = await Promise.all(
      (users as any[]).map(async (user) => {
        if (!user.company_name) {
          let fixedCompanyName = null;

          if (user.company_id) {
            try {
              const { data: companyData, error: companyError } = await supabase
                .from('companies').select('name').eq('id', user.company_id).single();
              if (!companyError && companyData) fixedCompanyName = companyData.name;
            } catch {}
          }

          if (!fixedCompanyName) {
            try {
              const { data: adminData, error: adminError } = await supabase
                .from('company_admins').select('companies(name)').eq('user_id', user.user_id).single();
              if (!adminError && adminData?.companies) fixedCompanyName = (adminData.companies as any).name;
            } catch {}
          }

          if (fixedCompanyName) {
            try {
              await supabase.from('profiles').update({ company_name: fixedCompanyName, updated_at: new Date().toISOString() }).eq('id', user.user_id);
              user.company_name = fixedCompanyName;
            } catch {}
          }
        }

        const { data: profileData } = await supabase
          .from('profiles')
          .select('executive_report_enabled, executive_report_frequency, executive_report_email, company_id')
          .eq('id', user.user_id)
          .single();

        const { data: knowledgeBases } = await supabase
          .from('knowledge_bases').select('id, name').eq('user_id', user.user_id).order('name', { ascending: true });

        const { data: emailAccounts } = await supabase
          .from('user_email_accounts').select('id, email').eq('user_id', user.user_id).order('email', { ascending: true });

        const knowledgeBaseLimit = Math.max((knowledgeBases?.length || 0) + 2, 5);
        const emailAccountLimit = Math.max((emailAccounts?.length || 0) + 1, 3);

        const companyId = profileData?.company_id ?? null;
        const existingSolutionFlags = solutionFlagsMap.get(user.user_id);
        const solutionFlags = existingSolutionFlags
          ? { ...existingSolutionFlags, company_id: existingSolutionFlags.company_id ?? companyId }
          : { id: null, user_id: user.user_id, company_id: companyId, phone: false, chatbot: false, assistant: false, mail: false, follow_up: false };

        return {
          ...user,
          company_id: companyId,
          knowledge_bases: knowledgeBases || [],
          email_accounts: emailAccounts || [],
          knowledge_base_limit: knowledgeBaseLimit,
          email_account_limit: emailAccountLimit,
          executive_report_enabled: profileData?.executive_report_enabled || false,
          executive_report_frequency: profileData?.executive_report_frequency || 'monthly',
          executive_report_email: profileData?.executive_report_email || null,
          solution_flags: solutionFlags,
        };
      })
    );

    return NextResponse.json({ users: enhancedUsers }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to fetch users: ${error.message}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { targetUserId, canUpload } = await request.json();
    if (!targetUserId || typeof canUpload !== 'boolean') {
      return NextResponse.json({ error: 'Target user ID and canUpload boolean are required' }, { status: 400 });
    }

    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase, userId: adminUserId } = auth;

    const { data: result, error: permissionError } = await supabase
      .rpc('set_user_upload_permission', {
        admin_user_id: adminUserId,
        target_user_id: targetUserId,
        can_upload_new: canUpload
      });

    if (permissionError) {
      return NextResponse.json({ error: 'Failed to update permission' }, { status: 500 });
    }

    if (!result?.success) {
      return NextResponse.json({ error: result?.error || 'Permission update failed' }, { status: 403 });
    }

    return NextResponse.json({ message: 'Permission updated successfully' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to update permission: ${error.message}` }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { targetUserId, emailLimit } = await request.json();
    if (!targetUserId || typeof emailLimit !== 'number' || emailLimit < 0) {
      return NextResponse.json({ error: 'Target user ID and valid email limit (>= 0) are required' }, { status: 400 });
    }

    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase, userId: adminUserId } = auth;

    const { data: result, error: limitError } = await supabase
      .rpc('set_user_email_limit', {
        admin_user_id: adminUserId,
        target_user_id: targetUserId,
        email_limit_new: emailLimit
      });

    if (limitError) {
      return NextResponse.json({ error: 'Failed to update email limit' }, { status: 500 });
    }

    if (!result?.success) {
      return NextResponse.json({ error: result?.error || 'Email limit update failed' }, { status: 403 });
    }

    return NextResponse.json({ message: 'Email limit updated successfully' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: `Failed to update email limit: ${error.message}` }, { status: 500 });
  }
}
