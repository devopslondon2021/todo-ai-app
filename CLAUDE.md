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

**Todo AI** is a smart task management app with WhatsApp integration. Users can manage their tasks by text, voice, or WhatsApp, described in plain English. The AI interprets natural language into tasks; reminders are delivered via WhatsApp.

---

## Architecture

Monorepo structure:
```
todo-ai-app/
├── frontend/       # Next.js 15 + Tailwind v4
├── backend/        # Express REST API
├── whatsapp-bot/   # Baileys WhatsApp bot + reminder cron
├── supabase/       # SQL schema
└── package.json    # Workspaces config
```
- **Flow:** 
  - Frontend <-> Backend API (HTTP)
  - Frontend <— Supabase Realtime
  - WhatsApp Bot <-> Supabase DB (service_role key)
  - Reminder cron jobs inside bot

---

## Technology Summary

- **Frontend:** Next.js 15, React 19, Tailwind CSS v4, Zustand, Lucide React, date-fns
- **Backend:** Express.js, Zod, OpenAI SDK (also supports Ollama)
- **Database:** Supabase (Postgres) with Realtime
- **AI:** OpenAI GPT-4o-mini & Ollama (switchable)
- **Voice:** Web Speech API (browser-native)
- **WhatsApp:** @whiskeysockets/baileys
- **Reminders:** node-cron (every minute)

---

## Design & Implementation Notes

- **Design system:** Colors, surfaces, and typography enforced via `frontend/src/app/globals.css`—always use dark backgrounds, muted/clear borders, and modern colors.
- **Icons:** Only Lucide React SVG icons.
- **UI/UX Review:** Use logs and `browser-use` to confirm all changes are correct, visually aligned, compact, and modern.
- **No Extra Sections:** Only implement UI that is logically needed for users.
- **Simplicity:** Prefer concise, easy-to-read code. Do not bloat files or introduce abstraction unless truly necessary.
- **Task parsing:** Natural language ingestion via `backend/src/services/aiService.ts` and WhatsApp bot.

---

## Data Setup

- **DB:** See `supabase/schema.sql`, with `users`, `categories`, `tasks`, `reminders`. Run the schema in Supabase before using.
- **.env:** Copy `.env.example` → `.env` and fill Supabase/OpenAI credentials. Shared for all projects.

---

## Commands

```bash
npm install
npm run dev               # All services
npm run dev:frontend      # Frontend dev
npm run dev:backend       # Backend dev
npm run dev:whatsapp      # WhatsApp/cron
npm run build             # Production builds
npx tsc --noEmit -p backend/tsconfig.json
npx tsc --noEmit -p whatsapp-bot/tsconfig.json
cd frontend && npx next build
```

---

## Required Tools & Skills

- **browser-use:** Browser automation/visual regression/UI/UX checks.
- **ui-ux-pro-max:** Validate/generate design system as needed.
- **vercel-react-best-practices:** React/Next.js optimization and best practices.
- **web-design-guidelines:** For modern UI audits.

---

**Summary:**  
Whenever you are asked to make a change, always:
- Prioritize a dark, modern, compact look.
- Use only modern minimal SVG icons.
- Make sure every UI/UX element is strictly necessary and clear.
- Keep code as simple as possible—avoid bloat or excessive abstraction.
- Always confirm changes function and render as expected via logs and `browser-use`.
- If a suggestion or action does not fit these rules, refuse or give a compliant alternative.

