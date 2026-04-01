import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const { userId } = params;
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('user_solution_flags')
      .select('id, user_id, company_id, phone, chatbot, assistant, mail, follow_up')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch solution flags' }, { status: 500 });
    }

    return NextResponse.json(
      data ?? {
        id: null, user_id: userId, company_id: null,
        phone: false, chatbot: false, assistant: false, mail: false, follow_up: false,
      }
    );
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const { userId } = params;
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    const body = await request.json().catch(() => ({}));
    const { phone, chatbot, assistant, mail, follow_up, companyId } = body ?? {};

    const updates: Record<string, any> = {};
    (['phone', 'chatbot', 'assistant', 'mail', 'follow_up'] as const).forEach((key) => {
      const val = body[key];
      if (typeof val === 'boolean') updates[key] = val;
    });

    if (companyId !== undefined) {
      if (companyId !== null) {
        const { data: companyExists, error: companyError } = await supabase
          .from('companies')
          .select('id')
          .eq('id', companyId)
          .maybeSingle();

        if (companyError || !companyExists) {
          return NextResponse.json({ error: `Invalid company_id: ${companyId} does not exist` }, { status: 400 });
        }
      }
      updates.company_id = companyId;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase
      .from('user_solution_flags')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: `Failed to load existing solution flags: ${existingError.message}` }, { status: 500 });
    }

    if (existing?.id) {
      const { data, error } = await supabase
        .from('user_solution_flags')
        .update(updates)
        .eq('id', existing.id)
        .select('id, user_id, company_id, phone, chatbot, assistant, mail, follow_up')
        .single();

      if (error) {
        return NextResponse.json({ error: `Failed to update solution flags: ${error.message}` }, { status: 500 });
      }
      return NextResponse.json(data);
    }

    const { data, error } = await supabase
      .from('user_solution_flags')
      .insert([{ user_id: userId, ...updates }])
      .select('id, user_id, company_id, phone, chatbot, assistant, mail, follow_up')
      .single();

    if (error) {
      return NextResponse.json({ error: `Failed to insert solution flags: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
