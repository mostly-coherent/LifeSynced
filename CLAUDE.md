# LifeSynced

## Project Type
Full-stack Next.js application with Supabase (PostgreSQL) backend, deployable to Vercel.

*Follows root CLAUDE.md Core Web defaults. No AI/LLM features currently.*

## Key Commands

### Development
```bash
cd calendar-ui
npm install                           # First time only
npm run dev                           # Start dev server (port 3002)
npm run build                         # Build for production
npm run lint                          # Run ESLint
```

### Deployment
```bash
cd calendar-ui
vercel --prod                         # Deploy to Vercel
```

### Database
```sql
-- Run in Supabase SQL Editor
-- See: calendar-ui/supabase/schema.sql
```

### Legacy Python Scripts (local SQLite only)
```bash
python3 sync_all_calendars.py         # Sync to local SQLite
python3 query_db.py list              # Query local database
python3 query_db.py stats             # Database statistics
```

## Project Structure
```
LifeSynced/
├── calendar-ui/                      # Next.js application
│   ├── app/                          # App Router pages
│   │   ├── page.tsx                  # Main calendar UI
│   │   ├── globals.css               # TailwindCSS styles
│   │   └── api/                      # API routes
│   │       ├── events/route.ts       # GET events (with ignore filtering)
│   │       ├── sync/route.ts         # POST sync (ICS parsing in TypeScript)
│   │       ├── ignored-base-ids/     # Manage ignored series
│   │       └── ignored-event-ids/    # Manage ignored occurrences
│   ├── lib/
│   │   └── supabase.ts               # Supabase client + types
│   ├── supabase/
│   │   └── schema.sql                # Database schema (run in Supabase)
│   ├── types/
│   │   └── ical.js.d.ts              # TypeScript types for ical.js
│   ├── vercel.json                   # Vercel config + cron job
│   ├── .env.local                    # Local environment (gitignored)
│   └── env.example                   # Environment template
├── sync_calendar.py                  # Legacy: Outlook Graph API sync
├── sync_calendar_ics.py              # Legacy: Outlook ICS sync
├── sync_apple_calendar.py            # Legacy: iCloud sync
├── shared_db.py                      # Legacy: SQLite interface
├── calendar.db                       # Legacy: Local SQLite (gitignored)
└── requirements.txt                  # Legacy: Python dependencies
```

## Environment Variables

### Required (calendar-ui/.env.local)
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OUTLOOK_ICS_URL=https://outlook.office365.com/owa/calendar/.../calendar.ics
APPLE_CALENDAR_ICS_URL_1=https://p123-caldav.icloud.com/published/2/...
APPLE_CALENDAR_ICS_URL_2=https://p123-caldav.icloud.com/published/2/...
APP_PASSWORD=your-app-password
PERSONAL_REVEAL_PASSWORD=your-reveal-password  # Optional: masks personal events for demos
```

### Optional (legacy Python scripts)
```bash
CLIENT_ID=azure-app-client-id
TENANT_ID=azure-tenant-id
DB_PATH=calendar.db
SKIP_GRAPH_API=true
```

## Development Notes

### Frontend (Next.js 14)
- TypeScript + React with App Router
- TailwindCSS for styling
- Port 3002 (configurable)
- View modes: Day (mobile default), Week (desktop default), 4-Week
- 24-hour time grid (0000–2400)
- Side-by-side display for overlapping events
- Timezone selector with local storage persistence
- Event tooltips on hover/tap
- Mobile-responsive with touch-friendly controls

### Backend (Supabase)
- PostgreSQL database hosted on Supabase
- Row Level Security (RLS) enabled
- Service role key for server-side access (bypasses RLS)
- All sync logic in TypeScript API routes (no Python dependency for cloud)

### Sync Logic
- ICS parsing via `ical.js` library
- Recurring events expanded up to 500 occurrences
- Events stored with UTC timestamps
- Deduplication by event ID (upsert on conflict)
- Automatic cron sync daily at 6 AM UTC (Vercel)

### Caching
- All API routes use `force-dynamic`, `revalidate=0`, `fetchCache='force-no-store'`
- Response headers: `Cache-Control: no-store, no-cache, must-revalidate`
- Frontend fetches use `cache: 'no-store'`
- Changes reflect immediately without server restart

### Database Schema
```sql
appointments (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  organizer_email TEXT,
  organizer_name TEXT,
  attendees JSONB,
  body_preview TEXT,
  is_all_day BOOLEAN,
  source TEXT CHECK (source IN ('graph_api', 'ics', 'apple_calendar')),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

ignored_base_ids (base_id TEXT PRIMARY KEY, subject TEXT, ignored_at TIMESTAMPTZ, reason TEXT)
ignored_event_ids (event_id TEXT PRIMARY KEY, subject TEXT, start_time TEXT, reason TEXT, ignored_at TIMESTAMPTZ)
sync_metadata (id TEXT PRIMARY KEY, last_outlook_sync TIMESTAMPTZ, last_ics_sync TIMESTAMPTZ, last_apple_sync TIMESTAMPTZ)
```

### Privacy Mode (Personal Event Masking)
- Personal calendar events ALWAYS show as "[Personal Event]" by default
- Overlap detection still works with masked events (highlights conflicts)
- Set `PERSONAL_REVEAL_PASSWORD` to enable reveal capability
- Only you (with the password) can click "🔒 Personal Hidden" to reveal actual event names
- Reveal expires after 24 hours (shorter than main auth)
- Work calendar events already masked by Outlook ("[Busy]", "[Tentative]")

### Known Limitations
- ICS feeds may show "[Busy]" instead of actual event titles (Outlook privacy)
- Very long recurring series (>500 occurrences) may be truncated
- No two-way sync (read-only calendar view)

## Testing
```bash
# Local development
cd calendar-ui && npm run dev
# Open http://localhost:3002

# Test sync
curl -X POST http://localhost:3002/api/sync

# Test events API
curl http://localhost:3002/api/events | jq '. | length'
```

---

**Last Updated:** 2025-12-01
