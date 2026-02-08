import type { Metadata, Viewport } from 'next'
import { SessionGuard } from '@/components/SessionGuard'
import './globals.css'

export const metadata: Metadata = {
  title: 'LifeSynced - Unified Calendar',
  description: 'View your work and personal calendars in one place',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="overscroll-none">
        <SessionGuard />
        {children}
      </body>
    </html>
  )
}

