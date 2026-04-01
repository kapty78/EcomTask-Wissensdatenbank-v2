import "./globals.css"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { Metadata } from "next"
import SupabaseProvider from "@/components/providers/supabase-provider"
import { CompanyProvider } from "@/components/providers/CompanyContext"
import { Toaster } from "@/components/ui/sonner"
import Script from 'next/script'


export const metadata: Metadata = {
  title: "AI-Mitarbeiter Wissensdatenbank",
  description: "Wissensdatenbank für Ihren Kundensupport",
  icons: {
    icon: "/favicon.svg"
  }
}

export default async function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  const supabase = createServerComponentClient({ cookies })

  const {
    data: { session }
  } = await supabase.auth.getSession()

  return (
    <html lang="de" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
          integrity="sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
        {/* Production Console Override - Remove console logs in production */}
        <Script
          id="console-override"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && '${process.env.NODE_ENV}' === 'production') {
                const noop = function() {};
                console.log = noop;
                console.warn = noop;
                console.error = noop;
                console.debug = noop;
                console.info = noop;
              }
            `,
          }}
        />
        <Script
          id="recovery-redirect"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  if (typeof window === 'undefined') return;
                  var hash = window.location.hash || '';
                  if (!hash) return;
                  var lower = hash.toLowerCase();
                  if (lower.includes('type=recovery') && !window.location.pathname.startsWith('/auth/callback')) {
                    var target = window.location.origin + '/auth/callback' + hash;
                    window.location.replace(target);
                  }
                } catch (e) {
                  // ignore
                }
              })();
            `,
          }}
        />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <SupabaseProvider>
          <CompanyProvider>
            <main className="h-screen overflow-hidden bg-[var(--bg-primary)]">
              {children}
            </main>
            <Toaster />
          </CompanyProvider>
        </SupabaseProvider>
      </body>
    </html>
  )
}
