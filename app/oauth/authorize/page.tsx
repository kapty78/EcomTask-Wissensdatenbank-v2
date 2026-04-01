'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, Database, AlertCircle, Check } from 'lucide-react';

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
}

interface Profile {
  id: string;
  company_id: string;
  full_name: string | null;
}

// MCP Server URL (can be configured via env)
const MCP_SERVER_URL = process.env.NEXT_PUBLIC_MCP_SERVER_URL || 'https://ecomtask-mcp-server.onrender.com';

export default function OAuthAuthorizePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = getSupabaseClient();

  // OAuth params from URL
  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const scope = searchParams.get('scope') || 'search';
  const state = searchParams.get('state') || '';
  const codeChallenge = searchParams.get('code_challenge') || '';
  const codeChallengeMethod = searchParams.get('code_challenge_method') || '';

  // State
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string>('');

  // Load user and knowledge bases
  useEffect(() => {
    async function loadData() {
      try {
        // Check auth
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          // Redirect to login with return URL
          const returnUrl = `/oauth/authorize?${searchParams.toString()}`;
          router.push(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
          return;
        }

        setUser(user);

        // Get profile with company_id
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, company_id, full_name')
          .eq('id', user.id)
          .single();

        if (profileError || !profileData?.company_id) {
          setError('Kein Unternehmen zugeordnet. Bitte kontaktiere den Administrator.');
          setLoading(false);
          return;
        }

        setProfile(profileData);

        // Get knowledge bases for this user/company
        const { data: kbData, error: kbError } = await supabase
          .from('knowledge_bases')
          .select('id, name, description')
          .order('name');

        if (kbError) {
          console.error('Error loading KBs:', kbError);
          setError('Fehler beim Laden der Wissensdatenbanken');
        } else {
          setKnowledgeBases(kbData || []);
          // Auto-select if only one KB
          if (kbData?.length === 1) {
            setSelectedKbId(kbData[0].id);
          }
        }
      } catch (err) {
        console.error('Error:', err);
        setError('Ein Fehler ist aufgetreten');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [searchParams, router, supabase]);

  // Handle authorization
  async function handleAuthorize() {
    if (!selectedKbId || !profile) return;

    setAuthorizing(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError('Sitzung abgelaufen. Bitte neu einloggen.');
        return;
      }

      const selectedKb = knowledgeBases.find(kb => kb.id === selectedKbId);

      // Call MCP Server to create auth code
      const response = await fetch(`${MCP_SERVER_URL}/oauth/authorize/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          user_id: user.id,
          company_id: profile.company_id,
          knowledge_base_id: selectedKbId,
          knowledge_base_name: selectedKb?.name || 'Unknown',
          access_token: session.access_token,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Autorisierung fehlgeschlagen');
      }

      const data = await response.json();

      // Redirect back to OpenAI with the code
      window.location.href = data.redirect_url;
    } catch (err) {
      console.error('Authorization error:', err);
      setError(err instanceof Error ? err.message : 'Autorisierung fehlgeschlagen');
      setAuthorizing(false);
    }
  }

  // Handle deny
  function handleDeny() {
    if (redirectUri) {
      const errorUrl = new URL(redirectUri);
      errorUrl.searchParams.set('error', 'access_denied');
      errorUrl.searchParams.set('error_description', 'User denied the request');
      if (state) errorUrl.searchParams.set('state', state);
      window.location.href = errorUrl.toString();
    } else {
      router.push('/dashboard');
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Lade...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>App-Autorisierung</CardTitle>
          <CardDescription>
            Eine externe Anwendung möchte auf deine Wissensdatenbank zugreifen
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* App info */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">ChatGPT / OpenAI</p>
                <p className="text-sm text-muted-foreground">
                  Möchte Wissen aus deiner Datenbank abrufen
                </p>
              </div>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <p className="text-sm font-medium mb-2">Berechtigungen:</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500" />
                <span>Semantische Suche in der Wissensdatenbank</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500" />
                <span>Fakten und Quellenangaben abrufen</span>
              </div>
            </div>
          </div>

          {/* Knowledge Base Selection */}
          {knowledgeBases.length > 0 ? (
            <div>
              <p className="text-sm font-medium mb-2">Wissensdatenbank wählen:</p>
              <Select value={selectedKbId} onValueChange={setSelectedKbId}>
                <SelectTrigger>
                  <SelectValue placeholder="Wähle eine Wissensdatenbank" />
                </SelectTrigger>
                <SelectContent>
                  {knowledgeBases.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      <div className="flex flex-col">
                        <span>{kb.name}</span>
                        {kb.description && (
                          <span className="text-xs text-muted-foreground">
                            {kb.description}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">
                    Keine Wissensdatenbanken
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Du hast noch keine Wissensdatenbanken erstellt.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* User info */}
          <div className="text-sm text-muted-foreground border-t pt-4">
            <p>
              Eingeloggt als: <strong>{profile?.full_name || user?.email}</strong>
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleDeny}>
            Ablehnen
          </Button>
          <Button
            className="flex-1"
            onClick={handleAuthorize}
            disabled={!selectedKbId || authorizing || knowledgeBases.length === 0}
          >
            {authorizing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Autorisiere...
              </>
            ) : (
              'Autorisieren'
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
