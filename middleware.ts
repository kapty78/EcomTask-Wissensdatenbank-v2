import { NextResponse, type NextRequest } from "next/server"

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

export async function middleware(request: NextRequest) {
  // Recovery-Hash-Redirect: Falls jemand auf /login mit #type=recovery landet,
  // leite sofort auf /auth/callback um (serverside, vor React)
  const url = request.nextUrl.clone()
  const pathname = url.pathname
  
  // Check if this is a request to /login and might have recovery hash
  // (Hash ist client-only, aber wir können durch User-Agent/Referrer-Pattern erkennen)
  const userAgent = request.headers.get('user-agent') || ''
  const referer = request.headers.get('referer') || ''
  
  // Wenn der Referer ein Supabase verify-Link mit type=recovery ist, 
  // leite automatisch auf /auth/callback um
  if (pathname === '/login' && referer.includes('supabase.co/auth/v1/verify') && referer.includes('type=recovery')) {
    url.pathname = '/auth/callback'
    return NextResponse.redirect(url)
  }
  
  return NextResponse.next()
}
