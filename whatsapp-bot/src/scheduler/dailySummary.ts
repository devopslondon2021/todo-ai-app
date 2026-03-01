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
        .select('id, whatsapp_jid')
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
          const [tasks, allMeetings] = await Promise.all([
            getTasksForWhatsApp(user.id, 'today'),
            getMeetings(user.id),
          ]);

          const now = new Date();
          const todayStart = new Date(now);
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date(now);
          todayEnd.setHours(23, 59, 59, 999);

          const todayMeetings = allMeetings.filter((m: any) => {
            if (!m.due_date) return false;
            const d = new Date(m.due_date);
            return d >= todayStart && d <= todayEnd;
          });

          if (tasks.length === 0 && todayMeetings.length === 0) continue;

          const message = formatMorningSummary(tasks, todayMeetings);
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
