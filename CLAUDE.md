# CLAUDE.md

This file contains strict rules and preferences for Claude Code (claude.ai/code) when working on this repository. You must adhere to these principles for every action, code suggestion, or change.

---

## Core Rules

- **Dark Theme:** All UIs must consistently use a high-quality dark theme. No light or bright sections.
- **Modern Icons:** Use minimal, modern SVG icon packs (Lucide React), never emojis or outdated icons.
- **Compact UI:** Space-efficient layouts required—avoid unnecessary padding and whitespace. Favor a dense, modern look.
- **UI/UX Clarity:** All UI/UX must make sense, with every section serving a clear user purpose. Do not add unnecessary or irrelevant sections.
- **Consistency:** Patterns must remain visually and interactively consistent across the entire product.
- **Simplicity:** Keep code simple and easy to follow. Avoid over-engineering or unnecessarily complex logic in all areas—minimize code size and files where possible without reducing clarity or maintainability.
- **Validation:** Use logs and tools like `browser-use` to verify every change is visually, behaviorally, and functionally correct and meets these standards.

---

## Project Context

**Todo AI** is a smart task management app with WhatsApp + Siri + Google Calendar integration. Users can manage tasks by text, voice, WhatsApp, or Siri Shortcuts — all described in plain English. The AI interprets natural language into structured tasks with priority, category, due dates, and reminders. Reminders are delivered via WhatsApp with optional Twilio call escalation.

---

## Architecture

Monorepo structure (npm workspaces):
```
todo-ai-app/
├── frontend/                     # Next.js 15 + Tailwind v4
│   ├── src/app/                  # Pages: / (dashboard), /auth/google/callback
│   ├── src/components/
│   │   ├── input/                # SmartInput, ParsePreview, MeetingConflicts
│   │   ├── layout/               # Header, Sidebar
│   │   ├── settings/             # SettingsModal (AI provider, Calendar, Siri)
│   │   ├── tasks/                # TaskList, TaskCard, TaskEditModal, StatCards,
│   │   │                         # DailyView, WeeklyView, ViewToggle, TaskFilters
│   │   └── ui/                   # Toast
│   ├── src/hooks/                # useTasks, useCategories, useUser, useVoiceInput
│   ├── src/lib/                  # api.ts, supabase.ts, constants.ts, taskSort.ts
│   ├── src/store/                # useAppStore (Zustand)
│   └── src/types/                # TypeScript interfaces + speech.d.ts
│
├── backend/                      # Express REST API
│   ├── src/config/               # env.ts (Zod), supabase.ts, ai.ts
│   ├── src/routes/               # tasks, categories, reminders, users, settings, calendar
│   ├── src/services/             # aiService, calendarService, categoryService,
│   │                             # reminderService, taskService, userService
│   ├── src/middleware/           # apiKeyAuth (Siri), errorHandler
│   └── src/types/
│
├── whatsapp-bot/                 # Baileys v7 WhatsApp bot + schedulers
│   ├── src/connection/           # whatsapp.ts, useSupabaseAuthState.ts
│   ├── src/handlers/             # commandParser.ts, messageHandler.ts
│   ├── src/scheduler/            # reminderCron, dailySummary, calendarSync
│   ├── src/services/             # aiService, calendarService, callService,
│   │                             # taskService, transcriptionService, videoService
│   └── src/__tests__/            # Jest test suite
│
├── supabase/                     # SQL schema + migrations (v1–v11)
├── .env / .env.example           # Shared env config
└── package.json                  # Workspaces root
```

### Data Flow
- Frontend <-> Backend API (HTTP REST)
- Frontend <-- Supabase Realtime (live task/category updates)
- WhatsApp Bot <-> Supabase DB (service_role key, direct)
- WhatsApp Bot -> Backend API (calendar operations only)
- Google Calendar -> Backend webhook (`POST /api/calendar/webhook`)
- Reminder cron + daily summary + calendar sync crons inside bot

---

## Technology Summary

- **Frontend:** Next.js 15, React 19, Tailwind CSS v4, Zustand, @dnd-kit (drag-and-drop), Lucide React, date-fns
- **Backend:** Express.js, Zod, OpenAI SDK (also supports Ollama), googleapis (Google Calendar)
- **Database:** Supabase (Postgres) with Realtime + pg_trgm (fuzzy matching)
- **AI:** OpenAI GPT-4o-mini & Ollama (switchable at runtime via Settings)
- **Voice (Frontend):** Web Speech API (browser-native)
- **Voice (WhatsApp):** OpenAI Whisper (`gpt-4o-transcribe`) for voice note transcription
- **WhatsApp:** baileys v7 (ESM-only, `"type": "module"`) — NOT `@whiskeysockets/baileys` (deprecated)
- **Calendar:** Google Calendar API v3 (OAuth2, bidirectional sync, push notifications)
- **Siri:** API key auth (`todoai_xxx` Bearer tokens), quick-add + today's tasks endpoints
- **Call Escalation:** Twilio (optional, for unacknowledged reminders)
- **Reminders:** node-cron (every minute check)
- **Video Bookmarks:** YouTube/Instagram URL detection, oEmbed metadata

---

## Key Features

### Frontend
- **AI Smart Input** — Natural language task input with parse preview (editable before confirm)
- **Multi-task splitting** — One input can create multiple tasks
- **Voice input** — Web Speech API microphone button
- **Three view modes** — List (with drag-and-drop reorder), Daily (time-grouped), Weekly (7-column grid)
- **Drag-and-drop** — @dnd-kit for custom task ordering with `sort_order` persistence
- **Duplicate detection** — pg_trgm fuzzy matching warns about similar existing tasks
- **Category sidebar** — Hierarchical categories (up to 3 levels), inline create/delete
- **Stat cards** — Total/Pending/In Progress/Completed counts (excludes Videos category)
- **Task filters** — By category, priority, status, date range, search text, overdue
- **Settings modal** — AI provider toggle, Google Calendar setup (per-user OAuth credentials), Siri Shortcuts setup (API key + instructions)
- **Supabase Realtime** — Tasks update live without polling
- **Google Calendar conflicts** — Meeting conflict UI with alternative slot suggestions
- **Demo mode** — Works offline with static data when backend unavailable

### WhatsApp Bot Commands
| Command | Description |
|---------|-------------|
| `add <text>` | Add task via AI parse |
| `remind <text>` | Add task with reminder |
| `meet <text>` | Schedule meeting (checks Google Calendar) |
| `list [filter]` | List tasks (supports: today, tomorrow, this week, overdue, category, compound filters) |
| `done <N\|search>` | Complete task by number or keyword |
| `delete <N>` | Delete task by number |
| `move <N\|search> to <date>` | Reschedule task |
| `meetings [filter]` | List upcoming meetings |
| `categories` / `cats` | Show category tree |
| `summary` | Today's tasks + reminders + stats |
| `videos` / `vids` | List saved video bookmarks |
| `videos done <N>` | Mark video watched |
| YouTube/Instagram URL | Auto-save as video bookmark |
| Any natural text | AI intent classification fallback |

### WhatsApp Bot Features
- **Voice notes** — Whisper transcription → processed as text command
- **Duplicate detection** — Fuzzy match + yes/no confirmation flow
- **Task list caching** — Numbered refs (`done 3`) resolve from last displayed list (10-min TTL)
- **AI intent fallback** — Unknown messages → `classifyIntent()` → route to add/remind/meet/done/move/query/list/summary
- **Task query** — Natural language questions ("Do I have a task about dentist?") → search results
- **Smart user linking** — JID → phone → unlinked user adoption (merges frontend + WhatsApp users)
- **Supabase auth state** — Baileys session in `baileys_auth` DB table (supports ephemeral deployments)

### Scheduled Jobs (in whatsapp-bot)
- **Reminder cron (every minute)** — Sends WhatsApp reminders; optional Twilio call escalation if unacknowledged
- **Daily summary (7:00 AM)** — Morning WhatsApp message with today's tasks + meetings
- **Calendar sync (every 15 min)** — Polls Google Calendar as safety net for missed webhooks

### Google Calendar Integration
- Per-user OAuth2 (credentials stored in DB, fallback to .env)
- Bidirectional sync: Google events → tasks in "Meetings" category (2-week window)
- Conflict checking + alternative slot suggestions (30-min increments, business hours)
- Creates/updates/deletes calendar events when tasks change (with guardrails: only app-created, only future)
- Push notification webhooks for near-real-time sync
- Watch channel auto-renewal (7-day TTL, renewed 24h before expiry)

### Siri Shortcuts Integration
- `POST /api/tasks/quick` — Parse + create task in one call (Bearer token auth)
- `GET /api/tasks/siri/today` — Spoken summary of today's tasks + reminders + stats
- Per-user API key (`todoai_xxx`) with regenerate/copy in Settings

---

## Backend API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tasks` | — | List tasks with filters |
| GET | `/api/tasks/stats` | — | Task counts by status |
| POST | `/api/tasks/parse` | — | AI parse natural language |
| POST | `/api/tasks` | — | Create task |
| PATCH | `/api/tasks/reorder` | — | Bulk update sort_order |
| PATCH | `/api/tasks/:id` | — | Update task (syncs to Google Calendar) |
| DELETE | `/api/tasks/:id` | — | Delete task (removes linked calendar event) |
| POST | `/api/tasks/quick` | Bearer | Siri quick-add |
| GET | `/api/tasks/siri/today` | Bearer | Siri today summary |
| POST | `/api/tasks/meeting` | — | Create meeting with calendar check |
| POST | `/api/tasks/check-availability` | — | Check time slot availability |
| GET | `/api/categories` | — | List categories |
| GET | `/api/categories/tree` | — | Hierarchical category tree |
| POST/PATCH/DELETE | `/api/categories` | — | Category CRUD |
| GET/POST/DELETE | `/api/reminders` | — | Reminder CRUD |
| GET | `/api/users/default` | — | Get/create default user |
| GET | `/api/users/:id/api-key` | — | Get API key |
| POST | `/api/users/:id/api-key/regenerate` | — | Regenerate API key |
| GET/PUT | `/api/settings` | — | AI provider config |
| POST | `/api/calendar/credentials` | — | Save Google OAuth creds |
| GET | `/api/calendar/auth-url` | — | Google OAuth consent URL |
| POST | `/api/calendar/connect` | — | Exchange code + initial sync |
| POST | `/api/calendar/sync` | — | Manual calendar sync |
| GET | `/api/calendar/status` | — | Connection status |
| POST | `/api/calendar/check-availability` | — | Check slot availability |
| POST | `/api/calendar/events` | — | Create calendar event |
| POST | `/api/calendar/webhook` | — | Google push notification |
| DELETE | `/api/calendar/disconnect` | — | Remove tokens + stop watch |

---

## Database Schema

Tables: `users`, `categories`, `tasks`, `reminders`, `baileys_auth`

- **users** — id, whatsapp_jid, phone_number, name, api_key, google_refresh/access_token, google_token_expiry, google_calendar_connected, google_client_id, google_client_secret, google_watch_channel_id/resource_id/expiry
- **categories** — id, user_id, name, color, icon, is_default, parent_id (3-level hierarchy), unique on (user_id, lower(name), parent_id)
- **tasks** — id, user_id, category_id, title, description, priority (low/medium/high), status (pending/in_progress/completed), due_date, reminder_time, is_recurring, recurrence_rule, sort_order, google_event_id, google_event_created_by_app
- **reminders** — id, task_id, user_id, reminder_time, is_sent, sent_at, call_escalated, acknowledged
- **baileys_auth** — key, data (JSONB), updated_at

Extensions: uuid-ossp, pg_trgm. Functions: `generate_api_key()`, `seed_default_categories()`, `find_similar_tasks()`, `check_category_depth()` trigger.

Schema: `supabase/schema.sql` + migrations v2–v11. Run all in order in Supabase SQL editor.

---

## Design & Implementation Notes

- **Design system:** Colors, surfaces, and typography in `frontend/src/app/globals.css` via `@theme inline {}` — no `tailwind.config.ts`
- **Icons:** Only Lucide React SVG icons
- **Task parsing:** Natural language via `backend/src/services/aiService.ts` (frontend) and `whatsapp-bot/src/services/aiService.ts` (WhatsApp)
- **Baileys v7:** ESM-only, `"type": "module"` in package.json, `.js` import extensions, `fetchLatestBaileysVersion()` required
- **Supabase client:** Lazy-initialized in both frontend and backend (env vars not available at Next.js build time)

---

## Data Setup

- **DB:** Run `supabase/schema.sql` then all migrations (v2–v11) in Supabase SQL editor
- **.env:** Copy `.env.example` → `.env` and fill: Supabase URL/keys, OpenAI API key, optionally Twilio creds, Google Calendar fallback creds

---

## Commands

```bash
npm install                        # Install all workspaces
npm run dev                        # All 3 services (concurrently)
npm run dev:frontend               # Frontend only
npm run dev:backend                # Backend only
npm run dev:whatsapp               # WhatsApp bot only
npm run build                      # Production builds (backend tsc + frontend next build)
npm test                           # Jest tests (whatsapp-bot)
npx tsc --noEmit -p backend/tsconfig.json       # Type-check backend
npx tsc --noEmit -p whatsapp-bot/tsconfig.json  # Type-check whatsapp-bot
cd frontend && npx next build                    # Type-check + build frontend
```

---

## Required Tools & Skills

- **browser-use:** Browser automation/visual regression/UI/UX checks
- **ui-ux-pro-max:** Validate/generate design system as needed
- **vercel-react-best-practices:** React/Next.js optimization and best practices
- **web-design-guidelines:** For modern UI audits

---

## Agent Workflow

### Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

---

**Summary:**
Whenever you are asked to make a change, always:
- Prioritize a dark, modern, compact look
- Use only modern minimal SVG icons
- Make sure every UI/UX element is strictly necessary and clear
- Keep code as simple as possible—avoid bloat or excessive abstraction
- Always confirm changes function and render as expected via logs and `browser-use`
- If a suggestion or action does not fit these rules, refuse or give a compliant alternative
