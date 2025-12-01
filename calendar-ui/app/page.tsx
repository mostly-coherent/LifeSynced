'use client'

import { useState, useEffect, useMemo } from 'react'

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
  
  // Hover tooltip state
  const [hoveredEvent, setHoveredEvent] = useState<CalendarEvent | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  
  // Timezone state
  const [timezone, setTimezone] = useState<string>('America/Los_Angeles')
  const [showTimezoneSelector, setShowTimezoneSelector] = useState(false)
  
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

  useEffect(() => {
    // Set default view mode based on screen size (mobile = Day, desktop = Week)
    setViewMode(getDefaultViewMode())
    
    fetchEvents()
    fetchIgnoredBaseIds()
    fetchIgnoredEventIds()
    // Load saved timezone from localStorage
    const savedTimezone = localStorage.getItem('lifesynced_timezone')
    if (savedTimezone) {
      setTimezone(savedTimezone)
    }
  }, [])
  
  const handleTimezoneChange = (newTimezone: string) => {
    setTimezone(newTimezone)
    localStorage.setItem('lifesynced_timezone', newTimezone)
    setShowTimezoneSelector(false)
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

  const fetchEvents = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/events?daysAhead=30')
      if (!response.ok) throw new Error('Failed to fetch events')
      const data = await response.json()
      setEvents(data)
    } catch (error) {
      console.error('Error fetching events:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchIgnoredBaseIds = async () => {
    try {
      const response = await fetch('/api/ignored-base-ids')
      if (!response.ok) throw new Error('Failed to fetch ignored base IDs')
      const data = await response.json()
      setIgnoredBaseIds(new Set(data.map((item: any) => item.base_id)))
      setIgnoredSeriesList(data)
    } catch (error) {
      console.error('Error fetching ignored base IDs:', error)
    }
  }

  const fetchIgnoredEventIds = async () => {
    try {
      const response = await fetch('/api/ignored-event-ids')
      if (!response.ok) throw new Error('Failed to fetch ignored event IDs')
      const data = await response.json()
      setIgnoredEventIds(new Set(data.map((item: any) => item.event_id)))
      setIgnoredOccurrencesList(data)
    } catch (error) {
      console.error('Error fetching ignored event IDs:', error)
    }
  }

  const handleRefresh = async () => {
    try {
      setSyncStatus('Syncing calendars...')
      const response = await fetch('/api/sync', { method: 'POST' })
      if (!response.ok) throw new Error('Sync failed')
      await fetchEvents()
      setSyncStatus('Sync completed')
      setTimeout(() => setSyncStatus(''), 3000)
    } catch (error) {
      setSyncStatus(`Sync failed: ${error}`)
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
      if (!response.ok) throw new Error('Failed to ignore occurrence')
      await fetchIgnoredEventIds()
      await fetchEvents()
    } catch (error) {
      console.error('Error ignoring occurrence:', error)
    }
    setIgnoreModalEvent(null)
  }

  // Ignore the entire series
  const ignoreSeries = async (event: CalendarEvent) => {
    const baseId = getBaseIdFromEventId(event.id)
    try {
      const response = await fetch('/api/ignored-base-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_id: baseId, subject: event.subject })
      })
      if (!response.ok) throw new Error('Failed to ignore series')
      await fetchIgnoredBaseIds()
      await fetchEvents()
    } catch (error) {
      console.error('Error ignoring series:', error)
    }
    setIgnoreModalEvent(null)
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
    try {
      const response = await fetch('/api/ignored-base-ids?base_id=' + encodeURIComponent(baseId), {
        method: 'DELETE'
      })
      if (!response.ok) throw new Error('Failed to unignore series')
      await fetchIgnoredBaseIds()
      await fetchEvents()
    } catch (error) {
      console.error('Error unignoring series:', error)
    }
  }

  const unignoreEventId = async (eventId: string) => {
    try {
      const response = await fetch('/api/ignored-event-ids?event_id=' + encodeURIComponent(eventId), {
        method: 'DELETE'
      })
      if (!response.ok) throw new Error('Failed to unignore occurrence')
      await fetchIgnoredEventIds()
      await fetchEvents()
    } catch (error) {
      console.error('Error unignoring occurrence:', error)
    }
  }

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {}
    events.forEach(event => {
      const baseId = getBaseIdFromEventId(event.id)
      if (ignoredBaseIds.has(baseId)) return
      
      // Use the selected timezone for date grouping
      const date = new Date(event.start_time)
      const dateStr = date.toLocaleDateString('en-CA', { timeZone: timezone }) // en-CA gives YYYY-MM-DD format
      
      if (!grouped[dateStr]) grouped[dateStr] = []
      grouped[dateStr].push(event)
    })
    
    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    })
    
    return grouped
  }, [events, ignoredBaseIds, timezone])

  const getOverlappingEventIds = useMemo(() => {
    if (!detectOverlap) return new Set<string>()
    
    // Helper to check if an event is ignored
    const isEventIgnored = (event: CalendarEvent) => {
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
      // Only filter [Free] or Free events
      if (event.subject !== '[Free]' && event.subject !== 'Free') return false
      
      // Check if all-day
      if (event.is_all_day) return true
      
      // Check if multi-day (24+ hours)
      const start = new Date(event.start_time).getTime()
      const end = new Date(event.end_time).getTime()
      const durationHours = (end - start) / (1000 * 60 * 60)
      return durationHours >= 24
    }
    
    // Filter out ignored events and all-day/multi-day [Free] from overlap detection
    // Note: Overlap detection is ONLY between Personal and Work calendars (not within same type)
    const personalEvents = events.filter(e => 
      e.source === 'apple_calendar' && 
      !isEventIgnored(e) && 
      !isAllDayOrMultiDayFree(e)
    )
    const workEvents = events.filter(e => 
      (e.source === 'graph_api' || e.source === 'ics') && 
      !isEventIgnored(e)
    )
    
    const overlappingIds = new Set<string>()
    
    // Only detect overlap between Personal and Work events
    personalEvents.forEach(personalEvent => {
      workEvents.forEach(workEvent => {
        const personalStart = new Date(personalEvent.start_time).getTime()
        const personalEnd = new Date(personalEvent.end_time).getTime()
        const workStart = new Date(workEvent.start_time).getTime()
        const workEnd = new Date(workEvent.end_time).getTime()
        
        if ((personalStart < workEnd && personalEnd > workStart)) {
          overlappingIds.add(personalEvent.id)
          overlappingIds.add(workEvent.id)
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
    <div className="min-h-screen bg-gray-50 p-3 sm:p-4 md:p-6">
      <div className="max-w-[98vw] mx-auto">
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
            <div className="flex gap-0.5 sm:gap-1 bg-gray-100 p-0.5 sm:p-1 rounded-lg self-start overflow-x-auto">
              {(['day', 'week', '4week'] as ViewMode[]).map((mode) => (
              <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 sm:px-4 md:px-5 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                    viewMode === mode 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {mode === '4week' ? '4-Week' : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
              ))}
            </div>
          </div>
          
          {/* Action Buttons Row */}
          <div className="flex gap-2 sm:gap-3 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0 sm:overflow-visible sm:flex-wrap items-center scrollbar-hide">
            <button
              onClick={handleRefresh}
              className="px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-200 text-gray-700 rounded-full hover:bg-gray-50 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium shadow-sm whitespace-nowrap flex-shrink-0"
            >
              <span>🔄</span>
              <span className="hidden xs:inline">Refresh</span>
            </button>
            
            {(viewMode === 'week' || viewMode === '4week') && (
              <label className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-200 rounded-full cursor-pointer hover:bg-gray-50 text-xs sm:text-sm text-gray-700 font-medium shadow-sm whitespace-nowrap flex-shrink-0">
                <input
                  type="checkbox"
                  checked={hideWeekends}
                  onChange={(e) => setHideWeekends(e.target.checked)}
                  className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="hidden sm:inline">Hide Weekends</span>
                <span className="sm:hidden">Weekends</span>
              </label>
            )}
            
            <button
              onClick={() => setDetectOverlap(!detectOverlap)}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-full flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium shadow-sm transition-all whitespace-nowrap flex-shrink-0 ${
                detectOverlap 
                  ? 'bg-orange-500 text-white hover:bg-orange-600 border border-orange-500' 
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span>⚠️</span>
              <span className="hidden sm:inline">Detect Overlap</span>
              <span className="sm:hidden">Overlap</span>
            </button>
            
            <button
              onClick={() => setShowIgnoredList(!showIgnoredList)}
              className="px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-200 rounded-full hover:bg-gray-50 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium text-gray-700 shadow-sm whitespace-nowrap flex-shrink-0"
            >
              <span>👁️</span>
              <span className="hidden sm:inline">Ignored Events</span>
              <span className="sm:hidden">Ignored</span>
              <span>({ignoredSeriesList.length + ignoredOccurrencesList.length})</span>
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
            
            // Convert events to time slots
            const slots = events.map(event => {
              const start = new Date(event.start_time)
              const end = new Date(event.end_time)
              const startHour = start.getHours() + start.getMinutes() / 60
              const endHour = end.getHours() + end.getMinutes() / 60
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
                <h2 className="text-sm sm:text-lg md:text-xl font-semibold text-gray-900">{formatDateRange()}</h2>
                <div className="flex items-center gap-1 sm:gap-2">
                  <button 
                    onClick={() => navigateWeek(-1)} 
                    className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm"
                  >
                    ←
                  </button>
                  <button 
                    onClick={goToToday} 
                    className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-gray-100 rounded-full text-gray-700 hover:bg-gray-200 font-medium text-xs sm:text-sm"
                  >
                    Today
                  </button>
                  <button 
                    onClick={() => navigateWeek(1)} 
                    className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm"
                  >
                    →
                  </button>
                </div>
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
              <h2 className="text-base sm:text-xl font-semibold text-gray-900">
                <span className="sm:hidden">{selectedDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="hidden sm:inline">{selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
              </h2>
              <div className="flex items-center gap-1 sm:gap-2">
                <button onClick={() => navigateDay(-1)} className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm">←</button>
                <button onClick={goToToday} className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-gray-100 rounded-full text-gray-700 hover:bg-gray-200 font-medium text-xs sm:text-sm">Today</button>
                <button onClick={() => navigateDay(1)} className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm">→</button>
            </div>
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
              <h2 className="text-base sm:text-xl font-semibold text-gray-900">4-Week</h2>
              <div className="flex items-center gap-1 sm:gap-2">
                <button onClick={() => navigateMonth(-1)} className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm">←</button>
                <button onClick={goToToday} className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-gray-100 rounded-full text-gray-700 hover:bg-gray-200 font-medium text-xs sm:text-sm">Today</button>
                <button onClick={() => navigateMonth(1)} className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm">→</button>
            </div>
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
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl p-4 sm:p-6 max-w-md w-full">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">Ignore Event</h3>
              <p className="text-gray-600 mb-3 sm:mb-4 text-sm sm:text-base truncate">
                &ldquo;{ignoreModalEvent.subject}&rdquo;
              </p>
              
              {isRecurringEvent ? (
                <div className="space-y-2 sm:space-y-3">
                  <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-4">
                    This event is part of a recurring series. What would you like to ignore?
                  </p>
                  <button
                    onClick={() => ignoreOccurrence(ignoreModalEvent)}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 active:bg-gray-200 font-medium text-left"
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
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-blue-50 text-blue-800 rounded-lg hover:bg-blue-100 active:bg-blue-100 font-medium text-left border border-blue-200"
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
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:bg-blue-600 font-medium text-sm sm:text-base"
                  >
                    Ignore Event
                  </button>
                </div>
              )}
              
              <button
                onClick={() => setIgnoreModalEvent(null)}
                className="w-full mt-2 sm:mt-3 px-4 py-2 text-gray-600 hover:text-gray-800 font-medium text-sm sm:text-base"
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
