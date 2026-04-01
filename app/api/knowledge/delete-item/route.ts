import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function DELETE(request: NextRequest) {
  try {
    // Auth check
    const cookieStore = cookies();
    const authClient = createRouteHandlerClient({ cookies: () => cookieStore });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await request.json();

    if (!itemId) {
      return NextResponse.json(
        { error: 'Item ID is required' },
        { status: 400 }
      );
    }

    // Create Supabase client with service role key for admin operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Delete the knowledge item
    const { error: deleteError } = await supabase
      .from('knowledge_items')
      .delete()
      .eq('id', itemId);

    if (deleteError) {
      console.error('Error deleting knowledge item:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete knowledge item' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Knowledge item deleted successfully' },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('Error in delete knowledge item API:', error);
    return NextResponse.json(
      { error: `Failed to delete knowledge item: ${error.message}` },
      { status: 500 }
    );
  }
} 