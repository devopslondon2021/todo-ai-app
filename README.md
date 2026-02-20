Here's the step-by-step setup:

  1. Set up Supabase (one-time)

  1. Go to supabase.com and create a free project
  2. Once created, go to SQL Editor in the dashboard
  3. Paste the contents of supabase/schema.sql and click Run
  4. Go to Settings → API and copy your:
    - Project URL
    - anon public key
    - service_role secret key

  2. Create your .env file

  cp .env.example .env

  Then edit .env and fill in your actual keys:

  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_ANON_KEY=your-anon-key
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  OPENAI_API_KEY=sk-your-openai-key

  NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

  3. Install & Run

  # Install all dependencies (already done, but just in case)
  npm install

  # Run all 3 services at once
  npm run dev

  This starts:
  - Frontend → http://localhost:3000 (open this in your browser)
  - Backend → http://localhost:3001
  - WhatsApp Bot → shows a QR code in your terminal

  4. Connect WhatsApp

  When you see the QR code in the terminal, open WhatsApp on your phone → Linked Devices → Link a Device → scan the QR. After that you can message yourself (or the linked number) commands like:
  - help — see all commands
  - buy groceries tomorrow at 5pm — creates a task via AI
  - list — see your tasks
  - done 1 — complete task #1

  If the QR code never appears (connection fails with status 405), downgrade Baileys:
  ```bash
  cd whatsapp-bot && npm install @whiskeysockets/baileys@6.6.0
  ```

  If you see "connection replaced (440)" or "bad-request": only one session can be active. Stop all bot instances, close WhatsApp Web in your browser, then on your phone go to Linked Devices → unlink "Ubuntu" or any duplicate → restart the bot and scan the QR again.

  Quick test without Supabase/OpenAI

  If you just want to see the UI right now without setting up any keys:

  npm run dev:frontend

  Open http://localhost:3000 — it'll run in demo mode with sample tasks so you can see the full UI, filters, and layout.