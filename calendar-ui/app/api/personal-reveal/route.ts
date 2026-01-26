import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

// POST - Verify personal reveal password and set cookie
export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json()
    const correctPassword = process.env.PERSONAL_REVEAL_PASSWORD

    // If no password is configured, reveal is not possible
    if (!correctPassword) {
      return NextResponse.json({ 
        error: 'Personal reveal password not configured on server' 
      }, { status: 403 })
    }

    if (password === correctPassword) {
      const response = NextResponse.json({ success: true })
      response.cookies.set('lifesynced_personal_reveal', 'revealed', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 // 24 hours
      })
      return response
    }

    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  } catch (error: unknown) {
    console.error('Error in personal-reveal POST:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Invalid request', details: message }, { status: 400 })
  }
}

// GET - Check if personal events are revealed
export async function GET() {
  const cookieStore = await cookies()
  const revealCookie = cookieStore.get('lifesynced_personal_reveal')
  const hasRevealPassword = !!process.env.PERSONAL_REVEAL_PASSWORD

  if (revealCookie?.value === 'revealed') {
    return NextResponse.json({ revealed: true })
  }

  // Return whether reveal is possible (password configured)
  return NextResponse.json({ 
    revealed: false,
    canReveal: hasRevealPassword
  })
}

// DELETE - Hide personal events (clear reveal cookie)
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete('lifesynced_personal_reveal')
  return response
}

