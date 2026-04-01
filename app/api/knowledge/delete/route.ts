import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE(request: Request) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { knowledgeBaseId } = await request.json();

    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: "Missing knowledgeBaseId" },
        { status: 400 }
      );
    }

    console.log(
      `[KB Delete API] User ${user.id} attempting to delete KB: ${knowledgeBaseId}`
    );

    // 1. Verify access (RLS Policy prüft automatisch ob User Zugriff hat)
    // ✅ COMPANY SHARING: Kein .eq("user_id") mehr - RLS erlaubt DELETE nur für Owner/Admin
    const { data: kbData, error: ownerError } = await supabase
      .from("knowledge_bases")
      .select("id")
      .eq("id", knowledgeBaseId)
      .single();

    if (ownerError || !kbData) {
      console.error(
        `[KB Delete API] Access check failed or KB not found for user ${user.id}, KB: ${knowledgeBaseId}`, ownerError
      );
      return NextResponse.json(
        { error: "Knowledge base not found or access denied" },
        { status: 404 } // Or 403, but 404 hides existence
      );
    }

    // 2. Perform deletion using the SQL function via RPC (preferred)
    console.log(`[KB Delete API] Calling RPC delete_knowledge_base_and_related_data for KB: ${knowledgeBaseId}`);
    const { error: rpcError } = await supabase
      .rpc('delete_knowledge_base_and_related_data', {
        kb_id: knowledgeBaseId,
        user_id_check: user.id
      });

    if (rpcError) {
      console.warn(`[KB Delete API] RPC failed: ${rpcError.message}. Attempting fallback deletion via service role...`);

      // Fallback: Perform cascade-like deletion via service role client
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Helper to run the fallback deletion
      const runFallbackDelete = async () => {
        // 1) Collect referenced document ids
        const { data: docRefs, error: docRefErr } = await supabaseAdmin
          .from('knowledge_items')
          .select('document_id')
          .eq('knowledge_base_id', knowledgeBaseId)
          .not('document_id', 'is', null);
        if (docRefErr) throw docRefErr;

        const docIds = Array.from(new Set((docRefs || []).map((r: any) => r.document_id)));

        // 2) Delete dependent rows
        await supabaseAdmin.from('knowledge_items').delete().eq('knowledge_base_id', knowledgeBaseId);
        await supabaseAdmin.from('knowledge_base_groups').delete().eq('knowledge_base_id', knowledgeBaseId);
        await supabaseAdmin.from('mismatch_analysis_jobs').delete().eq('knowledge_base_id', knowledgeBaseId);

        // 3) Delete orphan documents (will cascade to document_chunks)
        for (const docId of docIds) {
          const { count, error: cntErr } = await supabaseAdmin
            .from('knowledge_items')
            .select('id', { count: 'exact', head: true })
            .eq('document_id', docId);
          if (cntErr) throw cntErr;
          if ((count || 0) === 0) {
            await supabaseAdmin.from('documents').delete().eq('id', docId);
          }
        }

        // 4) Finally delete the knowledge base
        await supabaseAdmin.from('knowledge_bases').delete().eq('id', knowledgeBaseId);
      };

      try {
        await runFallbackDelete();
      } catch (fallbackErr: any) {
        console.error('[KB Delete API] Fallback deletion failed:', fallbackErr);
        // Provide clearer message for common RPC errors
        if (rpcError.message.includes('does not exist')) {
          throw new Error(`Database function 'delete_knowledge_base_and_related_data' not found and fallback failed: ${fallbackErr.message}`);
        }
        if (rpcError.message.includes('permission denied')) {
          throw new Error(`RPC permission denied and fallback failed: ${fallbackErr.message}`);
        }
        throw fallbackErr;
      }
    }

    console.log(
      `[KB Delete API] Successfully deleted KB: ${knowledgeBaseId} by user ${user.id}`
    );

    return NextResponse.json({
      success: true,
      message: "Knowledge base deleted successfully.",
    });

  } catch (error: any) {
    console.error("[KB Delete API] General error:", error);
    return NextResponse.json(
      { error: `Failed to delete knowledge base: ${error.message}` },
      { status: 500 }
    );
  }
} 