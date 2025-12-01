import { NextResponse } from 'next/server'
import { supabase, Appointment } from '@/lib/supabase'
import ICAL from 'ical.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds for sync

// Status words that indicate Free/Busy events to skip
const STATUS_WORDS = ['[Free]', '[Busy]', '[Tentative]', '[Out of Office]', '[Working Elsewhere]']

interface SyncResult {
  source: string
  added: number
  updated: number
  errors: string[]
}

export async function POST() {
  const results: SyncResult[] = []
  
  try {
    // Sync Outlook ICS if configured
    const outlookIcsUrl = process.env.OUTLOOK_ICS_URL
    if (outlookIcsUrl) {
      const result = await syncIcsCalendar(outlookIcsUrl, 'ics')
      results.push(result)
    }
    
    // Sync Apple/iCloud ICS calendars if configured
    const appleIcsUrls = process.env.APPLE_CALENDAR_ICS_URL
    if (appleIcsUrls) {
      const urls = appleIcsUrls.split(',').map(u => u.trim()).filter(Boolean)
      for (const url of urls) {
        const result = await syncIcsCalendar(url, 'apple_calendar')
        results.push(result)
      }
    }
    
    // Update sync metadata
    await supabase
      .from('sync_metadata')
      .upsert({
        id: 'default',
        last_ics_sync: outlookIcsUrl ? new Date().toISOString() : null,
        last_apple_sync: appleIcsUrls ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
    
    const totalAdded = results.reduce((sum, r) => sum + r.added, 0)
    const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0)
    const allErrors = results.flatMap(r => r.errors)
    
    return NextResponse.json({
      success: true,
      message: `Sync complete: ${totalAdded} added, ${totalUpdated} updated`,
      results,
      errors: allErrors.length > 0 ? allErrors : undefined
    })
  } catch (error: unknown) {
    console.error('Sync error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ 
      success: false, 
      error: 'Sync failed', 
      details: message,
      results 
    }, { status: 500 })
  }
}

async function syncIcsCalendar(url: string, source: 'ics' | 'apple_calendar'): Promise<SyncResult> {
  const result: SyncResult = { source, added: 0, updated: 0, errors: [] }
  
  try {
    // Fetch ICS data
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LifeSynced Calendar Sync/1.0'
      }
    })
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ICS: ${response.status} ${response.statusText}`)
    }
    
    const icsData = await response.text()
    
    // Parse ICS using ical.js
    const jcalData = ICAL.parse(icsData)
    const vcalendar = new ICAL.Component(jcalData)
    const vevents = vcalendar.getAllSubcomponents('vevent')
    
    // Calculate date range for events (past 7 days to 90 days ahead)
    const rangeStart = new Date()
    rangeStart.setDate(rangeStart.getDate() - 7)
    const rangeEnd = new Date()
    rangeEnd.setDate(rangeEnd.getDate() + 90)
    
    const eventsToUpsert: Partial<Appointment>[] = []
    
    let recurringCount = 0
    let singleCount = 0
    
    for (const vevent of vevents) {
      try {
        const event = new ICAL.Event(vevent)
        
        // Debug: check if events are being detected as recurring
        if (event.isRecurring()) {
          recurringCount++
        } else {
          singleCount++
        }
        
        const events = expandEvent(event, rangeStart, rangeEnd, source)
        eventsToUpsert.push(...events)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        result.errors.push(`Failed to parse event: ${msg}`)
      }
    }
    
    console.log(`[${source}] Found ${recurringCount} recurring events, ${singleCount} single events`)
    
    // Batch upsert events - deduplicate by ID first
    if (eventsToUpsert.length > 0) {
      // Deduplicate events by ID (keep the last occurrence)
      const uniqueEvents = new Map<string, Partial<Appointment>>()
      for (const event of eventsToUpsert) {
        if (event.id) {
          uniqueEvents.set(event.id, event)
        }
      }
      const dedupedEvents = Array.from(uniqueEvents.values())
      
      const { error } = await supabase
        .from('appointments')
        .upsert(dedupedEvents, { onConflict: 'id' })
      
      if (error) {
        result.errors.push(`Database error: ${error.message}`)
      } else {
        result.added = dedupedEvents.length
      }
    }
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(msg)
  }
  
  return result
}

function expandEvent(
  event: ICAL.Event, 
  rangeStart: Date, 
  rangeEnd: Date, 
  source: 'ics' | 'apple_calendar'
): Partial<Appointment>[] {
  const results: Partial<Appointment>[] = []
  const subject = event.summary || ''
  
  // Skip all-day/multi-day Free events from work calendars
  if (source === 'ics') {
    const isStatusWord = STATUS_WORDS.some(sw => 
      subject.toLowerCase().includes(sw.toLowerCase())
    )
    if (isStatusWord) {
      const startDate = event.startDate?.toJSDate()
      const endDate = event.endDate?.toJSDate()
      if (startDate && endDate) {
        const durationHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
        if (durationHours >= 24) {
          return [] // Skip all-day/multi-day Free events
        }
      }
    }
  }
  
  // Check if event is recurring
  const isRecurring = event.isRecurring()
  
  if (isRecurring) {
    try {
      const iterator = event.iterator()
      let next = iterator.next()
      let count = 0
      // Calculate max iterations needed: worst case is daily events for 2+ years
      // rangeEnd is 90 days ahead, but events might start years ago
      // 500 should cover most cases (1+ year of daily events)
      const maxIterations = 500
      
      while (next && count < maxIterations) {
        const occurrenceDate = next.toJSDate()
        
        // Skip past occurrences until we reach our range, but keep iterating
        if (occurrenceDate > rangeEnd) break
        
        if (occurrenceDate >= rangeStart) {
          const occurrence = createEventRecord(event, occurrenceDate, source)
          if (occurrence) results.push(occurrence)
        }
        
        next = iterator.next()
        count++
      }
    } catch (recurErr) {
      // Log the error and fallback to single event
      console.error(`Failed to expand recurring event "${subject}":`, recurErr)
      const occurrence = createEventRecord(event, event.startDate?.toJSDate(), source)
      if (occurrence) results.push(occurrence)
    }
  } else {
    // Single event
    const startDate = event.startDate?.toJSDate()
    if (startDate && startDate >= rangeStart && startDate <= rangeEnd) {
      const record = createEventRecord(event, startDate, source)
      if (record) results.push(record)
    }
  }
  
  return results
}

function createEventRecord(
  event: ICAL.Event, 
  startDate: Date | undefined, 
  source: 'ics' | 'apple_calendar'
): Partial<Appointment> | null {
  if (!startDate) return null
  
  const uid = event.uid || `unknown_${Date.now()}`
  const duration = event.duration
  
  let endDate: Date
  if (duration) {
    endDate = new Date(startDate.getTime() + duration.toSeconds() * 1000)
  } else if (event.endDate) {
    // For recurring events, calculate end based on original duration
    const originalStart = event.startDate?.toJSDate()
    const originalEnd = event.endDate?.toJSDate()
    if (originalStart && originalEnd) {
      const durationMs = originalEnd.getTime() - originalStart.getTime()
      endDate = new Date(startDate.getTime() + durationMs)
    } else {
      endDate = new Date(startDate.getTime() + 60 * 60 * 1000) // Default 1 hour
    }
  } else {
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000) // Default 1 hour
  }
  
  // Create unique ID for this occurrence
  const dateStr = startDate.toISOString().replace(/[-:]/g, '').split('.')[0]
  const eventId = `${uid}_${dateStr}`
  
  // Determine if all-day event
  const isAllDay = event.startDate?.isDate || false
  
  return {
    id: eventId,
    subject: event.summary || 'No Title',
    start_time: startDate.toISOString(),
    end_time: endDate.toISOString(),
    location: event.location || '',
    organizer_email: event.organizer?.toString() || '',
    organizer_name: '',
    attendees: [],
    body_preview: event.description || '',
    is_all_day: isAllDay,
    source,
    updated_at: new Date().toISOString()
  }
}
