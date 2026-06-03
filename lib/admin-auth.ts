import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export type AdminAuthResult =
  | { userId: string; supabase: SupabaseClient }
  | { error: NextResponse };

export function createServiceClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function requireSuperAdmin(
  request: NextRequest
): Promise<AdminAuthResult> {
  const supabase = createServiceClient();

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return {
      error: NextResponse.json(
        { error: 'No authorization header' },
        { status: 401 }
      ),
    };
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.is_super_admin) {
    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { userId: user.id, supabase };
}
