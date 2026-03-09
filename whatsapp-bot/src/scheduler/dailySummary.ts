import cron from 'node-cron';
import { getSupabase } from '../config/supabase.js';
import { getSocketForUser, getSessionStatus, runHealthCheck, connectUser } from '../connection/sessionManager.js';
import { getTasksForWhatsApp, getMeetings } from '../services/taskService.js';
import { formatMorningSummary } from '../utils/formatter.js';

async function sendDailySummaries(): Promise<void> {
  console.log('[DAILY] Cron fired — preparing summaries...');

  // Run health check first to force-reconnect any stale sockets
  runHealthCheck();

  try {
    const { data: users, error } = await getSupabase()
      .from('users')
      .select('id, whatsapp_jid, name')
      .eq('whatsapp_connected', true);

    if (error || !users) {
      if (error) console.error('[DAILY] User query error:', error);
      else console.log('[DAILY] No users with whatsapp_connected=true');
      return;
    }

    console.log(`[DAILY] Found ${users.length} connected user(s)`);

    for (const user of users) {
      const jid = user.whatsapp_jid as string;
      if (!jid) {
        console.log(`[DAILY] User ${user.id}: skipped — no whatsapp_jid`);
        continue;
      }

      let sock = getSocketForUser(user.id);

      // If socket is null, try reconnecting once and wait briefly
      if (!sock) {
        const status = getSessionStatus(user.id);
        console.warn(`[DAILY] User ${user.id}: socket unavailable (status: ${status}), attempting reconnect...`);
        try {
          await connectUser(user.id);
          // Wait up to 15s for connection to establish
          for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1000));
            sock = getSocketForUser(user.id);
            if (sock) break;
          }
        } catch (err) {
          console.error(`[DAILY] User ${user.id}: reconnect failed:`, err);
        }
        if (!sock) {
          console.error(`[DAILY] User ${user.id}: skipped — reconnect did not establish socket`);
          continue;
        }
        console.log(`[DAILY] User ${user.id}: reconnected successfully`);
      }

      try {
        const [allTasks, todayMeetings] = await Promise.all([
          getTasksForWhatsApp(user.id, 'today'),
          getMeetings(user.id, 'today'),
        ]);

        // Exclude meetings from tasks to avoid double-counting
        const meetingIds = new Set(todayMeetings.map((m: any) => m.id));
        const tasks = allTasks.filter((t: any) =>
          !meetingIds.has(t.id) &&
          t.categories?.name !== 'Meetings' &&
          !t.google_event_id
        );

        const userName = user.name || 'there';
        const message = formatMorningSummary(tasks, todayMeetings, userName);
        const sent = await sock.sendMessage(jid, { text: message });

        // Mark chat as unread so the user sees a notification badge
        if (sent?.key) {
          try {
            await sock.chatModify(
              { markRead: false, lastMessages: [{ key: sent.key, messageTimestamp: sent.messageTimestamp }] },
              jid,
            );
          } catch (err) {
            console.warn(`[DAILY] User ${user.id}: could not mark chat unread:`, err);
          }
        }

        console.log(`[DAILY] User ${user.id}: summary sent (${tasks.length} tasks, ${todayMeetings.length} meetings)`);
      } catch (err) {
        console.error(`[DAILY] Error for user ${user.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[DAILY] Summary cron error:', err);
  }
}

export function startDailySummaryScheduler(): void {
  // Pre-warm window: health checks at 6:30, 6:45, 6:55 to ensure socket is alive
  cron.schedule('30 6 * * *', () => {
    console.log('[DAILY] 6:30 AM pre-warm — health check + reconnect...');
    runHealthCheck();
  });

  cron.schedule('45 6 * * *', () => {
    console.log('[DAILY] 6:45 AM pre-warm — health check...');
    runHealthCheck();
  });

  cron.schedule('55 6 * * *', () => {
    console.log('[DAILY] 6:55 AM pre-warm — final health check before summary...');
    runHealthCheck();
  });

  cron.schedule('0 7 * * *', sendDailySummaries);

  console.log('☀️ Daily summary scheduler started (6:30/6:45/6:55 pre-warm + 7:00 AM send)\n');
}
