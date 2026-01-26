import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabase, toCalendarEvent } from '@/lib/supabase'

// Disable all caching for this route
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const daysParam = searchParams.get('days') || '30'
    const daysAhead = parseInt(daysParam, 10)
    
    // Validate daysAhead parameter
    if (isNaN(daysAhead) || daysAhead < 1 || daysAhead > 365) {
      return NextResponse.json({ 
        error: 'Invalid days parameter. Must be between 1 and 365.' 
      }, { status: 400 })
    }
    
    // Check if personal events should be revealed
    // Default: always masked. Only revealed with correct password.
    const cookieStore = await cookies()
    const revealCookie = cookieStore.get('lifesynced_personal_reveal')
    const personalRevealed = revealCookie?.value === 'revealed'
    
    // Calculate date range - use UTC to match Supabase storage
    const now = new Date()
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
    const endDate = new Date(startDate)
    endDate.setUTCDate(endDate.getUTCDate() + daysAhead)
    endDate.setUTCHours(23, 59, 59, 999)
    
    // Fetch appointments within date range
    const { data: appointments, error: aptError } = await supabase
      .from('appointments')
      .select('*')
      .gte('start_time', startDate.toISOString())
      .lte('start_time', endDate.toISOString())
      .order('start_time', { ascending: true })
    
    if (aptError) {
      console.error('Error fetching appointments:', aptError)
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
    }
    
    // Fetch ignored base IDs
    const { data: ignoredBaseIds, error: baseError } = await supabase
      .from('ignored_base_ids')
      .select('base_id')
    
    if (baseError) {
      console.error('Error fetching ignored base IDs:', baseError)
    }
    
    // Fetch ignored event IDs
    const { data: ignoredEventIds, error: eventError } = await supabase
      .from('ignored_event_ids')
      .select('event_id')
    
    if (eventError) {
      console.error('Error fetching ignored event IDs:', eventError)
    }
    
    // Create sets for efficient lookup
    const ignoredBaseSet = new Set<string>()
    const ignoredEventSet = new Set<string>()
    
    if (ignoredBaseIds && Array.isArray(ignoredBaseIds)) {
      for (const item of ignoredBaseIds) {
        if (item && typeof item === 'object' && 'base_id' in item && typeof item.base_id === 'string') {
          ignoredBaseSet.add(item.base_id)
        }
      }
    }
    
    if (ignoredEventIds && Array.isArray(ignoredEventIds)) {
      for (const item of ignoredEventIds) {
        if (item && typeof item === 'object' && 'event_id' in item && typeof item.event_id === 'string') {
          ignoredEventSet.add(item.event_id)
        }
      }
    }
    
    // Filter out ignored events and convert to frontend format
    const events = (appointments || [])
      .filter(apt => {
        // Check if specific event ID is ignored
        if (ignoredEventSet.has(apt.id)) return false
        
        // Check if base ID (recurring series) is ignored
        const baseId = getBaseIdFromEventId(apt.id)
        if (ignoredBaseSet.has(baseId)) return false
        
        return true
      })
      .map(apt => {
        const event = toCalendarEvent(apt)
        if (!event) return null // Skip invalid events
        
        // Mask personal calendar event names if not revealed
        if (apt.source === 'apple_calendar' && !personalRevealed) {
          event.subject = '[Personal Event]'
          // Also mask location for privacy
          event.location = ''
        }
        
        return event
      })
      .filter((event): event is NonNullable<typeof event> => event !== null) // Remove null values
    
    // Return with no-cache headers to prevent any caching
    const response = NextResponse.json(events)
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  } catch (error: unknown) {
    console.error('Error in events API:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 })
  }
}

// Extract base ID from event ID (handles recurring event occurrences)
function getBaseIdFromEventId(eventId: string): string {
  // Pattern: baseId_YYYYMMDDTHHMMSS or baseId_YYYYMMDD
  const parts = eventId.split('_')
  if (parts.length <= 1) return eventId
  
  const lastPart = parts[parts.length - 1]
  // Check if last part looks like a timestamp (8+ digits, may contain T)
  const isTimestamp = /^\d{8}(T\d{6})?$/.test(lastPart)
  
  if (isTimestamp) {
    return parts.slice(0, -1).join('_')
  }
  
  return eventId
}

