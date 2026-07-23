import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRouteAuth } from '@/lib/route-auth';
import { enqueueGraphJob } from '@/lib/knowledge-base/graph-enqueue';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function DELETE(request: NextRequest) {
  try {
    // Auth check (Bearer im Embedded-Modus, sonst Cookies)
    const auth = await getRouteAuth(request);
    if (!auth) {
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

    // Graph-Ziel VOR dem Löschen lesen — danach ist die Zeile weg.
    const { data: itemRow } = await supabase
      .from('knowledge_items')
      .select('knowledge_base_id, company_id, document_id')
      .eq('id', itemId)
      .maybeSingle();

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

    // Graph nachziehen — ein geloeschter Fakt darf nicht ueber seine
    // Entitaeten und Kanten weiter in die Antworten wirken.
    if (itemRow?.knowledge_base_id && itemRow?.company_id) {
      await enqueueGraphJob(
        {
          companyId: itemRow.company_id,
          knowledgeBaseId: itemRow.knowledge_base_id,
          documentId: itemRow.document_id ?? null,
        },
        'delete'
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