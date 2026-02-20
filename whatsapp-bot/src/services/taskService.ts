import { getSupabase } from '../config/supabase.js';
import type { ParsedTask } from './aiService.js';

interface User {
  id: string;
  whatsapp_jid: string | null;
  name: string;
}

interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  reminder_time: string | null;
  categories?: { name: string } | null;
}

interface DuplicateCandidate {
  id: string;
  title: string;
  similarity_score: number;
}

/** Get the end of the current week (Friday 23:59:59) as ISO string */
function getEndOfWeekDefault(): string {
  const now = new Date();
  const day = now.getDay();
  const daysUntilFriday = day <= 5 ? 5 - day : 6;
  const friday = new Date(now);
  friday.setDate(now.getDate() + daysUntilFriday);
  friday.setHours(23, 59, 59, 0);
  return friday.toISOString();
}

export async function getOrCreateUser(jid: string): Promise<User> {
  // 1. Look up by exact JID match
  const { data: existing } = await getSupabase()
    .from('users')
    .select('*')
    .eq('whatsapp_jid', jid)
    .single();

  if (existing) return existing;

  const isLid = jid.endsWith('@lid');
  const userPart = jid.split('@')[0];
  const phone = isLid ? null : userPart;

  // 2. If we have a phone number, try to find existing user by phone_number
  if (phone) {
    const { data: byPhone } = await getSupabase()
      .from('users')
      .select('*')
      .eq('phone_number', phone)
      .single();

    if (byPhone) {
      // Link WhatsApp JID to this existing user
      await getSupabase().from('users').update({ whatsapp_jid: jid }).eq('id', byPhone.id);
      return { ...byPhone, whatsapp_jid: jid };
    }
  }

  // 3. If there's a user with no WhatsApp linked (e.g. Default User from frontend), adopt it
  const { data: unlinked } = await getSupabase()
    .from('users')
    .select('*')
    .is('whatsapp_jid', null)
    .limit(1)
    .single();

  if (unlinked) {
    await getSupabase()
      .from('users')
      .update({ whatsapp_jid: jid, phone_number: phone || unlinked.phone_number })
      .eq('id', unlinked.id);
    return { ...unlinked, whatsapp_jid: jid };
  }

  // 4. No existing user found — create a new one
  const name = phone || `User-${userPart.slice(-4)}`;
  const { data: user, error } = await getSupabase()
    .from('users')
    .insert({ whatsapp_jid: jid, phone_number: phone, name })
    .select('*')
    .single();

  if (error) throw error;
  await getSupabase().rpc('seed_default_categories', { p_user_id: user.id });
  return user;
}

/** Resolve category + subcategory names to a category_id */
export async function resolveCategoryPath(
  userId: string,
  categoryName: string | null,
  subcategoryName: string | null
): Promise<string | undefined> {
  if (!categoryName) return undefined;

  // Find parent by name (root level)
  const { data: parent } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .is('parent_id', null)
    .ilike('name', categoryName)
    .single();

  if (!parent) return undefined;

  if (!subcategoryName) return parent.id;

  // Find child by name under parent
  const { data: child } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .eq('parent_id', parent.id)
    .ilike('name', subcategoryName)
    .single();

  return child?.id || parent.id;
}

export async function findDuplicates(userId: string, title: string): Promise<DuplicateCandidate[]> {
  const { data, error } = await getSupabase()
    .rpc('find_similar_tasks', {
      p_user_id: userId,
      p_title: title,
      p_threshold: 0.3,
    });

  if (error) {
    console.error('findDuplicates RPC error:', error);
    return [];
  }
  return data || [];
}

/** Create task with pre-resolved categoryId (avoids duplicate resolution) */
export async function createTask(userId: string, parsed: ParsedTask, categoryId?: string): Promise<Task> {
  const dueDate = parsed.due_date || getEndOfWeekDefault();

  const { data: task, error } = await getSupabase()
    .from('tasks')
    .insert({
      user_id: userId,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      category_id: categoryId,
      due_date: dueDate,
      reminder_time: parsed.reminder_time,
      is_recurring: parsed.is_recurring,
      recurrence_rule: parsed.recurrence_rule,
    })
    .select('*, categories(name)')
    .single();

  if (error) throw error;

  if (parsed.reminder_time && task) {
    await getSupabase().from('reminders').insert({
      task_id: task.id,
      user_id: userId,
      reminder_time: parsed.reminder_time,
    });
  }

  return task;
}

/** Create task from parsed data (resolves category internally) */
export async function createTaskFromParsed(userId: string, parsed: ParsedTask): Promise<Task> {
  const categoryId = await resolveCategoryPath(userId, parsed.category, parsed.subcategory);
  return createTask(userId, parsed, categoryId);
}

export async function getRecentTasks(userId: string): Promise<Task[]> {
  const { data, error } = await getSupabase()
    .from('tasks')
    .select('*, categories(name)')
    .eq('user_id', userId)
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data || [];
}

export async function getTasksForWhatsApp(userId: string, filter?: string): Promise<Task[]> {
  let query = getSupabase()
    .from('tasks')
    .select('*, categories(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (filter) {
    const f = filter.toLowerCase();
    if (f === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      query = query.gte('due_date', start.toISOString()).lte('due_date', end.toISOString());
    } else if (['pending', 'in_progress', 'completed'].includes(f)) {
      query = query.eq('status', f);
    } else {
      // Try as category name
      query = query.ilike('categories.name' as any, f);
    }
  } else {
    query = query.neq('status', 'completed');
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function markComplete(taskId: string): Promise<void> {
  await getSupabase().from('tasks').update({ status: 'completed' }).eq('id', taskId);
}

export async function deleteTask(taskId: string): Promise<void> {
  await getSupabase().from('tasks').delete().eq('id', taskId);
}

export async function getCategories(userId: string) {
  const { data, error } = await getSupabase()
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/** Get categories as a tree for WhatsApp display */
export async function getCategoryTree(userId: string) {
  const all = await getCategories(userId);
  const map = new Map<string, any>();
  const roots: any[] = [];

  for (const cat of all) {
    map.set(cat.id, { ...cat, children: [] });
  }

  for (const cat of all) {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
