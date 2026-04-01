"use client"; // Wichtig! Dieser Provider MUSS eine Client-Komponente sein

import { useState, useEffect, useRef } from 'react';
import { SessionContextProvider } from '@supabase/auth-helpers-react';
import { Database } from '@/supabase/types';
import SessionExpiredModal from '@/components/auth/SessionExpiredModal';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { saveCompany, saveDomain } from '@/lib/domain-manager';

/**
 * Detect if running inside an iframe (embedded mode from Support AI).
 */
function isInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Extract embedded auth tokens from URL hash.
 */
function getEmbeddedTokens(): { accessToken: string; refreshToken: string } | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || !hash.includes('type=embedded')) return null;

  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (accessToken && refreshToken) {
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    return { accessToken, refreshToken };
  }
  return null;
}

export default function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const [embedded] = useState(() => isInIframe());
  // Use centralized client that returns in-memory client for iframe, cookie-based otherwise
  const [supabaseClient] = useState(() => getSupabaseClient());
  const [showSessionExpired, setShowSessionExpired] = useState(false);
  // Always start false to avoid hydration mismatch (server never runs in iframe)
  const [isReady, setIsReady] = useState(false);
  const embeddedTokensRef = useRef(getEmbeddedTokens());

  // Initialize: set ready immediately for non-embedded, or after token injection for embedded
  useEffect(() => {
    if (!embedded) {
      setIsReady(true);
      return;
    }

    const tokens = embeddedTokensRef.current;
    if (tokens) {
      supabaseClient.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      }).then(async ({ error }) => {
        if (!error) {
          // Ensure profile exists (uses Bearer token since cookies don't work in iframe)
          try {
            await fetch('/api/auth/ensure-profile', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.accessToken}`,
              },
              body: JSON.stringify({}),
            });
          } catch {
            // Non-critical: profile might already exist
          }

          // Load company info so components like ChatInterface can find it
          try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user) {
              const { data: profile } = await supabaseClient
                .from('profiles')
                .select('company_id')
                .eq('id', user.id)
                .single();

              if (profile?.company_id) {
                const { data: company } = await supabaseClient
                  .from('companies')
                  .select('id, name, domain')
                  .eq('id', profile.company_id)
                  .single();

                if (company) {
                  saveCompany({ id: company.id, name: company.name, domain: company.domain });
                  if (company.domain) saveDomain(company.domain);
                }
              }
            }
          } catch {
            // Non-critical: search may not work without company context
          }

          setIsReady(true);
        } else {
          console.error('Embedded auth failed:', error.message);
          setIsReady(true);
        }
      });
    } else {
      setIsReady(true);
    }
  }, [embedded, supabaseClient]);

  // postMessage Auth-Listener: Accept token refreshes from parent (Support AI)
  useEffect(() => {
    if (!embedded) return;

    const handleMessage = async (event: MessageEvent) => {
      const allowedOrigins = [
        "https://support.ai-mitarbeiter.de",
        "http://localhost:3000",
        "http://localhost:3001",
      ];
      if (!allowedOrigins.includes(event.origin)) return;
      if (event.data?.type !== "supabase-auth") return;

      const { access_token, refresh_token } = event.data;
      if (access_token && refresh_token) {
        await supabaseClient.auth.setSession({ access_token, refresh_token });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [embedded, supabaseClient]);

  // Beim ersten Laden: Modal nicht anzeigen wenn bereits auf Auth-Seite
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isOnAuthPage = window.location.pathname.startsWith('/auth') || window.location.pathname === '/login';
      if (isOnAuthPage) {
        setShowSessionExpired(false);
      }
    }
  }, []);

  useEffect(() => {
    if (embedded) return;

    const handleAuthStateChange = (event: string, session: any) => {
      if (event === 'SIGNED_OUT' && !session) {
        const isOnAuthPage = typeof window !== 'undefined' && (
          window.location.pathname.startsWith('/auth') || window.location.pathname === '/login'
        );
        if (!isOnAuthPage) {
          setTimeout(() => {
            setShowSessionExpired(true);
          }, 1000);
        }
      }
    };

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(handleAuthStateChange);
    return () => { subscription.unsubscribe(); };
  }, [supabaseClient.auth, embedded]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isOnAuthPage = window.location.pathname.startsWith('/auth') || window.location.pathname === '/login';
      if (isOnAuthPage && showSessionExpired) {
        setShowSessionExpired(false);
      }
    }
  }, [showSessionExpired]);

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1e1e1e]">
        <div className="h-8 w-8 rounded-full border-4 border-t-pink-500 border-r-transparent border-b-pink-500 border-l-transparent animate-spin" />
      </div>
    );
  }

  return (
    <SessionContextProvider supabaseClient={supabaseClient}>
      {children}
      {!embedded && (
        <SessionExpiredModal
          isOpen={showSessionExpired}
          onClose={() => setShowSessionExpired(false)}
          supabaseClient={supabaseClient}
        />
      )}
    </SessionContextProvider>
  );
}
