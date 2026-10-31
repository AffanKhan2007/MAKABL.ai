import { NextResponse, type NextRequest } from 'next/server';

// Optimistic check only: send visitors without a session cookie to the sign-in page.
// Whether the session is valid is checked on the server by requireUser(), which every
// page, action and API route calls.

const PUBLIC = new Set(['/', '/login', '/signup']);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.has(pathname) || request.cookies.has('makabl_session')) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Not API routes (they answer 401 themselves) or static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
