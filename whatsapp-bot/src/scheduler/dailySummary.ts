import cron from 'node-cron';
import { getSupabase } from '../config/supabase.js';
import { getSocketForUser } from '../connection/sessionManager.js';
import { getTasksForWhatsApp, getMeetings } from '../services/taskService.js';
import { formatMorningSummary } from '../utils/formatter.js';

export function startDailySummaryScheduler(): void {
  cron.schedule('0 7 * * *', async () => {
    try {
      const { data: users, error } = await getSupabase()
        .from('users')
        .select('id, whatsapp_jid, name')
        .eq('whatsapp_connected', true);

      if (error || !users) {
        if (error) console.error('[DAILY] User query error:', error);
        return;
      }

      for (const user of users) {
        const jid = user.whatsapp_jid as string;
        const sock = getSocketForUser(user.id);
        if (!sock || !jid) continue;

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

          if (tasks.length === 0 && todayMeetings.length === 0) continue;

          const userName = user.name || 'there';
          const message = formatMorningSummary(tasks, todayMeetings, userName);
          await sock.sendMessage(jid, { text: message });
        } catch (err) {
          console.error(`[DAILY] Error for user ${user.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[DAILY] Summary cron error:', err);
    }
  });

  console.log('☀️ Daily summary scheduler started (7:00 AM)\n');
}
