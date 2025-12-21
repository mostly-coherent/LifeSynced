# LifeSynced Calendar UI

Next.js web interface for viewing synced calendar events.

![Calendar View](e2e-results/01-calendar.png)

## Quick Start

```bash
cd calendar-ui
npm install
npm run dev
```

Then open [http://localhost:3002](http://localhost:3002) in your browser.

## Features

- 📅 **List View**: Chronological list of all events
- 📆 **Day View**: Single day view with navigation
- 📊 **Week View**: 7-day week view (starts Sunday)
- 📈 **4-Week View**: 28-day calendar view
- 🎨 **Color Coding**: Blue for work events, green for personal events
- ⚠️ **Overlap Detection**: Highlights when personal and work events overlap
- 👁️ **Ignore Events**: Hide recurring events you don't want to see
- 🔄 **Refresh**: Re-sync all calendars from the UI
- 📅 **Hide Weekends**: Option to hide Saturday and Sunday in week views

## API Routes

- `GET /api/events` - Fetch calendar events
- `POST /api/sync` - Trigger calendar sync
- `GET /api/ignored-base-ids` - Get ignored events list
- `POST /api/ignored-base-ids` - Add event to ignore list
- `DELETE /api/ignored-base-ids` - Remove event from ignore list

