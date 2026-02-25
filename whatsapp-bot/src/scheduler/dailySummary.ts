import cron from 'node-cron';
import { getSupabase } from '../config/supabase.js';
import { getSocket } from '../connection/whatsapp.js';
import { getTasksForWhatsApp, getMeetings } from '../services/taskService.js';
import { formatMorningSummary } from '../utils/formatter.js';

export function startDailySummaryScheduler(): void {
  cron.schedule('0 7 * * *', async () => {
    const sock = getSocket();
    if (!sock) return;

    try {
      const { data: users, error } = await getSupabase()
        .from('users')
        .select('id, whatsapp_jid')
        .not('whatsapp_jid', 'is', null);

      if (error || !users) {
        if (error) console.error('[DAILY] User query error:', error);
        return;
      }

      for (const user of users) {
        const jid = user.whatsapp_jid as string;
        try {
          const [tasks, allMeetings] = await Promise.all([
            getTasksForWhatsApp(user.id, 'today'),
            getMeetings(user.id),
          ]);

          // Filter meetings to today only
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

          // Skip users with nothing due today
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
