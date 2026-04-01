import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if ('error' in auth) return auth.error;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from('companies')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ companies: [] }, { status: 200 });
      }
      return NextResponse.json({ error: 'Failed to load companies' }, { status: 500 });
    }

    return NextResponse.json({ companies: data ?? [] }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
