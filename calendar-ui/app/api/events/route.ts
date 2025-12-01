import { NextRequest, NextResponse } from 'next/server'
import { supabase, toCalendarEvent } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const daysAhead = parseInt(searchParams.get('days') || '30', 10)
    
    // Calculate date range
    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + daysAhead)
    endDate.setHours(23, 59, 59, 999)
    
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
    const ignoredBaseSet = new Set((ignoredBaseIds || []).map((i: { base_id: string }) => i.base_id))
    const ignoredEventSet = new Set((ignoredEventIds || []).map((i: { event_id: string }) => i.event_id))
    
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
      .map(toCalendarEvent)
    
    return NextResponse.json(events)
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

