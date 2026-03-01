# Plan: Authentication + Multi-User + Per-User WhatsApp QR

## Context

The Todo AI app has **zero authentication** — a single "Default User" returned by `GET /api/users/default`, `user_id` trusted from query params, and no ownership checks on mutations. We're adding:

1. **Supabase Auth** (Google Sign-In + Magic Link) with a dedicated `/login` page
2. **Multi-user data isolation** via JWT middleware + ownership enforcement on the backend
3. **Per-user WhatsApp QR** — each user connects their own WhatsApp from Settings

---

## Critical Edge Cases Identified During Review

These issues were found by cross-verifying the plan against every file in the codebase:

1. **No ownership enforcement on mutations** — `PATCH /tasks/:id`, `DELETE /tasks/:id`, `PATCH /categories/:id`, `DELETE /categories/:id`, `DELETE /reminders/:id` accept a resource ID with zero ownership check. After auth, an authenticated user could still modify another user's resources. **Fix: add ownership guards to all mutation routes.**

2. **`apiKeyAuth` vs JWT conflict** — Both read `Authorization: Bearer`. If JWT middleware runs first on the `/tasks` router, Siri routes (`/tasks/quick`, `/tasks/siri/today`) will 401 because `todoai_xxx` tokens aren't JWTs. **Fix: `authenticate.ts` must detect `todoai_` prefix and call `next()` to let `apiKeyAuth` handle it.**

3. **Demo mode regression** — `useUser.ts` catches all errors silently, including 401. A backend auth rejection would activate demo mode instead of redirecting to `/login`. **Fix: Next.js `middleware.ts` handles route protection server-side (before any API call). The `useUser` hook reads from `AuthContext` (not the API), so demo mode only activates when the backend is completely unreachable after auth is confirmed.**

4. **Supabase Realtime** — The plan says "no RLS changes" so RLS policies remain `USING(TRUE)`. The anon-key client continues receiving all events, and the `filter: user_id=eq.${userId}` client-side filter still works. **No change needed for Realtime currently.** If RLS is tightened later, the Realtime client must be made auth-aware.

5. **SSE cannot send Authorization headers** — `EventSource` API has no header support. **Fix: pass auth token as query param `?token=<jwt>` for the QR stream endpoint. The backend verifies from `req.query.token`. Acceptable tradeoff for a short-lived internal stream.**

6. **Google Calendar callback safe** — `/auth/callback` (Supabase auth) vs `/auth/google/callback` (Calendar OAuth) are different paths. No conflict. Next.js middleware must exclude both.

7. **Bot-to-backend calls** — The bot talks to Supabase DB directly (service_role key), not through the backend API. JWT middleware on the backend doesn't affect the bot. The new internal `/api/whatsapp/event` endpoint (bot→backend callback) must be excluded from auth middleware.

8. **`baileys_auth` PK collision** — Current PK is `key TEXT`. Two users would collide on `'creds'`. **Fix: composite PK `(user_id, key)`. Migration must handle existing data.**

9. **`myPhoneJid` global singleton** — Would be overwritten by last connected session. **Fix: stored per-session in `sessionManager.ts` SessionEntry.**

10. **Cron schedulers use global socket** — `getSocket()` returns one socket. **Fix: look up `getSocketForUser(userId)` per reminder/summary.**

11. **`reminderCron` missing `trackSentMessage()`** — Existing bug. Reminder self-sends aren't tracked in `botSentIds`, causing loop risk. **Fix: call `trackSentMessage()` after every `sock.sendMessage()` in crons.**

12. **`getOrCreateUser` Step 3 adoption** — With auth, user identity is established before WhatsApp connects. The "adopt unlinked user" cascade becomes unnecessary for per-user sessions. **Fix: `sessionManager` receives `userId` from the auth system; no JID-based user resolution needed.**

13. **Settings route is global** — `PUT /api/settings` changes AI provider for all users. Per plan decision, this stays global. **No change, but note: any authenticated user can change it for everyone.**

14. **`/api/users/:id/api-key` and `/api/users/:id/api-key/regenerate`** — Any authenticated user could read/rotate another user's API key. **Fix: verify `req.appUserId === req.params.id` in these routes.**

---

## Agent Team Breakdown

The work is divided into **4 agents** that can execute in parallel (with one dependency noted). Each agent works in an isolated worktree.

### Agent 1: Backend Auth Infrastructure
**Files to create:**
- `supabase/migration_v12_auth.sql` — DB migration (auth_id, email, whatsapp_connected, baileys_auth.user_id + composite PK)
- `backend/src/middleware/authenticate.ts` — JWT verification via `jose` JWKS. Must skip `todoai_` tokens (call `next()`)
- `backend/src/middleware/resolveUser.ts` — Maps `auth_id` → `users.id`, attaches `req.appUserId`

**Files to modify:**
- `backend/package.json` — add `jose`
- `backend/src/types/index.ts` — add `email`, `auth_id` to User interface + Express Request extensions (`authUserId`, `authEmail`, `authMeta`, `appUserId`)
- `backend/src/config/env.ts` — add `WHATSAPP_BOT_URL` (default `http://localhost:3002`)
- `backend/src/services/userService.ts` — add `getOrCreateByAuthId(authId, email, metadata)` with 4-step logic:
  1. Find by `auth_id` → return
  2. Find by `email` where `auth_id IS NULL` → claim
  3. Find oldest user with `auth_id IS NULL AND email IS NULL` → claim (first signup inherits)
  4. Create new + seed categories → return
  Also add `getUserByAuthId(authId)` for resolveUser middleware
- `backend/src/index.ts` — apply `authenticate` + `resolveUser` per route group (NOT to `/api/health`, NOT to `/api/whatsapp/event`), register new `/api/whatsapp` routes
- `backend/src/routes/users.ts` — add `POST /me` endpoint (protected by authenticate), verify ownership on `GET /:id/api-key` and `POST /:id/api-key/regenerate`
- `backend/src/routes/tasks.ts` — every handler: prefer `req.appUserId` over `req.query.user_id`/`req.body.user_id`. Add ownership check on `PATCH /:id` and `DELETE /:id` (verify `task.user_id === req.appUserId`). Add ownership check on `PATCH /reorder`.
- `backend/src/routes/categories.ts` — prefer `req.appUserId`. Add ownership checks on `PATCH /:id` and `DELETE /:id`.
- `backend/src/routes/reminders.ts` — prefer `req.appUserId`. Add ownership check on `DELETE /:id`.
- `backend/src/routes/calendar.ts` — prefer `req.appUserId`. Exclude `POST /webhook` from auth middleware (Google push notification, unauthenticated).
- `.env.example` — add `WHATSAPP_BOT_URL=http://localhost:3002`, `BOT_API_PORT=3002`

**Key patterns:**
- Ownership check pattern for mutations:
  ```ts
  // Before updating/deleting a task:
  const task = await taskService.getTaskById(id)
  if (!task || task.user_id !== req.appUserId) {
    res.status(404).json({ error: 'Task not found' }); return
  }
  ```
- Route group middleware pattern:
  ```ts
  app.use('/api/tasks', authenticate, resolveUser, taskRoutes)
  // But NOT: app.use('/api/whatsapp/event', ...) — internal
  ```

---

### Agent 2: Frontend Auth + Login Page
**Files to create:**
- `frontend/src/lib/supabase/client.ts` — `createBrowserClient` from `@supabase/ssr`
- `frontend/src/lib/supabase/server.ts` — `createServerClient` from `@supabase/ssr` with cookie handling
- `frontend/src/middleware.ts` — Next.js middleware:
  - Refreshes Supabase session via `supabase.auth.getUser()`
  - Redirects unauthenticated → `/login`
  - Redirects authenticated → `/` (away from login)
  - Matcher excludes: `/_next/static`, `/_next/image`, `/auth/callback`, `/auth/google/callback`, favicons/images
- `frontend/src/context/AuthContext.tsx` — React context:
  - `supabase.auth.getUser()` on mount
  - `onAuthStateChange` listener
  - When authenticated: `POST /api/users/me` to get/create app User
  - Provides `{ supabaseUser, user, loading, signOut }`
- `frontend/src/app/login/page.tsx` — Login page:
  - Tab toggle: Sign In / Sign Up
  - Google Sign-In button (prominent) → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: origin/auth/callback } })`
  - Magic link form → `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: origin/auth/callback, data: { name, phone_number } } })`
  - Sign Up tab shows: Name + Phone + Email fields
  - Dark theme using existing CSS variables from `globals.css`
  - Lucide React icons only
- `frontend/src/app/auth/callback/route.ts` — GET handler: exchanges `code` for session, redirects to `/`

**Files to modify:**
- `frontend/package.json` — add `@supabase/ssr`, `react-qr-code`
- `frontend/src/app/layout.tsx` — wrap children with `<AuthProvider>`
- `frontend/src/lib/api.ts` — add `getAuthHeader()` that reads `supabase.auth.getSession().access_token` and injects `Authorization: Bearer <token>`. Only on browser (check `typeof window !== 'undefined'`).
- `frontend/src/hooks/useUser.ts` — replace `GET /users/default` with reading from `useAuth()` context. Same return shape `{ user, loading }`.
- `frontend/src/hooks/useTasks.ts` — remove `user_id` from query params. Keep `userId` as useEffect dependency and Realtime filter.
- `frontend/src/hooks/useCategories.ts` — remove `user_id` from query params
- `frontend/src/types/index.ts` — add `email?: string | null` to User interface
- `frontend/src/app/page.tsx` — remove DEMO_USER fallback reliance on `/users/default`. The `useUser()` hook now reads from AuthContext. Demo mode only activates when backend is completely unreachable (AuthContext catches the fetch error). Remove `user_id` from the calendar sync POST body.
- `frontend/src/components/input/SmartInput.tsx` — remove `user_id` from all POST bodies (parse, meeting, check-availability, create task). ~7 occurrences.
- `frontend/src/components/layout/Sidebar.tsx` — remove `user_id` from POST /categories body. Add sign-out button (LogOut icon) near Settings button using `useAuth().signOut`.
- `frontend/src/components/settings/SettingsModal.tsx` — remove `user_id` from all API calls (api-key, calendar status/auth-url/disconnect/sync/credentials). ~7 occurrences. The userId prop can be used for non-API display purposes.

**Note:** The existing `frontend/src/lib/supabase.ts` stays UNTOUCHED — it's used exclusively for Realtime subscriptions and will continue working with the anon key since RLS policies remain permissive.

---

### Agent 3: WhatsApp Per-User Sessions (Bot Core)
**Files to create:**
- `whatsapp-bot/src/connection/sessionManager.ts` — Multi-session manager:
  ```ts
  interface SessionEntry {
    sock: WASocket
    status: 'connecting' | 'qr' | 'connected' | 'disconnected'
    myPhoneJid: string | null  // PER-SESSION, not global
    reconnectAttempts: number
    botSentIds: Set<string>
    msgRetryCache: NodeCache
    messageStore: Map<string, proto.IMessage>
  }
  ```
  Exports: `initSessionManager(onQR, onStatus, createHandler)`, `reconnectAll()`, `connectUser(userId)`, `disconnectUser(userId)`, `getSocketForUser(userId)`, `getSessionStatus(userId)`, `trackSentMessage(userId, id)`

  Connection event handling per socket:
  - `qr` → call `onQR(userId, qrString)`
  - `connection === 'open'` → set `myPhoneJid` on SessionEntry, update DB `whatsapp_connected=true, whatsapp_jid=jid`, call `onStatus(userId, 'connected', jid)`
  - `connection === 'close'` + loggedOut → `clearAuth()`, update DB, remove from map
  - `connection === 'close'` otherwise → exponential backoff (max 5)
  - `messages.upsert` → call per-user handler with correct socket

- `whatsapp-bot/src/api/server.ts` — Internal HTTP server (port 3002):
  - `POST /connect { userId }` → `connectUser(userId)`
  - `POST /disconnect { userId }` → `disconnectUser(userId)`
  - `GET /status?userId=xxx` → `getSessionStatus(userId)`

**Files to modify:**
- `whatsapp-bot/src/connection/useSupabaseAuthState.ts` — accept `userId: string` param. All DB ops filter `.eq('user_id', userId)`. Add `clearAuth(userId)` that deletes all rows for that user_id.
- `whatsapp-bot/src/connection/whatsapp.ts` — RETIRE. Logic absorbed by sessionManager. Keep file but empty exports (or delete and update all imports).
- `whatsapp-bot/src/handlers/messageHandler.ts` — convert to factory: `export function createMessageHandler(userId: string)` returns `(sock: WASocket, msg) => Promise<void>`. Changes:
  - Replace `taskService.getOrCreateUser(jid)` with `taskService.getUserById(userId)` (identity known from session)
  - Replace `getMyPhoneJid()` global with per-session value passed into factory
  - Replace `trackSentMessage()` / `storeSentMessage()` imports with per-session versions from sessionManager
  - Normalize `userCache`, `lastTaskList`, `pendingTasks` to key by `userId` (not JID)
  - Remove `@lid` rewrite logic (irrelevant in per-user sessions — user IS the session)
- `whatsapp-bot/src/scheduler/reminderCron.ts`:
  - Replace `getSocket()` with `getSocketForUser(userId)` per reminder
  - Extend reminders query to select `users.id` alongside `users.whatsapp_jid`
  - **Fix existing bug:** call `trackSentMessage(userId, sent.key.id)` after every `sock.sendMessage()`
  - If `getSocketForUser(userId)` returns null, skip (retry next minute)
- `whatsapp-bot/src/scheduler/dailySummary.ts`:
  - Query users where `whatsapp_connected = true`
  - Replace `getSocket()` with `getSocketForUser(user.id)`
- `whatsapp-bot/src/index.ts` — replace `connectWhatsApp(handleMessage)` with:
  ```ts
  await initSessionManager(onQR, onStatus, createMessageHandler)
  startBotApiServer(env.BOT_API_PORT)
  ```
  Where `onQR` and `onStatus` POST to `${BACKEND_URL}/api/whatsapp/event`
- `whatsapp-bot/src/config/env.ts` — add `BOT_API_PORT`

---

### Agent 4: Backend WhatsApp Routes + Frontend Settings UI
**Depends on:** Agent 3 (needs bot API server to exist). Can start after Agent 3 completes the API server, or build against the API contract.

**Files to create:**
- `backend/src/routes/whatsapp.ts` — New route group `/api/whatsapp`:
  - `POST /connect` (auth required) — calls `fetch(WHATSAPP_BOT_URL/connect, { userId: req.appUserId })`
  - `GET /qr-stream` (auth via query param token) — SSE endpoint. Maintains `Map<userId, Response>` of active connections. When bot posts events, forwards to matching client.
    - Auth: verify JWT from `req.query.token` using same JWKS logic as `authenticate.ts`
    - Events sent: `data: {"type":"qr","data":"..."}\n\n`, `data: {"type":"connected","jid":"..."}\n\n`
  - `POST /event` (NO auth — internal, called by bot) — receives `{ userId, type, data, jid }` from bot, forwards to SSE client
  - `POST /disconnect` (auth required) — calls `fetch(WHATSAPP_BOT_URL/disconnect, { userId: req.appUserId })`
  - `GET /status` (auth required) — calls `fetch(WHATSAPP_BOT_URL/status?userId=req.appUserId)`, also checks DB for `whatsapp_jid` + `whatsapp_connected`

**Files to modify:**
- `frontend/src/components/settings/SettingsModal.tsx` — add WhatsApp section:
  - New state: `waStatus`, `waQr`, `waJid`, `waLoading`
  - On modal open: `GET /api/whatsapp/status` for current state
  - "Connect WhatsApp" button:
    1. `POST /api/whatsapp/connect`
    2. Get access_token from supabase client session
    3. Open `EventSource(BACKEND_URL/api/whatsapp/qr-stream?token=${accessToken})`
    4. On `qr` event → render via `react-qr-code` (`<QRCode value={qr} bgColor="transparent" fgColor="#fff" />`)
    5. On `connected` → show green dot + phone number, close EventSource
  - "Disconnect" button: `POST /api/whatsapp/disconnect`
  - Cleanup: close EventSource on modal close (useEffect return)
  - Phone display: parse JID `12345678901@s.whatsapp.net` → `+1 234 567 8901`

---

## Implementation Order (for sequential execution if not using team)

1. Run `migration_v12_auth.sql` in Supabase SQL editor
2. `npm install jose --workspace=backend`
3. `npm install @supabase/ssr react-qr-code --workspace=frontend`
4. Backend auth middleware + userService additions + `POST /me` route
5. Backend route updates (prefer `req.appUserId`, add ownership guards)
6. Frontend supabase client/server + AuthContext + middleware.ts
7. Login page + auth callback route
8. Wire auth: layout.tsx provider, api.ts token, useUser.ts rewrite
9. Frontend cleanup: remove `user_id` from hooks + components, add sign-out
10. WhatsApp sessionManager + useSupabaseAuthState update
11. WhatsApp messageHandler factory + scheduler updates
12. Bot API server + index.ts refactor
13. Backend whatsapp routes (SSE + connect/disconnect)
14. Frontend Settings WhatsApp section

---

## Verification Checklist

### Auth Flow
- [ ] Google Sign-In → redirects to dashboard → user created in DB with `auth_id`
- [ ] Magic Link → email received → click → redirected to dashboard
- [ ] Sign out → redirected to `/login`
- [ ] Unauthenticated visit to `/` → redirected to `/login`
- [ ] Authenticated visit to `/login` → redirected to `/`

### Multi-User Isolation
- [ ] First signup inherits existing Default User's tasks/categories
- [ ] Second signup gets empty list + default categories
- [ ] User A cannot see User B's tasks (check API responses)
- [ ] User A cannot PATCH/DELETE User B's tasks (returns 404)
- [ ] User A cannot read User B's API key

### Siri Compatibility
- [ ] `curl -H "Authorization: Bearer todoai_xxx" /api/tasks/siri/today` still works
- [ ] `curl -H "Authorization: Bearer todoai_xxx" /api/tasks/quick -d '{"text":"buy milk"}'` still works

### WhatsApp Per-User
- [ ] Settings → WhatsApp → Connect → QR code appears
- [ ] Scan QR with phone → status shows "Connected" with phone number
- [ ] Disconnect → status shows "Not connected", session cleared from DB
- [ ] Create task with reminder → reminder arrives as WhatsApp self-message
- [ ] Reminder self-message does NOT trigger command loop (trackSentMessage fix)
- [ ] Restart whatsapp-bot → all connected sessions auto-reconnect
- [ ] Two users can be connected simultaneously

### Build & Types
- [ ] `npx tsc --noEmit -p backend/tsconfig.json` passes
- [ ] `npx tsc --noEmit -p whatsapp-bot/tsconfig.json` passes
- [ ] `cd frontend && npx next build` succeeds
- [ ] `npm run dev` starts all 3 services without errors

### Supabase Dashboard Config (Manual)
- [ ] Authentication > Providers > Google enabled with Client ID/Secret
- [ ] Authentication > Settings > "Confirm email" disabled
- [ ] Authentication > URL Config > `http://localhost:3000/auth/callback` in allowed redirects
- [ ] Authentication > Settings > Site URL = `http://localhost:3000`
