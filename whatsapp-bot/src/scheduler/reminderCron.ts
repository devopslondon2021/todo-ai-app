import cron from 'node-cron';
import { getSupabase } from '../config/supabase.js';
import { getSocket } from '../connection/whatsapp.js';

export function startReminderScheduler(): void {
  // Check for pending reminders every minute
  cron.schedule('* * * * *', async () => {
    const sock = getSocket();
    if (!sock) return;

    const now = new Date().toISOString();

    try {
      const { data: reminders, error } = await getSupabase()
        .from('reminders')
        .select(`
          id,
          reminder_time,
          tasks (title, description, priority, due_date),
          users (whatsapp_jid)
        `)
        .eq('is_sent', false)
        .lte('reminder_time', now)
        .limit(50);

      if (error || !reminders) return;

      // Group reminders by user to batch messages
      const byUser = new Map<string, any[]>();
      for (const r of reminders) {
        const jid = (r as any).users?.whatsapp_jid;
        if (!jid) continue;
        if (!byUser.has(jid)) byUser.set(jid, []);
        byUser.get(jid)!.push(r);
      }

      for (const [jid, userReminders] of byUser) {
        let message = '🔔 *Reminder*\n\n';

        for (const reminder of userReminders) {
          const task = (reminder as any).tasks;
          if (!task) continue;

          const priority =
            task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🔵';
          message += `${priority} *${task.title}*\n`;
          if (task.description) message += `  ${task.description}\n`;
          if (task.due_date) {
            message += `  📅 Due: ${new Date(task.due_date).toLocaleString()}\n`;
          }
          message += '\n';
        }

        message += '_Reply "list" to see all your tasks_';

        try {
          await sock.sendMessage(jid, { text: message });

          // Mark all as sent
          for (const reminder of userReminders) {
            await getSupabase()
              .from('reminders')
              .update({ is_sent: true, sent_at: now })
              .eq('id', reminder.id);
          }
        } catch (err) {
          console.error(`Failed to send reminder to ${jid}:`, err);
        }

        // 1 second delay between different users
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error('Reminder cron error:', err);
    }
  });

  console.log('⏰ Reminder scheduler started (checks every minute)\n');
}
