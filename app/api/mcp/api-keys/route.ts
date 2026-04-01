// API Routes für MCP API Key Management
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const API_KEY_PREFIX = 'sk_live_';

// Hash API Key
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

// Generate API Key
function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const randomBytes = crypto.randomBytes(32);
  const keyPart = randomBytes.toString('base64url');
  const rawKey = `${API_KEY_PREFIX}${keyPart}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, API_KEY_PREFIX.length + 8);

  return { rawKey, keyHash, keyPrefix };
}

// GET - Liste alle API Keys der Company
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's company_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('company_id, is_super_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.company_id) {
      return NextResponse.json({ error: 'No company association' }, { status: 403 });
    }

    // Check if user is company admin
    const { data: isAdmin } = await supabase
      .from('company_admins')
      .select('user_id')
      .eq('company_id', profile.company_id)
      .eq('user_id', user.id)
      .single();

    if (!isAdmin && !profile.is_super_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get API keys for this company
    const { data: apiKeys, error: keysError } = await supabase
      .from('mcp_api_keys')
      .select(`
        id,
        key_prefix,
        name,
        description,
        knowledge_base_id,
        knowledge_bases(id, name),
        rate_limit_per_minute,
        last_used_at,
        total_requests,
        expires_at,
        is_active,
        created_at
      `)
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false });

    if (keysError) {
      console.error('Error fetching API keys:', keysError);
      return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 });
    }

    return NextResponse.json({ apiKeys });
  } catch (error) {
    console.error('Error in GET /api/mcp/api-keys:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Erstelle neuen API Key
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's company_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('company_id, is_super_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.company_id) {
      return NextResponse.json({ error: 'No company association' }, { status: 403 });
    }

    // Check if user is company admin
    const { data: isAdmin } = await supabase
      .from('company_admins')
      .select('user_id')
      .eq('company_id', profile.company_id)
      .eq('user_id', user.id)
      .single();

    if (!isAdmin && !profile.is_super_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse request body
    const body = await req.json();
    const { name, description, knowledge_base_id, rate_limit_per_minute, expires_at } = body;

    if (!name || !knowledge_base_id) {
      return NextResponse.json(
        { error: 'Name and knowledge_base_id are required' },
        { status: 400 }
      );
    }

    // Verify KB belongs to company
    const { data: kb, error: kbError } = await supabase
      .from('knowledge_bases')
      .select('id, name, company_id')
      .eq('id', knowledge_base_id)
      .single();

    if (kbError || !kb) {
      return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 });
    }

    // Check if KB belongs to user's company (via user_id or company_id)
    const { data: kbAccess } = await supabase
      .from('knowledge_bases')
      .select('id')
      .eq('id', knowledge_base_id)
      .or(`user_id.eq.${user.id},company_id.eq.${profile.company_id}`)
      .single();

    if (!kbAccess) {
      return NextResponse.json(
        { error: 'No access to this knowledge base' },
        { status: 403 }
      );
    }

    // Generate API key
    const { rawKey, keyHash, keyPrefix } = generateApiKey();

    // Insert into database
    const { data: newKey, error: insertError } = await supabase
      .from('mcp_api_keys')
      .insert({
        company_id: profile.company_id,
        knowledge_base_id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name,
        description: description || null,
        rate_limit_per_minute: rate_limit_per_minute || 60,
        expires_at: expires_at || null,
        created_by: user.id,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating API key:', insertError);
      return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
    }

    // Return the raw key (ONLY TIME IT'S VISIBLE!)
    return NextResponse.json({
      message: 'API key created successfully',
      apiKey: {
        id: newKey.id,
        rawKey, // ⚠️ ONLY returned once!
        keyPrefix,
        name: newKey.name,
        description: newKey.description,
        knowledge_base_id: newKey.knowledge_base_id,
        rate_limit_per_minute: newKey.rate_limit_per_minute,
        expires_at: newKey.expires_at,
        created_at: newKey.created_at,
      },
    });
  } catch (error) {
    console.error('Error in POST /api/mcp/api-keys:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update API Key (deaktivieren, Name ändern, etc.)
export async function PATCH(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { id, name, description, is_active, rate_limit_per_minute } = body;

    if (!id) {
      return NextResponse.json({ error: 'API key ID required' }, { status: 400 });
    }

    // Update API key (RLS ensures company_id match)
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (rate_limit_per_minute !== undefined)
      updateData.rate_limit_per_minute = rate_limit_per_minute;

    const { data: updatedKey, error: updateError } = await supabase
      .from('mcp_api_keys')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating API key:', updateError);
      return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'API key updated successfully',
      apiKey: updatedKey,
    });
  } catch (error) {
    console.error('Error in PATCH /api/mcp/api-keys:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Lösche API Key
export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'API key ID required' }, { status: 400 });
    }

    // Delete API key (RLS ensures company_id match)
    const { error: deleteError } = await supabase
      .from('mcp_api_keys')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting API key:', deleteError);
      return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
    }

    return NextResponse.json({ message: 'API key deleted successfully' });
  } catch (error) {
    console.error('Error in DELETE /api/mcp/api-keys:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
