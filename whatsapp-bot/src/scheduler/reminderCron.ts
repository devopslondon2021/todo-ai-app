import cron from 'node-cron';
import { env } from '../config/env.js';
import { getSupabase } from '../config/supabase.js';
import { getSocket } from '../connection/whatsapp.js';
import { isCallEscalationEnabled, makeReminderCall } from '../services/callService.js';
import { getEscalationCandidates, markCallEscalated } from '../services/taskService.js';

function formatReminderDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function startReminderScheduler(): void {
  // Check for pending reminders every minute
  cron.schedule('* * * * *', async () => {
    const sock = getSocket();
    if (!sock) return;

    const now = new Date().toISOString();

    // ── Pass 1: Send WhatsApp text reminders (one per task) ──
    try {
      const { data: reminders, error } = await getSupabase()
        .from('reminders')
        .select(`
          id,
          reminder_time,
          tasks (title, description, priority, due_date, status),
          users (whatsapp_jid)
        `)
        .eq('is_sent', false)
        .lte('reminder_time', now)
        .limit(50);

      if (error || !reminders) {
        if (error) console.error('Reminder query error:', error);
      } else {
        for (const reminder of reminders) {
          const jid = (reminder as any).users?.whatsapp_jid;
          const task = (reminder as any).tasks;
          if (!jid || !task || task.status === 'completed') {
            // Mark completed-task reminders as sent so they don't reappear
            if (task?.status === 'completed') {
              await getSupabase()
                .from('reminders')
                .update({ is_sent: true, sent_at: now })
                .eq('id', reminder.id);
            }
            continue;
          }

          const priority =
            task.priority === 'high' ? '\u{1F534}' : task.priority === 'medium' ? '\u{1F7E1}' : '\u{1F535}';
          let message = `\u{1F514} *Reminder*\n\n${priority} *${task.title}*\n`;
          if (task.description) message += `${task.description}\n`;
          if (task.due_date) message += `\u{1F4C5} Due: ${formatReminderDate(task.due_date)}\n`;

          try {
            await sock.sendMessage(jid, { text: message });
            await getSupabase()
              .from('reminders')
              .update({ is_sent: true, sent_at: now })
              .eq('id', reminder.id);
          } catch (err) {
            console.error(`Failed to send reminder to ${jid}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Reminder cron error (pass 1):', err);
    }

    // ── Pass 2: Call escalation (only if enabled) ──
    if (!isCallEscalationEnabled()) return;

    try {
      const candidates = await getEscalationCandidates(env.CALL_ESCALATION_DELAY_MIN);
      if (candidates.length === 0) return;

      for (const reminder of candidates) {
        const jid = (reminder as any).users?.whatsapp_jid;
        const taskTitle = (reminder as any).tasks?.title;
        if (!jid || !taskTitle) continue;

        // Extract phone number from JID (strip @s.whatsapp.net)
        const phone = jid.split('@')[0];
        if (!phone || phone.length < 7) continue;

        // Notify via WhatsApp first
        try {
          await sock.sendMessage(jid, {
            text: `\u{1F4DE} Calling you about: *${taskTitle}*`,
          });
        } catch { /* non-critical */ }

        // Make the call
        await makeReminderCall(phone, taskTitle);

        // Mark as escalated regardless of call success (avoid retry loops)
        await markCallEscalated(reminder.id);

        // 2 second delay between calls
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (err) {
      console.error('Reminder cron error (pass 2 - escalation):', err);
    }
  });

  const escalationNote = isCallEscalationEnabled()
    ? ` + call escalation after ${env.CALL_ESCALATION_DELAY_MIN}min`
    : '';
  console.log(`\u{23F0} Reminder scheduler started (checks every minute${escalationNote})\n`);
}
