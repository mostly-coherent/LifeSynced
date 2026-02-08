# 📅 LifeSynced

> Unified calendar that syncs work Outlook and personal iCloud calendars into one view with overlap detection, smart deduplication, and privacy-first sharing.

![Type](https://img.shields.io/badge/Type-App-blue)
![Status](https://img.shields.io/badge/Status-Active-green)
![Stack](https://img.shields.io/badge/Stack-Next.js%2014%20%7C%20Supabase%20%7C%20Tailwind-blue)

![LifeSynced Calendar with Overlap Detection](calendar-ui/e2e-results/01-calendar.png)

*Unified calendar view showing work and personal events with overlap detection highlighting 61 conflicts*

## 🚀 Quick Start

```bash
# 1. Install dependencies
cd calendar-ui
npm install

# 2. Configure environment (single file at repo root)
cd ..
cp .env.example .env.local
# Edit .env.local with Supabase, Outlook, and iCloud ICS URLs

# 3. Run
cd calendar-ui && npm run dev
```

**→ Open http://localhost:3002**

---

<details>
<summary><strong>✨ Features</strong></summary>

- **Unified view:** Combine work Outlook and personal iCloud calendars.
- **Cloud-first:** Supabase (PostgreSQL) backend with Vercel deployment.
- **Time-grid views:** 24-hour grid with Day, Week, and 4-Week modes.
- **Overlap detection:** Highlight conflicts between work and personal.
- **Smart deduplication:** Avoid duplicate events across sync sources.
- **Ignore events:** Hide recurring series or individual occurrences.
- **Mobile-friendly:** Day view on mobile, Week view on desktop.
- **Timezone selector:** Switch timezones when traveling.

</details>

<details>
<summary><strong>❓ Why LifeSynced?</strong></summary>

Microsoft Outlook doesn't support adding Apple iCloud calendars—only Outlook.com, Hotmail, Live, MSN, or Google. For iPhone users who rely on Apple Calendar for personal events, work and personal calendars can't be viewed together. LifeSynced pulls from both Outlook and iCloud ICS feeds into a unified view.

</details>

<details>
<summary><strong>⚙️ Environment Variables</strong></summary>

**Single file:** `LifeSynced/.env.local` (used by both Python sync scripts and the Next.js app)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `OUTLOOK_ICS_URL` | Outlook calendar ICS feed URL |
| `APPLE_CALENDAR_ICS_URL` or `_1`, `_2`… | iCloud calendar ICS URL(s) |
| `APP_PASSWORD` | App authentication password |
| `PERSONAL_REVEAL_PASSWORD` | Password to reveal personal event names |

</details>

<details>
<summary><strong>🚢 Deployment</strong></summary>

Recommended: Deploy to Vercel

1. Run `calendar-ui/supabase/schema.sql` in Supabase.
2. Build locally: `npm run build`
3. Deploy: `vercel --prod`
4. Note: Vercel cron syncs calendars daily at 6 AM UTC.

</details>

<details>
<summary><strong>💭 What I Learned</strong></summary>

The hardest part: deciphering future events from recurring series that accumulated one-off adjustments over time. But the design decision that unlocked real utility: privacy-first by default. Showing "[Personal Event]" with password-gated reveal made the tool safe to demo with any audience—expanding both reach and utility.

</details>

<details>
<summary><strong>🔮 What's Next</strong></summary>

Adding **an AI agent that proactively reminds me of important life events** (anniversaries, birthdays) and helps me plan ahead—suggesting celebrations, curating gift ideas, even buying small gifts on my behalf. Agentic commerce in practice.

</details>

<details>
<summary><strong>📚 Development Notes</strong></summary>

- See `CLAUDE.md` for detailed technical setup and development commands.
- See `PLAN.md` for detailed product requirements and architecture decisions.
- See `BUILD_LOG.md` for chronological progress.

</details>

---

**Status:** Active | **Purpose:** Personal learning and portfolio project
