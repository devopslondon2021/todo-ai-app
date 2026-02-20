import { getSupabase } from '../config/supabase';
import type { Reminder } from '../types';

export async function getReminders(userId: string): Promise<Reminder[]> {
  const { data, error } = await getSupabase()
    .from('reminders')
    .select('*, tasks(title, priority, due_date)')
    .eq('user_id', userId)
    .eq('is_sent', false)
    .order('reminder_time', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createReminder(data: {
  task_id: string;
  user_id: string;
  reminder_time: string;
}): Promise<Reminder> {
  const { data: reminder, error } = await getSupabase()
    .from('reminders')
    .insert(data)
    .select('*')
    .single();

  if (error) throw error;
  return reminder;
}

export async function deleteReminder(id: string): Promise<void> {
  const { error } = await getSupabase().from('reminders').delete().eq('id', id);
  if (error) throw error;
}

export async function getPendingReminders(): Promise<any[]> {
  const now = new Date().toISOString();

  const { data, error } = await getSupabase()
    .from('reminders')
    .select('*, tasks(title, description, priority, due_date), users(whatsapp_jid)')
    .eq('is_sent', false)
    .lte('reminder_time', now)
    .limit(50);

  if (error) throw error;
  return data || [];
}

export async function markReminderSent(id: string): Promise<void> {
  await getSupabase()
    .from('reminders')
    .update({ is_sent: true, sent_at: new Date().toISOString() })
    .eq('id', id);
}
