import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

// POST - Verify password and set auth cookie
export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json()
    const correctPassword = process.env.APP_PASSWORD

    if (!correctPassword) {
      // If no password is set, allow access (for development)
      console.warn('APP_PASSWORD not set - allowing access')
      const response = NextResponse.json({ success: true })
      response.cookies.set('lifesynced_auth', 'authenticated', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30 // 30 days
      })
      return response
    }

    if (password === correctPassword) {
      const response = NextResponse.json({ success: true })
      response.cookies.set('lifesynced_auth', 'authenticated', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30 // 30 days
      })
      return response
    }

    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  } catch (error: unknown) {
    console.error('Error in auth POST:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Invalid request', details: message }, { status: 400 })
  }
}

// GET - Check if authenticated
export async function GET() {
  const cookieStore = await cookies()
  const authCookie = cookieStore.get('lifesynced_auth')

  if (authCookie?.value === 'authenticated') {
    return NextResponse.json({ authenticated: true })
  }

  return NextResponse.json({ authenticated: false }, { status: 401 })
}

// DELETE - Logout (clear cookie)
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('lifesynced_auth')
  return response
}

