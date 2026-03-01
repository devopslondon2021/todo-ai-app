import { env } from './config/env.js';

async function main() {
  console.log('🚀 Starting Todo AI WhatsApp Bot (multi-user mode)...');
  console.log(`   BACKEND_URL: ${env.BACKEND_URL}`);
  console.log(`   BOT_API_PORT: ${env.BOT_API_PORT}\n`);

  // Always start the HTTP server first so the platform health check passes
  const { startBotApiServer } = await import('./api/server.js');
  startBotApiServer(env.BOT_API_PORT);

  const missing: string[] = [];
  if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    console.warn(`⚠️  WhatsApp Bot: Missing env vars: ${missing.join(', ')}`);
    console.warn('   Bot API server is running but WhatsApp features are disabled.\n');
    return;
  }

  const { initSessionManager, reconnectAll } = await import('./connection/sessionManager.js');
  const { createMessageHandler } = await import('./handlers/messageHandler.js');
  const { startReminderScheduler } = await import('./scheduler/reminderCron.js');
  const { startDailySummaryScheduler } = await import('./scheduler/dailySummary.js');
  const { startCalendarSyncScheduler } = await import('./scheduler/calendarSync.js');

  function onQR(userId: string, qr: string) {
    console.log(`[QR] User ${userId}: new QR code generated`);
    fetch(`${env.BACKEND_URL}/api/whatsapp/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, type: 'qr', data: qr }),
    }).catch(err => console.error('[QR] Failed to post event to backend:', err));
  }

  function onStatus(userId: string, status: string, jid?: string) {
    console.log(`[STATUS] User ${userId}: ${status}${jid ? ` (${jid})` : ''}`);
    fetch(`${env.BACKEND_URL}/api/whatsapp/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, type: status, jid }),
    }).catch(err => console.error('[STATUS] Failed to post event to backend:', err));
  }

  initSessionManager(onQR, onStatus, createMessageHandler);

  try {
    await reconnectAll();
  } catch (err) {
    console.error('[SESSION] reconnectAll failed (non-fatal):', err);
  }

  startReminderScheduler();
  startDailySummaryScheduler();
  startCalendarSyncScheduler();
}

main().catch((err) => {
  console.error('Fatal error:', err);
});
