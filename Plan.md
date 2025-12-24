# LifeSynced – Project Plan

## Executive Summary

LifeSynced is a personal/family productivity tool that unifies work (Outlook) and personal (iCloud) calendars into a single cloud-hosted view, detects conflicts between them, and gives users control to declutter what they see. The system pulls events from ICS feeds, parses them in TypeScript, stores them in Supabase (PostgreSQL), and exposes everything through a modern Next.js web UI deployed on Vercel—accessible from any device.

---

## Problem & Goals

### Problem

- **Fragmented calendar management:** Work (Outlook) and personal (iCloud) calendars live in separate systems with no native unified view.
- **Hidden conflicts:** It is hard to spot scheduling conflicts between work commitments and personal obligations across those silos.
- **Device-bound solutions:** Local-only tools don't support family sharing or multi-device access.

### Primary Objectives

- **Unified calendar view:** Single, cohesive interface displaying both work and personal events.
- **Conflict detection:** Automatically detect and highlight overlaps between work and personal events.
- **Cloud-first:** Accessible from any device via web browser, shareable with family.
- **User-centric control:** Selectively ignore or hide events to keep the view focused.

### Success Criteria

- All relevant calendar events visible in one place.
- Overlaps between work and personal calendars clearly identified.
- No duplicate events from multiple sync sources.
- Accessible from any device (phone, tablet, desktop).
- Shareable with family members.
- Sync runs reliably and automatically.
- Web interface is intuitive, responsive, and pleasant to use.

---

## Architecture

### Cloud Stack

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Calendar Feeds │     │   Vercel     │     │  Supabase   │
│  - Outlook ICS  │────▶│  Next.js API │────▶│  PostgreSQL │
│  - iCloud ICS   │     │  (TypeScript)│     │  (Cloud DB) │
└─────────────────┘     └──────────────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   React UI   │
                        │  (Next.js)   │
                        │  Any Device  │
                        └──────────────┘
```

### Components

1. **Data Sources:** Outlook ICS feed, iCloud public calendar ICS URLs
2. **Sync Layer:** TypeScript API route (`/api/sync`) using `ical.js` for parsing
3. **Storage:** Supabase PostgreSQL with RLS enabled
4. **Presentation:** Next.js React app with TailwindCSS
5. **Hosting:** Vercel (frontend + API routes + cron jobs)

---

## Functional Requirements

### Calendar Synchronization

- Fetch events from Outlook ICS feed
- Fetch events from multiple iCloud ICS feeds
- Parse ICS with `ical.js` (TypeScript)
- Expand recurring events (RRULE) up to 500 occurrences
- Store events in Supabase with deduplication (upsert on ID)
- Automatic daily sync via Vercel cron (6 AM UTC)
- Manual sync via UI button

### Data Management

- Centralized PostgreSQL database (Supabase)
- UTC timestamp storage for consistency
- Row Level Security for data protection
- Deduplication by event ID
- Track event source (ics, apple_calendar)

### Conflict Detection

- Compare time ranges between work and personal events
- Visual indicators (orange highlight) for overlapping events
- Toggle to show only conflicts
- Exclude all-day/multi-day "Free" events from overlap calculation

### User Interface

- **Views:** Day, Week (default on desktop), 4-Week
- **Time grid:** Full 24-hour display (0000–2400)
- **Responsive:** Day view default on mobile (<768px)
- **Features:**
  - Color-coded events (blue=work, green=personal, orange=overlap)
  - Sticky day headers
  - Side-by-side display for overlapping events
  - Hide weekends toggle
  - Timezone selector with persistence
  - Event tooltips on hover/tap
  - Ignore events (series or individual occurrence)
  - Manual sync button
  - Real-time updates (no caching issues)

### Event Management

- Ignore recurring series (all future occurrences)
- Ignore individual occurrences
- View/manage ignored events list
- Unignore events

---

## Non-Functional Requirements

- **Accessibility:** Cloud-hosted, accessible from any device
- **Shareability:** Family members can access same URL
- **Reliability:** Graceful handling of sync failures
- **Performance:** Fast queries via database indexes
- **Privacy:** RLS enabled; service role key server-side only
- **Real-time:** No caching—changes reflect immediately

---

## Data Sources

### Outlook (Work)
- **ICS Feed:** Published calendar URL from Outlook on the Web
- Shows: Free/Busy/Tentative status (titles may be hidden for privacy)

### iCloud (Personal)
- **Public Calendar ICS:** Share calendar as public in iCloud settings
- Shows: Full event details (titles, times, locations)

---

## Deployment

### Vercel
- Automatic deployments from GitHub
- Environment variables in project settings
- Cron job for daily sync (`vercel.json`)

### Supabase
- PostgreSQL database
- Schema in `calendar-ui/supabase/schema.sql`
- RLS enabled for security

---

## Implementation Status

### Phase 1: Core Calendar View ✅ COMPLETE
- ✅ Cloud migration from SQLite to Supabase
- ✅ TypeScript sync logic (no Python dependency for cloud)
- ✅ Vercel deployment with cron jobs
- ✅ Row Level Security (RLS) enabled
- ✅ Proper cache-busting (no stale data issues)
- ✅ Recurring event expansion (500 occurrences max)
- ✅ Timezone-aware event positioning
- ✅ Mobile-responsive design
- ✅ Event tooltips on hover/tap
- ✅ Ignore series or individual occurrences
- ✅ Side-by-side overlapping event display

---

## Next Development Phases

### Phase 2: AI Agent for Life Event Planning (Next - Priority)
**Goal:** Proactive AI agent that reminds and helps plan important life events

**The Challenge:** Agentic commerce in practice—juggling multiple calendars while ensuring nothing important falls through the cracks. The agent needs to understand event importance, detect upcoming milestones, and proactively suggest preparation steps.

**Tasks:**
- [ ] Define "important life events" taxonomy (birthdays, anniversaries, school events, appointments)
- [ ] Build event importance classifier (routine vs. significant)
- [ ] Implement proactive reminder system (not just notifications, but prep suggestions)
- [ ] "What do I need to prepare?" agent that generates task lists
- [ ] Gift/card suggestions for special occasions (integrate with preferences)
- [ ] Travel time calculation and departure reminders
- [ ] Conflict avoidance: "You have 3 events same week as anniversary"
- [ ] Natural language queries: "What's happening this month that I should prepare for?"
- [ ] Test with real family calendar scenarios

**Success Criteria:**
- Agent identifies important events 2+ weeks in advance
- Prep suggestions are actionable and personalized
- Nothing important slips through the cracks
- Family feels less stressed about event coordination

### Phase 3: User Authentication & Multi-User (Week 3-4)
**Goal:** Enable family members to access with their own accounts

**Tasks:**
- [ ] Implement Supabase Auth (email/password)
- [ ] Add user profiles and preferences
- [ ] Calendar sharing within family
- [ ] Per-user timezone settings
- [ ] Per-user ignore lists
- [ ] Invitation system for family members

**Success Criteria:**
- Multiple family members can log in
- Each user has personalized view
- Sharing controls for privacy
- Seamless authentication flow

### Phase 3: Google Calendar Integration (Week 3-4)
**Goal:** Add Google Calendar as third calendar source

**Tasks:**
- [ ] Google Calendar API integration
- [ ] OAuth flow for Google authentication
- [ ] Sync Google events to Supabase
- [ ] Three-way conflict detection (Outlook + iCloud + Google)
- [ ] Per-calendar color coding
- [ ] Selective calendar sync (choose which Google cals)

**Success Criteria:**
- Google events appear alongside Outlook/iCloud
- Three-way conflict detection works
- No duplicate events
- Syncs multiple Google calendars

### Phase 4: Enhanced Conflict Resolution (Week 5-6)
**Goal:** Smarter conflict detection and resolution suggestions

**Tasks:**
- [ ] Conflict severity scoring (minor overlap vs. full conflict)
- [ ] Conflict resolution suggestions ("Move this 30 min later?")
- [ ] Buffer time consideration (travel time between events)
- [ ] Conflict notification system (email/push)
- [ ] Weekly conflict report
- [ ] Auto-ignore low-priority conflicts

**Success Criteria:**
- Conflicts prioritized by severity
- Actionable resolution suggestions
- Proactive notifications for upcoming conflicts
- Weekly digest of resolved/pending conflicts

### Phase 5: Advanced Features (Week 7-8)
**Goal:** PWA, search, and quality-of-life improvements

**Tasks:**
- [ ] Progressive Web App (PWA) manifest
- [ ] Install to home screen support
- [ ] Event search and filter
- [ ] Calendar export (ICS download)
- [ ] Dark mode toggle
- [ ] Keyboard shortcuts
- [ ] Offline mode with service worker

**Success Criteria:**
- Installable on mobile/desktop
- Fast event search
- Accessible offline
- Dark mode for low-light viewing

### Phase 6: Smart Scheduling Assistant (Future)
**Goal:** AI-powered scheduling recommendations

**Tasks:**
- [ ] Analyze historical patterns
- [ ] Suggest best meeting times
- [ ] Identify over-scheduled days
- [ ] Recommend focus time blocks
- [ ] Meeting fatigue detection
- [ ] Integration with OpenAI for smart suggestions

**Success Criteria:**
- Personalized scheduling insights
- Proactive focus time recommendations
- Meeting overload warnings
