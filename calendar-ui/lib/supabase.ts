import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Server-side client with service role key (bypasses RLS)
// Creates a lazy singleton to avoid build-time errors
let _supabase: SupabaseClient | null = null

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabase) {
      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error(
          'Supabase environment variables not configured. ' +
          'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
          `Current values: URL=${supabaseUrl ? 'set' : 'missing'}, Key=${supabaseServiceKey ? 'set' : 'missing'}`
        )
      }
      try {
        _supabase = createClient(supabaseUrl, supabaseServiceKey)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new Error(`Failed to create Supabase client: ${message}`)
      }
    }
    // Type assertion needed for Proxy pattern, but we validate _supabase is not null above
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_supabase as any)[prop]
  }
})

// Types for database tables
export interface Appointment {
  id: string
  subject: string
  start_time: string
  end_time: string
  location: string
  organizer_email: string
  organizer_name: string
  attendees: string[] | object[]
  body_preview: string
  is_all_day: boolean
  source: 'graph_api' | 'ics' | 'apple_calendar'
  created_at: string
  updated_at: string
}

export interface IgnoredBaseId {
  base_id: string
  subject: string
  ignored_at: string
  reason: string
}

export interface IgnoredEventId {
  event_id: string
  subject: string
  start_time: string
  reason: string
  ignored_at: string
}

export interface SyncMetadata {
  id: string
  last_outlook_sync: string | null
  last_ics_sync: string | null
  last_apple_sync: string | null
  updated_at: string
}

// Helper to convert Appointment to frontend CalendarEvent format
// Returns null if appointment is invalid (caller should filter these out)
export function toCalendarEvent(apt: Appointment | null | undefined): {
  id: string
  subject: string
  start_time: string
  end_time: string
  location: string
  organizer_email: string
  organizer_name: string
  source: 'graph_api' | 'ics' | 'apple_calendar'
  is_all_day: number
} | null {
  if (!apt) {
    console.warn('toCalendarEvent: Appointment is null or undefined')
    return null
  }
  
  // Validate required fields - return null for invalid data instead of throwing
  if (!apt.id || typeof apt.id !== 'string') {
    console.warn('toCalendarEvent: Invalid appointment id', apt)
    return null
  }
  if (!apt.start_time || typeof apt.start_time !== 'string') {
    console.warn('toCalendarEvent: Invalid appointment start_time', apt.id)
    return null
  }
  if (!apt.end_time || typeof apt.end_time !== 'string') {
    console.warn('toCalendarEvent: Invalid appointment end_time', apt.id)
    return null
  }
  if (!apt.source || !['graph_api', 'ics', 'apple_calendar'].includes(apt.source)) {
    console.warn('toCalendarEvent: Invalid appointment source', apt.id, apt.source)
    return null
  }
  
  return {
    id: apt.id,
    subject: apt.subject || 'No Title',
    start_time: apt.start_time,
    end_time: apt.end_time,
    location: apt.location || '',
    organizer_email: apt.organizer_email || '',
    organizer_name: apt.organizer_name || '',
    source: apt.source,
    is_all_day: apt.is_all_day ? 1 : 0
  }
}

