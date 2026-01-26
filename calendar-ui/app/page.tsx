'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'

type ViewMode = 'day' | 'week' | '4week'

interface CalendarEvent {
  id: string
  subject: string
  start_time: string
  end_time: string
  location: string
  organizer_email: string
  organizer_name: string
  source: string
  is_all_day: number
}

// Detect if running on mobile device
const getDefaultViewMode = (): ViewMode => {
  if (typeof window === 'undefined') return 'week' // SSR default
  return window.innerWidth < 768 ? 'day' : 'week'
}

export default function Home() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('week') // Will be updated in useEffect
  const [detectOverlap, setDetectOverlap] = useState(false)
  const [hideWeekends, setHideWeekends] = useState(true)
  const [syncStatus, setSyncStatus] = useState<string>('')
  const [selectedDay, setSelectedDay] = useState<Date>(new Date())
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const today = new Date()
    const day = today.getDay()
    const diff = today.getDate() - day
    return new Date(today.setDate(diff))
  })
  const [monthStart, setMonthStart] = useState<Date>(() => {
    const today = new Date()
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
    const day = firstDay.getDay()
    const diff = firstDay.getDate() - day
    return new Date(firstDay.setDate(diff))
  })
  const [ignoredBaseIds, setIgnoredBaseIds] = useState<Set<string>>(new Set())
  const [ignoredEventIds, setIgnoredEventIds] = useState<Set<string>>(new Set())
  const [showIgnoredList, setShowIgnoredList] = useState(false)
  const [ignoredSeriesList, setIgnoredSeriesList] = useState<Array<{base_id: string, subject: string}>>([])
  const [ignoredOccurrencesList, setIgnoredOccurrencesList] = useState<Array<{event_id: string, subject: string, start_time: string}>>([])
  
  // Modal state for ignore choice
  const [ignoreModalEvent, setIgnoreModalEvent] = useState<CalendarEvent | null>(null)
  const [isRecurringEvent, setIsRecurringEvent] = useState(false)
  
  // Personal events reveal state (default: always masked)
  // This also gates access to 4-week view
  const [personalRevealed, setPersonalRevealed] = useState(false)
  const [canRevealPersonal, setCanRevealPersonal] = useState(true)
  const [showRevealModal, setShowRevealModal] = useState(false)
  const [revealPassword, setRevealPassword] = useState('')
  const [revealError, setRevealError] = useState('')
  const [revealLoading, setRevealLoading] = useState(false)
  const [pendingViewMode, setPendingViewMode] = useState<ViewMode | null>(null)
  
  // Hover tooltip state
  const [hoveredEvent, setHoveredEvent] = useState<CalendarEvent | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  
  // Timezone state
  const [timezone, setTimezone] = useState<string>('America/Los_Angeles')
  const [showTimezoneSelector, setShowTimezoneSelector] = useState(false)
  
  // Refs for focus management and accessibility
  const revealModalRef = useRef<HTMLDivElement>(null)
  const ignoreModalRef = useRef<HTMLDivElement>(null)
  const mainContentRef = useRef<HTMLDivElement>(null)
  
  const timezoneOptions = [
    { value: 'America/Los_Angeles', label: 'Pacific (PST/PDT)', short: 'PT' },
    { value: 'America/Denver', label: 'Mountain (MST/MDT)', short: 'MT' },
    { value: 'America/Chicago', label: 'Central (CST/CDT)', short: 'CT' },
    { value: 'America/New_York', label: 'Eastern (EST/EDT)', short: 'ET' },
    { value: 'America/Anchorage', label: 'Alaska (AKST/AKDT)', short: 'AKT' },
    { value: 'Pacific/Honolulu', label: 'Hawaii (HST)', short: 'HT' },
    { value: 'Europe/London', label: 'London (GMT/BST)', short: 'UK' },
    { value: 'Europe/Paris', label: 'Paris (CET/CEST)', short: 'CET' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)', short: 'JST' },
    { value: 'Asia/Shanghai', label: 'Shanghai (CST)', short: 'CST' },
    { value: 'Asia/Kolkata', label: 'India (IST)', short: 'IST' },
    { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)', short: 'AEST' },
  ]
  
  const getCurrentTimezoneLabel = () => {
    const tz = timezoneOptions.find(t => t.value === timezone)
    return tz ? tz.short : 'PT'
  }

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true)
  
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])
  
  useEffect(() => {
    // Set default view mode based on screen size (mobile = Day, desktop = Week)
    setViewMode(getDefaultViewMode())
    
    fetchEvents()
    fetchIgnoredBaseIds()
    fetchIgnoredEventIds()
    checkPersonalRevealStatus()
    // Load saved timezone from localStorage
    const savedTimezone = localStorage.getItem('lifesynced_timezone')
    if (savedTimezone) {
      setTimezone(savedTimezone)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  
  const checkPersonalRevealStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/personal-reveal', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Failed to check personal reveal status: ${response.status}`)
      }
      const data = await response.json()
      if (isMountedRef.current) {
        setPersonalRevealed(data.revealed || false)
        setCanRevealPersonal(data.canReveal !== false) // Default to true if not specified
      }
    } catch (error) {
      console.error('Error checking personal reveal status:', error)
      if (isMountedRef.current) {
        setCanRevealPersonal(false)
      }
    }
  }, [])
  
  const handleRevealSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isMountedRef.current) return
    
    setRevealLoading(true)
    setRevealError('')
    
    try {
      const response = await fetch('/api/personal-reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: revealPassword })
      })
      
      if (!isMountedRef.current) return
      
      if (response.ok) {
        setPersonalRevealed(true)
        setShowRevealModal(false)
        setRevealPassword('')
        // If user was trying to access 4-week view, switch to it now
        if (pendingViewMode === '4week') {
          setViewMode('4week')
          setPendingViewMode(null)
        }
        // Refresh events to get unmasked data
        await fetchEvents()
      } else {
        const errorData = await response.json().catch(() => ({}))
        setRevealError(errorData.error || 'Incorrect password')
      }
    } catch (error) {
      if (!isMountedRef.current) return
      console.error('Error in handleRevealSubmit:', error)
      setRevealError('Something went wrong. Please try again.')
    } finally {
      if (isMountedRef.current) {
        setRevealLoading(false)
      }
    }
  }
  
  // Handle view mode change with 4-week gate
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === '4week' && !personalRevealed) {
      // Gate 4-week view behind personal reveal password
      setPendingViewMode('4week')
      setShowRevealModal(true)
    } else {
      setViewMode(mode)
    }
  }, [personalRevealed])
  
  const handleHidePersonal = async () => {
    if (!isMountedRef.current) return
    
    try {
      const response = await fetch('/api/personal-reveal', { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(`Failed to hide personal events: ${response.status}`)
      }
      if (isMountedRef.current) {
        setPersonalRevealed(false)
        // If currently on 4-week view, switch back to week view (since 4-week is gated)
        if (viewMode === '4week') {
          setViewMode('week')
        }
        // Refresh events to get masked data
        await fetchEvents()
      }
    } catch (error) {
      console.error('Error hiding personal events:', error)
    }
  }
  
  // Handle keyboard events for accessibility (escape to close modals)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showRevealModal) {
          setShowRevealModal(false)
          setRevealPassword('')
          setRevealError('')
          setPendingViewMode(null)
        }
        if (ignoreModalEvent) {
          setIgnoreModalEvent(null)
        }
        if (showTimezoneSelector) {
          setShowTimezoneSelector(false)
        }
        if (showIgnoredList) {
          setShowIgnoredList(false)
        }
        // Clear tooltip on escape
        if (hoveredEvent) {
          setHoveredEvent(null)
        }
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showRevealModal, ignoreModalEvent, showTimezoneSelector, showIgnoredList, hoveredEvent])
  
  // Focus trap for modals (accessibility)
  useEffect(() => {
    if (showRevealModal && revealModalRef.current) {
      const firstInput = revealModalRef.current.querySelector('input')
      firstInput?.focus()
    }
    if (ignoreModalEvent && ignoreModalRef.current) {
      const firstButton = ignoreModalRef.current.querySelector('button:not([aria-hidden="true"])')
      if (firstButton instanceof HTMLElement) {
        firstButton.focus()
      }
    }
  }, [showRevealModal, ignoreModalEvent])
  
  const handleTimezoneChange = (newTimezone: string) => {
    setTimezone(newTimezone)
    localStorage.setItem('lifesynced_timezone', newTimezone)
    setShowTimezoneSelector(false)
  }

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    window.location.href = '/login'
  }
  
  // Format event time for tooltip
  const formatEventTime = (startTime: string, endTime: string) => {
    const start = new Date(startTime)
    const end = new Date(endTime)
    const dateStr = start.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone
    })
    const startStr = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone
    })
    const endStr = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone
    })
    return { dateStr, timeStr: `${startStr} - ${endStr}` }
  }
  
  // Get source label
  const getSourceLabel = (source: string) => {
    if (source === 'graph_api' || source === 'ics') return '💼 Work (Outlook)'
    if (source === 'apple_calendar') return '🏠 Personal (iCloud)'
    return source
  }
  
  // Handle event hover
  const handleEventHover = (event: CalendarEvent, e: React.MouseEvent | null) => {
    if (!e) {
      // Toggle tooltip on click (mobile-friendly)
      if (hoveredEvent?.id === event.id) {
        setHoveredEvent(null)
      } else {
        setHoveredEvent(event)
      }
      return
    }
    
    const rect = e.currentTarget.getBoundingClientRect()
    // Position tooltip above the event, but ensure it stays within viewport
    const tooltipHeight = 200 // approximate tooltip height
    
    let y = rect.top - 10
    // If tooltip would go above viewport, show it below the event instead
    if (y - tooltipHeight < 0) {
      y = rect.bottom + 10
    }
    
    setTooltipPosition({ 
      x: Math.max(200, Math.min(window.innerWidth - 200, rect.left + rect.width / 2)), 
      y: y
    })
    setHoveredEvent(event)
  }

  const fetchEvents = useCallback(async () => {
    try {
      if (isMountedRef.current) {
        setLoading(true)
      }
      const response = await fetch('/api/events?daysAhead=30', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Failed to fetch events: ${response.status} ${response.statusText}`)
      }
      const data = await response.json()
      if (isMountedRef.current) {
        setEvents(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching events:', error)
      if (isMountedRef.current) {
        setEvents([])
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const fetchIgnoredBaseIds = useCallback(async () => {
    try {
      const response = await fetch('/api/ignored-base-ids', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Failed to fetch ignored base IDs: ${response.status} ${response.statusText}`)
      }
      const data = await response.json()
      if (Array.isArray(data) && isMountedRef.current) {
        const baseIds = new Set<string>()
        const seriesList: Array<{base_id: string, subject: string}> = []
        for (const item of data) {
          if (item && typeof item === 'object' && 'base_id' in item && typeof item.base_id === 'string') {
            baseIds.add(item.base_id)
            seriesList.push({
              base_id: item.base_id,
              subject: typeof item.subject === 'string' ? item.subject : ''
            })
          }
        }
        setIgnoredBaseIds(baseIds)
        setIgnoredSeriesList(seriesList)
      }
    } catch (error) {
      console.error('Error fetching ignored base IDs:', error)
      if (isMountedRef.current) {
        setIgnoredBaseIds(new Set())
        setIgnoredSeriesList([])
      }
    }
  }, [])

  const fetchIgnoredEventIds = useCallback(async () => {
    try {
      const response = await fetch('/api/ignored-event-ids', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Failed to fetch ignored event IDs: ${response.status} ${response.statusText}`)
      }
      const data = await response.json()
      if (Array.isArray(data) && isMountedRef.current) {
        const eventIds = new Set<string>()
        const occurrencesList: Array<{event_id: string, subject: string, start_time: string}> = []
        for (const item of data) {
          if (item && typeof item === 'object' && 'event_id' in item && typeof item.event_id === 'string') {
            eventIds.add(item.event_id)
            occurrencesList.push({
              event_id: item.event_id,
              subject: typeof item.subject === 'string' ? item.subject : '',
              start_time: typeof item.start_time === 'string' ? item.start_time : ''
            })
          }
        }
        setIgnoredEventIds(eventIds)
        setIgnoredOccurrencesList(occurrencesList)
      }
    } catch (error) {
      console.error('Error fetching ignored event IDs:', error)
      if (isMountedRef.current) {
        setIgnoredEventIds(new Set())
        setIgnoredOccurrencesList([])
      }
    }
  }, [])

  const handleRefresh = async () => {
    if (!isMountedRef.current) return
    
    try {
      setSyncStatus('Syncing calendars...')
      const response = await fetch('/api/sync', { method: 'POST' })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Sync failed: ${response.status}`)
      }
      await fetchEvents()
      if (isMountedRef.current) {
        setSyncStatus('Sync completed')
        const timeoutId = setTimeout(() => {
          if (isMountedRef.current) {
            setSyncStatus('')
          }
        }, 3000)
        return () => clearTimeout(timeoutId)
      }
    } catch (error) {
      if (isMountedRef.current) {
        const errorMessage = error instanceof Error ? error.message : 'Sync failed'
        setSyncStatus(`Sync failed: ${errorMessage}`)
      }
    }
  }

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone
    })
  }

  const formatDateRange = () => {
    const dates = getWeekDates()
    if (dates.length === 0) return ''
    const start = dates[0]
    const end = dates[dates.length - 1]
    const startMonth = start.toLocaleDateString('en-US', { month: 'long', timeZone: timezone })
    const endMonth = end.toLocaleDateString('en-US', { month: 'long', timeZone: timezone })
    const year = end.getFullYear()
    
    if (startMonth === endMonth) {
      return `${startMonth} ${start.getDate()} - ${end.getDate()}, ${year}`
    }
    return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}, ${year}`
  }

  const getBaseIdFromEventId = (eventId: string): string => {
    // Extract base ID from event ID (handles {base_id}_{timestamp} format)
    // Timestamp format: YYYYMMDDTHHMMSS (e.g., 20251201T150000)
    if (eventId.includes('_')) {
      const parts = eventId.split('_')
      const lastPart = parts[parts.length - 1]
      // Check: 8 digits + 'T' + 6 digits = 15 chars total
      if (lastPart.length === 15 && /^\d{8}T\d{6}$/.test(lastPart)) {
        return parts.slice(0, -1).join('_')
      }
    }
    return eventId
  }

  // Check if an event is part of a recurring series (has timestamp suffix)
  const isEventRecurring = (eventId: string): boolean => {
    if (eventId.includes('_')) {
      const parts = eventId.split('_')
      const lastPart = parts[parts.length - 1]
      return lastPart.length === 15 && /^\d{8}T\d{6}$/.test(lastPart)
    }
    return false
  }

  // Show the ignore modal for choosing occurrence vs series
  const showIgnoreModal = (event: CalendarEvent) => {
    setIsRecurringEvent(isEventRecurring(event.id))
    setIgnoreModalEvent(event)
  }

  // Ignore a specific occurrence only
  const ignoreOccurrence = async (event: CalendarEvent) => {
    if (!isMountedRef.current) return
    
    try {
      const response = await fetch('/api/ignored-event-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          event_id: event.id, 
          subject: event.subject,
          start_time: event.start_time
        })
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to ignore occurrence: ${response.status}`)
      }
      await fetchIgnoredEventIds()
      await fetchEvents()
    } catch (error) {
      console.error('Error ignoring occurrence:', error)
    } finally {
      if (isMountedRef.current) {
        setIgnoreModalEvent(null)
      }
    }
  }

  // Ignore the entire series
  const ignoreSeries = async (event: CalendarEvent) => {
    if (!isMountedRef.current) return
    
    const baseId = getBaseIdFromEventId(event.id)
    try {
      const response = await fetch('/api/ignored-base-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_id: baseId, subject: event.subject })
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to ignore series: ${response.status}`)
      }
      await fetchIgnoredBaseIds()
      await fetchEvents()
    } catch (error) {
      console.error('Error ignoring series:', error)
    } finally {
      if (isMountedRef.current) {
        setIgnoreModalEvent(null)
      }
    }
  }

  // Handle ignore button click - show modal for recurring, direct ignore for non-recurring
  const ignoreEvent = (event: CalendarEvent) => {
    if (isEventRecurring(event.id)) {
      showIgnoreModal(event)
    } else {
      ignoreSeries(event)
    }
  }

  const unignoreBaseId = async (baseId: string) => {
    if (!isMountedRef.current) return
    
    try {
      const response = await fetch('/api/ignored-base-ids?base_id=' + encodeURIComponent(baseId), {
        method: 'DELETE'
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to unignore series: ${response.status}`)
      }
      await fetchIgnoredBaseIds()
      await fetchEvents()
    } catch (error) {
      console.error('Error unignoring series:', error)
    }
  }

  const unignoreEventId = async (eventId: string) => {
    if (!isMountedRef.current) return
    
    try {
      const response = await fetch('/api/ignored-event-ids?event_id=' + encodeURIComponent(eventId), {
        method: 'DELETE'
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to unignore occurrence: ${response.status}`)
      }
      await fetchIgnoredEventIds()
      await fetchEvents()
    } catch (error) {
      console.error('Error unignoring occurrence:', error)
    }
  }

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {}
    if (!Array.isArray(events)) return grouped
    
    events.forEach(event => {
      if (!event || !event.id || !event.start_time) return
      
      const baseId = getBaseIdFromEventId(event.id)
      if (ignoredBaseIds.has(baseId)) return
      
      // Use the selected timezone for date grouping
      try {
        const date = new Date(event.start_time)
        if (isNaN(date.getTime())) return // Invalid date
        
        const dateStr = date.toLocaleDateString('en-CA', { timeZone: timezone }) // en-CA gives YYYY-MM-DD format
        if (!dateStr) return
        
        if (!grouped[dateStr]) grouped[dateStr] = []
        grouped[dateStr].push(event)
      } catch (error) {
        console.error('Error processing event date:', error, event)
      }
    })
    
    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => {
        try {
          const timeA = new Date(a.start_time).getTime()
          const timeB = new Date(b.start_time).getTime()
          return timeA - timeB
        } catch {
          return 0
        }
      })
    })
    
    return grouped
  }, [events, ignoredBaseIds, timezone])

  const getOverlappingEventIds = useMemo(() => {
    if (!detectOverlap) return new Set<string>()
    if (!Array.isArray(events)) return new Set<string>()
    
    // Helper to check if an event is ignored
    const isEventIgnored = (event: CalendarEvent) => {
      if (!event || !event.id) return true // Treat invalid events as ignored
      // Check if specific event ID is ignored
      if (ignoredEventIds.has(event.id)) return true
      // Check if base ID (entire series) is ignored
      const baseId = getBaseIdFromEventId(event.id)
      if (ignoredBaseIds.has(baseId)) return true
      return false
    }
    
    // Helper to check if an event is all-day or multi-day [Free]
    // These should be excluded from overlap detection (for personal calendars)
    const isAllDayOrMultiDayFree = (event: CalendarEvent) => {
      if (!event || !event.start_time || !event.end_time) return false
      // Only filter [Free] or Free events
      if (event.subject !== '[Free]' && event.subject !== 'Free') return false
      
      // Check if all-day
      if (event.is_all_day) return true
      
      // Check if multi-day (24+ hours)
      try {
        const start = new Date(event.start_time).getTime()
        const end = new Date(event.end_time).getTime()
        if (isNaN(start) || isNaN(end)) return false
        const durationHours = (end - start) / (1000 * 60 * 60)
        return durationHours >= 24
      } catch {
        return false
      }
    }
    
    // Filter out ignored events and all-day/multi-day [Free] from overlap detection
    // Note: Overlap detection is ONLY between Personal and Work calendars (not within same type)
    const personalEvents = events.filter(e => 
      e && e.id && e.start_time && e.end_time &&
      e.source === 'apple_calendar' && 
      !isEventIgnored(e) && 
      !isAllDayOrMultiDayFree(e)
    )
    const workEvents = events.filter(e => 
      e && e.id && e.start_time && e.end_time &&
      (e.source === 'graph_api' || e.source === 'ics') && 
      !isEventIgnored(e)
    )
    
    const overlappingIds = new Set<string>()
    
    // Only detect overlap between Personal and Work events
    personalEvents.forEach(personalEvent => {
      workEvents.forEach(workEvent => {
        try {
          const personalStart = new Date(personalEvent.start_time).getTime()
          const personalEnd = new Date(personalEvent.end_time).getTime()
          const workStart = new Date(workEvent.start_time).getTime()
          const workEnd = new Date(workEvent.end_time).getTime()
          
          if (isNaN(personalStart) || isNaN(personalEnd) || isNaN(workStart) || isNaN(workEnd)) {
            return // Skip invalid dates
          }
          
          if ((personalStart < workEnd && personalEnd > workStart)) {
            overlappingIds.add(personalEvent.id)
            overlappingIds.add(workEvent.id)
          }
        } catch (error) {
          console.error('Error calculating overlap:', error, personalEvent, workEvent)
        }
      })
    })
    
    return overlappingIds
  }, [events, detectOverlap, ignoredBaseIds, ignoredEventIds])

  const getWeekDates = () => {
    const dates: Date[] = []
    const start = new Date(weekStart)
    for (let i = 0; i < 7; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      if (!hideWeekends || (date.getDay() !== 0 && date.getDay() !== 6)) {
        dates.push(date)
      }
    }
    return dates
  }

  const getMonthDates = () => {
    const dates: Date[] = []
    const start = new Date(monthStart)
    for (let i = 0; i < 28; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      if (!hideWeekends || (date.getDay() !== 0 && date.getDay() !== 6)) {
        dates.push(date)
      }
    }
    return dates
  }

  const getEventsForDate = (date: Date): CalendarEvent[] => {
    // Format date using the selected timezone to match eventsByDate keys
    const dateKey = date.toLocaleDateString('en-CA', { timeZone: timezone }) // YYYY-MM-DD format
    return (eventsByDate[dateKey] || []).filter(e => {
      const baseId = getBaseIdFromEventId(e.id)
      return !ignoredBaseIds.has(baseId)
    }).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
  }

  const navigateWeek = (direction: number) => {
    const newDate = new Date(weekStart)
    newDate.setDate(weekStart.getDate() + (direction * 7))
    setWeekStart(newDate)
  }

  const navigateMonth = (direction: number) => {
    const newDate = new Date(monthStart)
    newDate.setDate(monthStart.getDate() + (direction * 28))
    setMonthStart(newDate)
  }

  const navigateDay = (direction: number) => {
    const newDate = new Date(selectedDay)
    newDate.setDate(selectedDay.getDate() + direction)
    setSelectedDay(newDate)
  }

  const goToToday = () => {
    const today = new Date()
    setSelectedDay(today)
    const day = today.getDay()
    const diff = today.getDate() - day
    setWeekStart(new Date(new Date().setDate(diff)))
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
    const firstDayOfWeek = firstDay.getDay()
    const firstDiff = firstDay.getDate() - firstDayOfWeek
    setMonthStart(new Date(firstDay.setDate(firstDiff)))
  }

  const isToday = (date: Date) => {
    const today = new Date()
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear()
  }

  const overlapCount = useMemo(() => {
    if (!detectOverlap) return 0
    return getOverlappingEventIds.size
  }, [detectOverlap, getOverlappingEventIds])

  const formatDayHeader = (date: Date) => {
    const dayNum = date.getDate()
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone })
    return { dayNum, dayName }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xl text-gray-600">Loading calendar events...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-4 md:p-6 safe-area-inset">
      <div className="max-w-[98vw] mx-auto" ref={mainContentRef} role="main" aria-label="LifeSynced Calendar">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          {/* Title and View Mode */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-4 mb-3 sm:mb-4">
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900">LifeSynced</h1>
              <div className="flex items-center gap-2 sm:gap-3 mt-1">
                <p className="text-sm sm:text-base text-gray-500">{events.length} events</p>
                <span className="text-gray-300">•</span>
              <button
                  onClick={() => setShowTimezoneSelector(!showTimezoneSelector)}
                  className="flex items-center gap-1 sm:gap-1.5 text-gray-500 hover:text-gray-700 transition-colors"
                  title="Change timezone"
                >
                  <span className="text-xs sm:text-sm">🌐</span>
                  <span className="text-xs sm:text-sm font-medium">{getCurrentTimezoneLabel()}</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
              </button>
              </div>
            </div>
            
            {/* View Mode Buttons */}
            <div 
              className="flex gap-0.5 sm:gap-1 bg-gray-100 p-0.5 sm:p-1 rounded-lg self-start overflow-x-auto"
              role="tablist"
              aria-label="Calendar view options"
            >
              {(['day', 'week', '4week'] as ViewMode[]).map((mode) => {
                const isLocked = mode === '4week' && !personalRevealed
                return (
                  <button
                    key={mode}
                    onClick={() => handleViewModeChange(mode)}
                    role="tab"
                    aria-selected={viewMode === mode}
                    aria-label={mode === '4week' 
                      ? (isLocked ? '4-Week view (requires password)' : '4-Week view') 
                      : `${mode.charAt(0).toUpperCase() + mode.slice(1)} view`}
                    className={`px-2.5 sm:px-4 md:px-5 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1 ${
                      viewMode === mode 
                        ? 'bg-white text-gray-900 shadow-sm' 
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {mode === '4week' && isLocked && <span className="text-[10px] sm:text-xs">🔒</span>}
                    {mode === '4week' ? '4-Week' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                )
              })}
            </div>
          </div>
          
          {/* Action Buttons Row */}
          <div 
            className="flex gap-2 sm:gap-3 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0 sm:overflow-visible sm:flex-wrap items-center scrollbar-hide"
            role="toolbar"
            aria-label="Calendar controls"
          >
            <button
              onClick={handleRefresh}
              aria-label="Refresh calendar data"
              className="px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-200 text-gray-700 rounded-full hover:bg-gray-50 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium shadow-sm whitespace-nowrap flex-shrink-0 focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            >
              <span aria-hidden="true">🔄</span>
              <span className="hidden xs:inline">Refresh</span>
            </button>
            
            {(viewMode === 'week' || viewMode === '4week') && (
              <label className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-200 rounded-full cursor-pointer hover:bg-gray-50 text-xs sm:text-sm text-gray-700 font-medium shadow-sm whitespace-nowrap flex-shrink-0 focus-within:ring-2 focus-within:ring-blue-400 focus-within:ring-offset-2">
                <input
                  type="checkbox"
                  checked={hideWeekends}
                  onChange={(e) => setHideWeekends(e.target.checked)}
                  aria-label="Hide weekend days"
                  className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="hidden sm:inline">Hide Weekends</span>
                <span className="sm:hidden">Weekends</span>
              </label>
            )}
            
            <button
              onClick={() => setDetectOverlap(!detectOverlap)}
              aria-pressed={detectOverlap}
              aria-label={detectOverlap ? 'Overlap detection enabled - click to disable' : 'Enable overlap detection between work and personal events'}
              className={`px-4 sm:px-5 py-2.5 sm:py-3 rounded-full flex items-center gap-2 sm:gap-2.5 text-sm sm:text-base font-semibold shadow-md transition-all whitespace-nowrap flex-shrink-0 transform hover:scale-[1.02] active:scale-[0.98] ${
                detectOverlap 
                  ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 border-2 border-orange-400 shadow-orange-200 ring-2 ring-orange-300 ring-offset-1' 
                  : 'bg-gradient-to-r from-amber-50 to-orange-50 text-orange-700 border-2 border-orange-300 hover:border-orange-400 hover:from-amber-100 hover:to-orange-100 shadow-orange-100'
              }`}
            >
              <span className="text-base sm:text-lg" aria-hidden="true">⚠️</span>
              <span className="hidden sm:inline">Detect Overlap</span>
              <span className="sm:hidden">Overlap</span>
              {detectOverlap && overlapCount > 0 && (
                <span className="bg-white/30 text-white px-1.5 py-0.5 rounded-full text-xs font-bold" aria-label={`${overlapCount} conflicts found`}>
                  {overlapCount}
                </span>
              )}
            </button>
            
            <button
              onClick={() => setShowIgnoredList(!showIgnoredList)}
              aria-expanded={showIgnoredList}
              aria-label={`${showIgnoredList ? 'Hide' : 'Show'} ignored events list (${ignoredSeriesList.length + ignoredOccurrencesList.length} ignored)`}
              className="px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-200 rounded-full hover:bg-gray-50 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium text-gray-700 shadow-sm whitespace-nowrap flex-shrink-0 focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            >
              <span aria-hidden="true">👁️</span>
              <span className="hidden sm:inline">Ignored Events</span>
              <span className="sm:hidden">Ignored</span>
              <span aria-hidden="true">({ignoredSeriesList.length + ignoredOccurrencesList.length})</span>
            </button>
            
            {/* Personal Events Reveal Toggle - always show since events are masked by default */}
            {/* Also gates 4-week view access */}
            <button
              onClick={() => {
                if (personalRevealed) {
                  handleHidePersonal()
                } else if (canRevealPersonal) {
                  setShowRevealModal(true)
                }
              }}
              disabled={!personalRevealed && !canRevealPersonal}
              aria-pressed={personalRevealed}
              aria-label={personalRevealed 
                ? 'Personal events revealed and 4-week view unlocked. Click to hide and lock.' 
                : canRevealPersonal 
                  ? 'Personal events hidden and 4-week view locked. Click to reveal.' 
                  : 'Personal reveal password not configured on server.'}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-full flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium shadow-sm transition-all whitespace-nowrap flex-shrink-0 focus:ring-2 focus:ring-green-400 focus:ring-offset-2 ${
                personalRevealed 
                  ? 'bg-green-500 text-white hover:bg-green-600 border border-green-500' 
                  : !canRevealPersonal
                    ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span aria-hidden="true">{personalRevealed ? '🔓' : '🔒'}</span>
              <span className="hidden sm:inline">{personalRevealed ? 'Personal Revealed' : 'Personal Hidden'}</span>
              <span className="sm:hidden">{personalRevealed ? 'Revealed' : 'Hidden'}</span>
            </button>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              aria-label="Sign out of LifeSynced"
              className="px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-200 text-gray-500 rounded-full hover:bg-gray-50 hover:text-gray-700 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium shadow-sm whitespace-nowrap flex-shrink-0 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
            >
              <span aria-hidden="true">🚪</span>
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
          
          {syncStatus && (
            <div className={`mt-3 p-3 rounded-lg ${syncStatus.includes('failed') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
              {syncStatus}
            </div>
          )}
          
          {/* Timezone Selector Dropdown */}
          {showTimezoneSelector && (
            <div className="mt-3 p-3 sm:p-4 bg-white rounded-xl shadow-lg border border-gray-200 max-w-full sm:max-w-md">
              <div className="flex justify-between items-center mb-2 sm:mb-3">
                <h3 className="text-xs sm:text-sm font-semibold text-gray-900">Select Timezone</h3>
                <button 
                  onClick={() => setShowTimezoneSelector(false)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  ✕
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2 sm:mb-3">
                Change when traveling to see events in your current timezone.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
                {timezoneOptions.map((tz) => (
                  <button
                    key={tz.value}
                    onClick={() => handleTimezoneChange(tz.value)}
                    className={`px-2 sm:px-3 py-1.5 sm:py-2 text-left text-xs sm:text-sm rounded-lg transition-all ${
                      timezone === tz.value
                        ? 'bg-blue-500 text-white font-medium'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <div className="font-medium">{tz.short}</div>
                    <div className={`text-[10px] sm:text-xs truncate ${timezone === tz.value ? 'text-blue-100' : 'text-gray-500'}`}>
                      {tz.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Ignored Events Panel */}
        {showIgnoredList && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-5 bg-white rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-gray-900">Ignored Events</h2>
            
            {/* Ignored Series Section */}
            <div className="mb-3 sm:mb-4">
              <h3 className="text-xs sm:text-sm font-medium text-gray-600 mb-2">Ignored Series</h3>
              {ignoredSeriesList.length === 0 ? (
                <p className="text-gray-400 text-xs sm:text-sm italic">No ignored series</p>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {ignoredSeriesList.map((item) => (
                    <div key={item.base_id} className="flex justify-between items-center gap-2 p-2 sm:p-3 bg-gray-50 rounded-lg">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 text-sm sm:text-base truncate">{item.subject}</div>
                        <div className="text-[10px] sm:text-xs text-gray-500 font-mono truncate">{item.base_id.substring(0, 20)}...</div>
                    </div>
                    <button
                      onClick={() => unignoreBaseId(item.base_id)}
                        className="px-2.5 sm:px-4 py-1 sm:py-1.5 bg-blue-500 text-white rounded-full text-xs sm:text-sm hover:bg-blue-600 font-medium flex-shrink-0"
                    >
                      Unignore
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
            
            {/* Ignored Specific Occurrences Section */}
            <div>
              <h3 className="text-xs sm:text-sm font-medium text-gray-600 mb-2">Single Occurrences</h3>
              {ignoredOccurrencesList.length === 0 ? (
                <p className="text-gray-400 text-xs sm:text-sm italic">No ignored occurrences</p>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {ignoredOccurrencesList.map((item) => (
                    <div key={item.event_id} className="flex justify-between items-center gap-2 p-2 sm:p-3 bg-gray-50 rounded-lg">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 text-sm sm:text-base truncate">{item.subject}</div>
                        <div className="text-[10px] sm:text-xs text-gray-500">
                          {new Date(item.start_time).toLocaleString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZone: timezone
                          })}
                        </div>
                      </div>
                      <button
                        onClick={() => unignoreEventId(item.event_id)}
                        className="px-2.5 sm:px-4 py-1 sm:py-1.5 bg-blue-500 text-white rounded-full text-xs sm:text-sm hover:bg-blue-600 font-medium flex-shrink-0"
                      >
                        Unignore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Week View */}
        {viewMode === 'week' && (() => {
          const weekDates = getWeekDates()
          const hours = Array.from({ length: 25 }, (_, i) => i) // 0 (midnight) to 24
          
          // Calculate event layout with side-by-side positioning for overlapping events
          const calculateEventLayout = (events: CalendarEvent[]) => {
            const gridStartHour = 0
            const gridEndHour = 24
            const gridHeight = gridEndHour - gridStartHour
            
            // Helper to get hours in the selected timezone
            const getHoursInTimezone = (dateStr: string) => {
              const date = new Date(dateStr)
              // Use Intl.DateTimeFormat to get hours in the selected timezone
              const formatter = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: 'numeric',
                hour12: false,
                timeZone: timezone
              })
              const parts = formatter.formatToParts(date)
              const hourPart = parts.find(p => p.type === 'hour')
              const minutePart = parts.find(p => p.type === 'minute')
              const hours = parseInt(hourPart?.value || '0', 10)
              const minutes = parseInt(minutePart?.value || '0', 10)
              return hours + minutes / 60
            }
            
            // Convert events to time slots
            const slots = events.map(event => {
              const startHour = getHoursInTimezone(event.start_time)
              const endHour = getHoursInTimezone(event.end_time)
              return {
                event,
                startHour: Math.max(gridStartHour, Math.min(gridEndHour, startHour)),
                endHour: Math.max(gridStartHour, Math.min(gridEndHour, endHour)),
                column: 0,
                totalColumns: 1
              }
            })
            
            // Sort by start time, then by end time (longer events first)
            slots.sort((a, b) => {
              if (a.startHour !== b.startHour) return a.startHour - b.startHour
              return b.endHour - a.endHour
            })
            
            // Find overlapping groups and assign columns
            const groups: typeof slots[] = []
            
            for (const slot of slots) {
              // Find a group this slot overlaps with
              let foundGroup = false
              for (const group of groups) {
                const overlapsGroup = group.some(g => 
                  slot.startHour < g.endHour && slot.endHour > g.startHour
                )
                if (overlapsGroup) {
                  // Find the first available column
                  let col = 0
                  while (true) {
                    const columnTaken = group.some(g => 
                      g.column === col && 
                      slot.startHour < g.endHour && 
                      slot.endHour > g.startHour
                    )
                    if (!columnTaken) break
                    col++
                  }
                  slot.column = col
                  group.push(slot)
                  foundGroup = true
                  break
                }
              }
              if (!foundGroup) {
                slot.column = 0
                groups.push([slot])
              }
            }
            
            // Calculate total columns for each group
            for (const group of groups) {
              const maxCol = Math.max(...group.map(s => s.column)) + 1
              for (const slot of group) {
                slot.totalColumns = maxCol
              }
            }
            
            // Convert to layout info
            const layout = new Map<string, { top: string; height: string; left: string; width: string }>()
            for (const slot of slots) {
              const topPercent = ((slot.startHour - gridStartHour) / gridHeight) * 100
              const heightPercent = ((slot.endHour - slot.startHour) / gridHeight) * 100
              const widthPercent = 100 / slot.totalColumns
              const leftPercent = slot.column * widthPercent
              
              layout.set(slot.event.id, {
                top: `${topPercent}%`,
                height: `${Math.max(heightPercent, 2)}%`,
                left: `${leftPercent}%`,
                width: `${widthPercent}%`
              })
            }
            
            return layout
          }

          return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Overlap Banner */}
              {detectOverlap && overlapCount > 0 && (
                <div className="bg-amber-50 border-b border-amber-200 text-amber-800 px-3 sm:px-5 py-2 sm:py-3 flex items-center gap-2">
                  <span className="text-base sm:text-lg">⚠️</span>
                  <span className="font-medium text-xs sm:text-sm md:text-base">Found {overlapCount} overlapping events</span>
                </div>
              )}
              
              {/* Calendar Header with Date Range and Navigation */}
              <div className="flex justify-between items-center px-3 sm:px-5 py-3 sm:py-4 border-b border-gray-100">
                <h2 className="text-sm sm:text-lg md:text-xl font-semibold text-gray-900" aria-live="polite">{formatDateRange()}</h2>
                <nav className="flex items-center gap-1 sm:gap-2" aria-label="Week navigation">
                  <button 
                    onClick={() => navigateWeek(-1)} 
                    aria-label="Previous week"
                    className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                  >
                    <span aria-hidden="true">←</span>
                  </button>
                  <button 
                    onClick={goToToday} 
                    aria-label="Go to today"
                    className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-gray-100 rounded-full text-gray-700 hover:bg-gray-200 font-medium text-xs sm:text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                  >
                    Today
                  </button>
                  <button 
                    onClick={() => navigateWeek(1)} 
                    aria-label="Next week"
                    className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                  >
                    <span aria-hidden="true">→</span>
                  </button>
                </nav>
              </div>
              
              {/* Scrollable Grid Container for Mobile */}
              <div className="overflow-x-auto scrollbar-hide">
                <div style={{ minWidth: `${50 + weekDates.length * 90}px` }}>
                  {/* Day Headers */}
                  <div className="grid border-b border-gray-100 sticky top-0 bg-white z-10" style={{ gridTemplateColumns: `50px repeat(${weekDates.length}, minmax(90px, 1fr))` }}>
                    <div className="p-1.5 sm:p-3 border-r border-gray-100"></div>
                    {weekDates.map((date) => {
                      const { dayNum, dayName } = formatDayHeader(date)
                      const dayEvents = getEventsForDate(date)
                      return (
                        <div 
                          key={date.toISOString()} 
                          className={`p-1.5 sm:p-3 border-r border-gray-100 ${isToday(date) ? 'bg-blue-50' : ''}`}
                        >
                          <div className={`font-semibold text-xs sm:text-base ${isToday(date) ? 'text-blue-600' : 'text-gray-900'}`}>
                            <span className="sm:hidden">{dayNum}</span>
                            <span className="hidden sm:inline">{dayNum} {dayName}</span>
                          </div>
                          <div className="text-[10px] sm:text-xs text-gray-500">{dayEvents.length}</div>
                        </div>
                      )
                    })}
                  </div>
                  
                  {/* Time Grid */}
                  <div className="relative overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)', minHeight: '500px' }}>
                    <div className="grid" style={{ gridTemplateColumns: `50px repeat(${weekDates.length}, minmax(90px, 1fr))` }}>
                      {/* Time Column */}
                      <div className="relative border-r border-gray-100" style={{ minHeight: '1440px', width: '50px' }}>
                        {hours.map((hour) => (
                          <div 
                            key={hour} 
                            className="absolute text-[10px] sm:text-xs text-gray-400 pr-1 sm:pr-2 text-right w-full"
                            style={{ top: `${(hour / 24) * 100}%`, transform: 'translateY(-50%)' }}
                          >
                            {hour.toString().padStart(2, '0')}
                          </div>
                        ))}
                      </div>
                      
                      {/* Day Columns */}
                      {weekDates.map((date) => {
                        const dayEvents = getEventsForDate(date)
                        const eventLayout = calculateEventLayout(dayEvents)
                        
                        return (
                          <div 
                            key={date.toISOString()} 
                            className={`relative border-r border-gray-100 ${isToday(date) ? 'bg-blue-50/30' : ''}`}
                            style={{ minHeight: '1440px', minWidth: '90px' }}
                          >
                            {/* Hour grid lines */}
                            {hours.map((hour) => (
                              <div 
                                key={hour} 
                                className="absolute w-full border-t border-gray-100"
                                style={{ top: `${(hour / 24) * 100}%` }}
                              />
                            ))}
                            
                            {/* Events */}
                    {dayEvents.map((event) => {
                      const isOverlapping = getOverlappingEventIds.has(event.id)
                              const layout = eventLayout.get(event.id)
                              if (!layout) return null
                              
                              const isWork = event.source === 'graph_api' || event.source === 'ics'
                              const isPersonal = event.source === 'apple_calendar'
                              
                              // Determine colors based on overlap state
                              let bgColor, borderColor, textColor
                              if (isOverlapping) {
                                bgColor = isPersonal ? 'bg-orange-100' : 'bg-orange-50'
                                borderColor = 'border-orange-400'
                                textColor = isPersonal ? 'text-orange-900' : 'text-orange-800'
                              } else if (isWork) {
                                bgColor = 'bg-blue-50'
                                borderColor = 'border-blue-200'
                                textColor = 'text-blue-900'
                              } else if (isPersonal) {
                                bgColor = 'bg-green-50'
                                borderColor = 'border-green-200'
                                textColor = 'text-green-900'
                              } else {
                                bgColor = 'bg-gray-50'
                                borderColor = 'border-gray-200'
                                textColor = 'text-gray-900'
                              }
                      
                      return (
                        <div
                          key={event.id}
                                  className={`absolute rounded-md sm:rounded-lg px-1 sm:px-1.5 py-0.5 sm:py-1 text-[10px] sm:text-xs cursor-pointer border-l-2 sm:border-l-4 ${bgColor} ${borderColor} ${textColor} ${
                                    isOverlapping ? 'ring-1 sm:ring-2 ring-orange-300 shadow-sm' : ''
                                  } ${detectOverlap && !isOverlapping ? 'opacity-40' : ''}`}
                                  onMouseEnter={(e) => handleEventHover(event, e)}
                                  onMouseLeave={() => setHoveredEvent(null)}
                                  onClick={() => handleEventHover(event, null)}
                                  style={{
                                    top: layout.top,
                                    height: layout.height,
                                    left: `calc(${layout.left} + 1px)`,
                                    width: `calc(${layout.width} - 2px)`,
                                minHeight: '24px'
                              }}
                              title={`${event.subject}\n${formatTime(event.start_time)} - ${formatTime(event.end_time)}`}
                            >
                              <div className="flex items-start justify-between h-full overflow-hidden">
                                <div className="flex-1 min-w-0 overflow-hidden">
                                  <div className="font-medium truncate">{event.subject}</div>
                                  <div className="opacity-75 truncate">
                                {formatTime(event.start_time)} - {formatTime(event.end_time)}
                              </div>
                                  {isOverlapping && (
                                    <div className="text-orange-600 font-semibold flex items-center gap-1 mt-0.5">
                                      <span>⚠️</span>
                                      <span>Overlap</span>
                                    </div>
                                  )}
                            </div>
                            <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    ignoreEvent(event)
                                  }}
                                  className="opacity-40 hover:opacity-100 text-gray-500 ml-1 flex-shrink-0"
                              title="Ignore this event"
                            >
                                  👁️
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                    )
                  })}
                </div>
          </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Day View */}
        {viewMode === 'day' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            {/* Overlap Banner */}
            {detectOverlap && overlapCount > 0 && (
              <div className="bg-amber-50 border-b border-amber-200 text-amber-800 px-3 sm:px-5 py-2 sm:py-3 flex items-center gap-2">
                <span className="text-base sm:text-lg">⚠️</span>
                <span className="font-medium text-xs sm:text-sm md:text-base">Found {overlapCount} overlapping events</span>
              </div>
            )}
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0 p-3 sm:p-4 border-b border-gray-100">
              <h2 className="text-base sm:text-xl font-semibold text-gray-900" aria-live="polite">
                <span className="sm:hidden">{selectedDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="hidden sm:inline">{selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
              </h2>
              <nav className="flex items-center gap-1 sm:gap-2" aria-label="Day navigation">
                <button onClick={() => navigateDay(-1)} aria-label="Previous day" className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"><span aria-hidden="true">←</span></button>
                <button onClick={goToToday} aria-label="Go to today" className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-gray-100 rounded-full text-gray-700 hover:bg-gray-200 font-medium text-xs sm:text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1">Today</button>
                <button onClick={() => navigateDay(1)} aria-label="Next day" className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"><span aria-hidden="true">→</span></button>
            </nav>
            </div>
            <div className="p-3 sm:p-5">
              {getEventsForDate(selectedDay).length === 0 ? (
                <p className="text-gray-500 text-sm sm:text-base">No events for this day</p>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {getEventsForDate(selectedDay).map((event) => {
                    const isOverlapping = getOverlappingEventIds.has(event.id)
                    const baseId = getBaseIdFromEventId(event.id)
                    const isIgnored = ignoredBaseIds.has(baseId)
                    if (isIgnored) return null
                    
                    const isWork = event.source === 'graph_api' || event.source === 'ics'
                    const isPersonal = event.source === 'apple_calendar'
                    
                    let bgColor, borderColor, textColor
                    if (isOverlapping) {
                      bgColor = isPersonal ? 'bg-orange-100' : 'bg-orange-50'
                      borderColor = 'border-orange-400'
                      textColor = isPersonal ? 'text-orange-900' : 'text-orange-800'
                    } else if (isWork) {
                      bgColor = 'bg-blue-50'
                      borderColor = 'border-blue-200'
                      textColor = 'text-blue-900'
                    } else if (isPersonal) {
                      bgColor = 'bg-green-50'
                      borderColor = 'border-green-200'
                      textColor = 'text-green-900'
                    } else {
                      bgColor = 'bg-gray-50'
                      borderColor = 'border-gray-200'
                      textColor = 'text-gray-900'
                    }
                    
                    return (
                      <div
                        key={event.id}
                        className={`p-2.5 sm:p-3 rounded-lg border-l-3 sm:border-l-4 ${bgColor} ${borderColor} ${textColor} ${
                          detectOverlap && !isOverlapping ? 'opacity-40' : ''
                        } ${isOverlapping ? 'ring-1 sm:ring-2 ring-orange-300' : ''} cursor-pointer`}
                        onMouseEnter={(e) => handleEventHover(event, e)}
                        onMouseLeave={() => setHoveredEvent(null)}
                        onClick={() => handleEventHover(event, null)}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm sm:text-base truncate">{event.subject}</div>
                            <div className="text-xs sm:text-sm opacity-75">
                              {formatTime(event.start_time)} - {formatTime(event.end_time)}
                            </div>
                            {isOverlapping && (
                              <div className="text-[10px] sm:text-xs text-orange-600 font-semibold mt-1 flex items-center gap-1">
                                <span>⚠️</span>
                                <span>Overlap</span>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); ignoreEvent(event); }}
                            className="opacity-40 hover:opacity-100 text-gray-500 p-1 flex-shrink-0"
                            title="Ignore this event"
                          >
                            👁️
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4-Week View */}
        {viewMode === '4week' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            {/* Overlap Banner */}
            {detectOverlap && overlapCount > 0 && (
              <div className="bg-amber-50 border-b border-amber-200 text-amber-800 px-3 sm:px-5 py-2 sm:py-3 flex items-center gap-2">
                <span className="text-base sm:text-lg">⚠️</span>
                <span className="font-medium text-xs sm:text-sm md:text-base">Found {overlapCount} overlapping events</span>
              </div>
            )}
            
            <div className="flex justify-between items-center p-3 sm:p-4 border-b border-gray-100">
              <h2 className="text-base sm:text-xl font-semibold text-gray-900" aria-live="polite">4-Week View</h2>
              <nav className="flex items-center gap-1 sm:gap-2" aria-label="4-week navigation">
                <button onClick={() => navigateMonth(-1)} aria-label="Previous 4 weeks" className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"><span aria-hidden="true">←</span></button>
                <button onClick={goToToday} aria-label="Go to today" className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-gray-100 rounded-full text-gray-700 hover:bg-gray-200 font-medium text-xs sm:text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1">Today</button>
                <button onClick={() => navigateMonth(1)} aria-label="Next 4 weeks" className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"><span aria-hidden="true">→</span></button>
            </nav>
                  </div>
            <div className={`grid gap-1 sm:gap-2 p-2 sm:p-4 ${hideWeekends ? 'grid-cols-5' : 'grid-cols-7'}`}>
              {getMonthDates().map((date) => {
                const dayEvents = getEventsForDate(date)
                return (
                  <div 
                    key={date.toISOString()} 
                    className={`min-h-[100px] sm:min-h-[180px] p-1 sm:p-2 rounded-lg border ${isToday(date) ? 'bg-blue-50 border-blue-300' : 'border-gray-200'}`}
                  >
                    <div className={`font-semibold text-[10px] sm:text-sm mb-1 sm:mb-2 ${isToday(date) ? 'text-blue-600' : 'text-gray-900'}`}>
                      <span className="sm:hidden">{date.getDate()}</span>
                      <span className="hidden sm:inline">{date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="space-y-0.5 sm:space-y-1">
                      {dayEvents.slice(0, 3).map((event) => {
                      const isOverlapping = getOverlappingEventIds.has(event.id)
                        const isWork = event.source === 'graph_api' || event.source === 'ics'
                        const isPersonal = event.source === 'apple_calendar'
                        
                        let bgColor, borderColor, textColor
                        if (isOverlapping) {
                          bgColor = isPersonal ? 'bg-orange-100' : 'bg-orange-50'
                          borderColor = 'border-orange-400'
                          textColor = isPersonal ? 'text-orange-900' : 'text-orange-800'
                        } else if (isWork) {
                          bgColor = 'bg-blue-50'
                          borderColor = 'border-blue-200'
                          textColor = 'text-blue-900'
                        } else if (isPersonal) {
                          bgColor = 'bg-green-50'
                          borderColor = 'border-green-200'
                          textColor = 'text-green-900'
                        } else {
                          bgColor = 'bg-gray-50'
                          borderColor = 'border-gray-200'
                          textColor = 'text-gray-900'
                        }
                      
                      return (
                        <div
                          key={event.id}
                            className={`p-0.5 sm:p-1.5 text-[9px] sm:text-xs rounded border-l-1 sm:border-l-2 ${bgColor} ${borderColor} ${textColor} ${
                              detectOverlap && !isOverlapping ? 'opacity-40' : ''
                            } ${isOverlapping ? 'ring-1 ring-orange-300' : ''} cursor-pointer`}
                          onMouseEnter={(e) => handleEventHover(event, e)}
                          onMouseLeave={() => setHoveredEvent(null)}
                          onClick={() => handleEventHover(event, null)}
                        >
                            <div className="font-medium truncate">{event.subject}</div>
                            {isOverlapping && <div className="text-orange-600 text-[8px] sm:text-[10px]">⚠️</div>}
                        </div>
                      )
                    })}
                      {dayEvents.length > 3 && (
                        <div className="text-[9px] sm:text-xs text-gray-500 pl-0.5 sm:pl-1">+{dayEvents.length - 3}</div>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Event Details Tooltip */}
        {hoveredEvent && (
          <div 
            className="fixed z-50 pointer-events-none px-2 sm:px-0"
            style={{ 
              left: Math.min(Math.max(tooltipPosition.x, 150), window.innerWidth - 150),
              top: tooltipPosition.y,
              transform: 'translate(-50%, -100%)'
            }}
          >
            <div className="bg-gray-900 text-white rounded-lg shadow-xl p-3 sm:p-4 max-w-[280px] sm:max-w-sm">
              <div className="font-semibold text-base mb-2">{hoveredEvent.subject}</div>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">📅</span>
                  <span>{formatEventTime(hoveredEvent.start_time, hoveredEvent.end_time).dateStr}</span>
              </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">🕐</span>
                  <span>{formatEventTime(hoveredEvent.start_time, hoveredEvent.end_time).timeStr}</span>
            </div>
                {hoveredEvent.location && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">📍</span>
                    <span className="truncate">{hoveredEvent.location}</span>
                  </div>
                )}
                {hoveredEvent.organizer_name && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">👤</span>
                    <span>{hoveredEvent.organizer_name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1 border-t border-gray-700 mt-2">
                  <span>{getSourceLabel(hoveredEvent.source)}</span>
                </div>
              </div>
              {/* Tooltip arrow */}
              <div className="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-full">
                <div className="border-8 border-transparent border-t-gray-900"></div>
              </div>
            </div>
          </div>
        )}

        {/* Ignore Choice Modal */}
        {ignoreModalEvent && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ignore-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIgnoreModalEvent(null)
              }
            }}
          >
            <div 
              ref={ignoreModalRef}
              className="bg-white rounded-t-xl sm:rounded-xl shadow-xl p-4 sm:p-6 max-w-md w-full"
            >
              <h3 id="ignore-modal-title" className="text-base sm:text-lg font-semibold text-gray-900 mb-2">Ignore Event</h3>
              <p className="text-gray-600 mb-3 sm:mb-4 text-sm sm:text-base truncate">
                &ldquo;{ignoreModalEvent.subject}&rdquo;
              </p>
              
              {isRecurringEvent ? (
                <div className="space-y-2 sm:space-y-3" role="group" aria-label="Ignore options">
                  <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-4">
                    This event is part of a recurring series. What would you like to ignore?
                  </p>
                  <button
                    onClick={() => ignoreOccurrence(ignoreModalEvent)}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 active:bg-gray-200 font-medium text-left focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                  >
                    <div className="font-medium text-sm sm:text-base">This occurrence only</div>
                    <div className="text-xs sm:text-sm text-gray-500">
                      {new Date(ignoreModalEvent.start_time).toLocaleString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZone: timezone
                      })}
                  </div>
                  </button>
                  <button
                    onClick={() => ignoreSeries(ignoreModalEvent)}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-blue-50 text-blue-800 rounded-lg hover:bg-blue-100 active:bg-blue-100 font-medium text-left border border-blue-200 focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                  >
                    <div className="font-medium text-sm sm:text-base">Entire series</div>
                    <div className="text-xs sm:text-sm text-blue-600">All past and future occurrences</div>
                  </button>
                </div>
              ) : (
                <div className="space-y-2 sm:space-y-3">
                  <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-4">
                    Are you sure you want to ignore this event?
                  </p>
                  <button
                    onClick={() => ignoreSeries(ignoreModalEvent)}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:bg-blue-600 font-medium text-sm sm:text-base focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                  >
                    Ignore Event
                  </button>
                </div>
              )}
              
              <button
                onClick={() => setIgnoreModalEvent(null)}
                className="w-full mt-2 sm:mt-3 px-4 py-2 text-gray-600 hover:text-gray-800 font-medium text-sm sm:text-base focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Personal Events Reveal Modal */}
        {showRevealModal && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reveal-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowRevealModal(false)
                setRevealPassword('')
                setRevealError('')
                setPendingViewMode(null)
              }
            }}
          >
            <div 
              ref={revealModalRef}
              className="bg-white rounded-t-xl sm:rounded-xl shadow-xl p-4 sm:p-6 max-w-md w-full"
            >
              <h3 id="reveal-modal-title" className="text-base sm:text-lg font-semibold text-gray-900 mb-2">
                {pendingViewMode === '4week' ? 'Unlock 4-Week View' : 'Reveal Personal Events'}
              </h3>
              <p className="text-gray-600 mb-4 text-sm">
                {pendingViewMode === '4week' 
                  ? 'The 4-week view requires authentication. Enter the reveal password to unlock both 4-week view and personal event details.'
                  : 'Enter the reveal password to see personal calendar event names. This also unlocks the 4-week view.'}
              </p>
              
              <form onSubmit={handleRevealSubmit} className="space-y-4">
                <div>
                  <label htmlFor="reveal-password" className="sr-only">Reveal password</label>
                  <input
                    id="reveal-password"
                    type="password"
                    value={revealPassword}
                    onChange={(e) => setRevealPassword(e.target.value)}
                    placeholder="Reveal password"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all text-base bg-white placeholder-gray-400"
                    style={{ color: '#111827', WebkitTextFillColor: '#111827' }}
                    autoFocus
                    aria-describedby={revealError ? 'reveal-error' : undefined}
                  />
                </div>
                
                {revealError && (
                  <p id="reveal-error" className="text-red-500 text-sm" role="alert">{revealError}</p>
                )}
                
                <button
                  type="submit"
                  disabled={revealLoading || !revealPassword}
                  className="w-full px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium transition-colors focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                >
                  {revealLoading ? 'Verifying...' : (pendingViewMode === '4week' ? 'Unlock & Reveal' : 'Reveal Events')}
                </button>
              </form>
              
              <button
                onClick={() => {
                  setShowRevealModal(false)
                  setRevealPassword('')
                  setRevealError('')
                  setPendingViewMode(null)
                }}
                className="w-full mt-3 px-4 py-2 text-gray-600 hover:text-gray-800 font-medium focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
