import { env } from './config/env.js';

async function main() {
  // Check required env vars before starting
  const missing: string[] = [];
  if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    console.warn(`⚠️  WhatsApp Bot: Missing env vars: ${missing.join(', ')}`);
    console.warn('   Set these in .env and restart to enable the WhatsApp bot.\n');
    return;
  }

  const { connectWhatsApp } = await import('./connection/whatsapp.js');
  const { handleMessage } = await import('./handlers/messageHandler.js');
  const { startReminderScheduler } = await import('./scheduler/reminderCron.js');
  const { startDailySummaryScheduler } = await import('./scheduler/dailySummary.js');
  const { startCalendarSyncScheduler } = await import('./scheduler/calendarSync.js');

  console.log('🚀 Starting Todo AI WhatsApp Bot...');
  console.log(`   BACKEND_URL: ${env.BACKEND_URL}\n`);
  await connectWhatsApp(handleMessage);
  startReminderScheduler();
  startDailySummaryScheduler();
  startCalendarSyncScheduler();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
