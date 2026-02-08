import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  try {
    // Skip auth check for login page and API routes
    if (
      request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname.startsWith('/api/')
    ) {
      return NextResponse.next()
    }

    // Check for auth cookie
    const authCookie = request.cookies.get('lifesynced_auth')

    // If not authenticated, redirect to login
    if (authCookie?.value !== 'authenticated') {
      const loginUrl = new URL('/login', request.url)
      // Preserve the original path as a query parameter for redirect after login
      loginUrl.searchParams.set('redirect', request.nextUrl.pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Rolling cookie refresh — extend 2-day expiry on every request
    const response = NextResponse.next()
    response.cookies.set('lifesynced_auth', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 2, // 2 days
      path: '/',
    })
    return response
  } catch (error) {
    // Log error but don't expose details to client
    console.error('Middleware error:', error)
    // Fallback: redirect to login on error
    try {
      return NextResponse.redirect(new URL('/login', request.url))
    } catch {
      // If redirect fails, return 500 response
      return new NextResponse('Internal Server Error', { status: 500 })
    }
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/).*)',
  ],
}

