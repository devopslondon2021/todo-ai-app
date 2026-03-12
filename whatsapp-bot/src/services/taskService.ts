import { getSupabase } from '../config/supabase.js';
import { getAllVideoCategoryIds } from './videoService.js';
import { splitFilter } from '../handlers/commandParser.js';
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
  google_event_id?: string | null;
  google_event_created_by_app?: boolean;
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

export async function getOrCreateUser(jid: string, pushName?: string): Promise<User> {
  // 1. Look up by exact JID match
  const { data: existing } = await getSupabase()
    .from('users')
    .select('*')
    .eq('whatsapp_jid', jid)
    .single();

  if (existing) {
    // Update name if we got a pushName and the stored name is just a phone number
    if (pushName && existing.name === existing.phone_number) {
      await getSupabase().from('users').update({ name: pushName }).eq('id', existing.id);
      return { ...existing, name: pushName };
    }
    return existing;
  }

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
      // Link WhatsApp JID + update name if available
      const updates: Record<string, any> = { whatsapp_jid: jid };
      if (pushName && byPhone.name === byPhone.phone_number) updates.name = pushName;
      await getSupabase().from('users').update(updates).eq('id', byPhone.id);
      return { ...byPhone, ...updates };
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
    const updates: Record<string, any> = {
      whatsapp_jid: jid,
      phone_number: phone || unlinked.phone_number,
    };
    if (pushName) updates.name = pushName;
    await getSupabase().from('users').update(updates).eq('id', unlinked.id);
    return { ...unlinked, ...updates };
  }

  // 4. No existing user found — create a new one
  const name = pushName || phone || `User-${userPart.slice(-4)}`;
  const { data: user, error } = await getSupabase()
    .from('users')
    .insert({ whatsapp_jid: jid, phone_number: phone, name })
    .select('*')
    .single();

  if (error) throw error;
  await getSupabase().rpc('seed_default_categories', { p_user_id: user.id });
  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Resolve category + subcategory names to a category_id (auto-creates if missing) */
export async function resolveCategoryPath(
  userId: string,
  categoryName: string | null,
  subcategoryName: string | null
): Promise<string | undefined> {
  // Default to "Personal" if no category provided
  const resolvedName = categoryName || 'Personal';

  // Find parent by name (root level)
  let { data: parent } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .is('parent_id', null)
    .ilike('name', resolvedName)
    .single();

  // Auto-create the category if it doesn't exist
  if (!parent) {
    const { data: created } = await getSupabase()
      .from('categories')
      .insert({ user_id: userId, name: resolvedName })
      .select('id')
      .single();
    if (!created) return undefined;
    parent = created;
  }

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

/** Check if a user has Google Calendar connected */
export async function isCalendarConnected(userId: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from('users')
    .select('google_calendar_connected')
    .eq('id', userId)
    .single();

  return !!data?.google_calendar_connected;
}

/** Create task with pre-resolved categoryId (avoids duplicate resolution) */
export async function createTask(userId: string, parsed: ParsedTask, categoryId?: string, googleEventId?: string): Promise<Task> {
  const dueDate = parsed.due_date || getEndOfWeekDefault();

  const insertData: Record<string, any> = {
    user_id: userId,
    title: parsed.title,
    description: parsed.description,
    priority: parsed.priority,
    category_id: categoryId,
    due_date: dueDate,
    reminder_time: parsed.reminder_time,
    is_recurring: parsed.is_recurring,
    recurrence_rule: parsed.recurrence_rule,
  };
  if (googleEventId) {
    insertData.google_event_id = googleEventId;
    insertData.google_event_created_by_app = true;
  }

  let { data: task, error } = await getSupabase()
    .from('tasks')
    .insert(insertData)
    .select('*, categories(name)')
    .single();

  // If google_event_created_by_app column doesn't exist yet (migration pending), retry without it
  if (error?.code === 'PGRST204' && error.message?.includes('google_event_created_by_app')) {
    delete insertData.google_event_created_by_app;
    ({ data: task, error } = await getSupabase()
      .from('tasks')
      .insert(insertData)
      .select('*, categories(name)')
      .single());
  }

  if (error) throw error;

  // Determine reminder time: use explicit value, or default to 30 min before due_date
  let reminderTime = parsed.reminder_time;
  if (!reminderTime && dueDate && task) {
    const rt = new Date(new Date(dueDate).getTime() - 30 * 60_000);
    if (rt.getTime() > Date.now()) reminderTime = rt.toISOString();
  }

  if (reminderTime && task) {
    const reminderDate = new Date(reminderTime);
    if (reminderDate.getTime() > Date.now()) {
      await getSupabase().from('reminders').insert({
        task_id: task.id,
        user_id: userId,
        reminder_time: reminderTime,
      });
    } else {
      console.log(`[TASK] Skipping reminder — time is in the past: ${reminderTime}`);
    }
  }

  return task;
}

/** Create task from parsed data (resolves category internally) */
export async function createTaskFromParsed(userId: string, parsed: ParsedTask): Promise<Task> {
  const categoryId = await resolveCategoryPath(userId, parsed.category, parsed.subcategory);
  return createTask(userId, parsed, categoryId);
}

export async function getRecentTasks(userId: string): Promise<Task[]> {
  const videoCatIds = await getAllVideoCategoryIds(userId);

  let query = getSupabase()
    .from('tasks')
    .select('*, categories(name)')
    .eq('user_id', userId)
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20);

  if (videoCatIds.length > 0) query = query.or(`category_id.not.in.(${videoCatIds.join(',')}),category_id.is.null`);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Parse a time filter string into a date range */
const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
  april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
  august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

/** Build a single-day range (00:00 to 23:59) */
function dayRange(d: Date): { start: Date; end: Date } {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Get the next occurrence of a weekday (0=Sun..6=Sat). If today is that day, returns today. */
function nextWeekday(dayNum: number, now: Date): Date {
  const d = new Date(now);
  const diff = (dayNum - now.getDay() + 7) % 7;
  d.setDate(now.getDate() + (diff === 0 ? 0 : diff));
  return d;
}

function parseTimeFilter(filter: string): { start: Date; end: Date } | null {
  const f = filter.toLowerCase().trim();
  const now = new Date();

  // today / tomorrow / yesterday / day after tomorrow
  if (f === 'today') return dayRange(now);
  if (f === 'tomorrow') {
    const d = new Date(now); d.setDate(d.getDate() + 1); return dayRange(d);
  }
  if (f === 'yesterday') {
    const d = new Date(now); d.setDate(d.getDate() - 1); return dayRange(d);
  }
  if (f === 'day after tomorrow') {
    const d = new Date(now); d.setDate(d.getDate() + 2); return dayRange(d);
  }

  // this week / next week
  if (f === 'this week') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(now.getDate() + (7 - now.getDay()));
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (f === 'next week') {
    const daysUntilNextMon = ((8 - now.getDay()) % 7) || 7;
    const start = new Date(now); start.setDate(now.getDate() + daysUntilNextMon); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  // Day names: "friday", "this friday", "next friday"
  const dayPrefixMatch = f.match(/^(this|next)\s+(.+)$/);
  const dayWord = dayPrefixMatch ? dayPrefixMatch[2] : f;
  const prefix = dayPrefixMatch ? dayPrefixMatch[1] : null;
  if (DAY_NAMES[dayWord] !== undefined) {
    const dayNum = DAY_NAMES[dayWord];
    if (prefix === 'next') {
      // "next friday" = the friday AFTER this coming one
      const d = nextWeekday(dayNum, now);
      // If it's today or this week, push to next week
      const diff = (dayNum - now.getDay() + 7) % 7;
      if (diff === 0 || diff <= 6) d.setDate(d.getDate() + (diff === 0 ? 7 : (diff <= 6 ? 7 : 0)));
      // Simpler: always add 7 from the natural next occurrence if prefix is "next"
      const base = nextWeekday(dayNum, now);
      base.setDate(base.getDate() + 7);
      return dayRange(base);
    }
    // "friday" or "this friday" = the coming one (or today if it is that day)
    return dayRange(nextWeekday(dayNum, now));
  }

  // Specific dates: "10th march", "march 10", "10 mar", "10th", "the 10th"
  const parsed = parseSpecificDate(f, now);
  if (parsed) return dayRange(parsed);

  return null;
}

/** Parse specific date strings like "10th march", "march 10", "10/3", "10-03", "the 10th" */
function parseSpecificDate(f: string, now: Date): Date | null {
  // Strip ordinal suffixes and common filler
  const cleaned = f.replace(/\b(the|of|on)\b/g, '').replace(/(st|nd|rd|th)\b/gi, '').trim().replace(/\s+/g, ' ');

  // "10 march" or "10 mar"
  const dayMonthMatch = cleaned.match(/^(\d{1,2})\s+([a-z]+)$/);
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1], 10);
    const month = MONTH_NAMES[dayMonthMatch[2]];
    if (month !== undefined && day >= 1 && day <= 31) {
      return buildDate(day, month, now);
    }
  }

  // "march 10" or "mar 10"
  const monthDayMatch = cleaned.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (monthDayMatch) {
    const month = MONTH_NAMES[monthDayMatch[1]];
    const day = parseInt(monthDayMatch[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      return buildDate(day, month, now);
    }
  }

  // "10/3" or "10-3" or "10/03" (day/month format)
  const slashMatch = cleaned.match(/^(\d{1,2})[/\-](\d{1,2})$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10) - 1; // 0-indexed
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return buildDate(day, month, now);
    }
  }

  // Just a day number: "10", "the 10" → assume current or next month
  const justDayMatch = cleaned.match(/^(\d{1,2})$/);
  if (justDayMatch) {
    const day = parseInt(justDayMatch[1], 10);
    if (day >= 1 && day <= 31) {
      const d = new Date(now.getFullYear(), now.getMonth(), day);
      // If that day already passed this month, use next month
      if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        d.setMonth(d.getMonth() + 1);
      }
      return d;
    }
  }

  return null;
}

/** Build a Date for day/month, using current year (or next year if the date has passed) */
function buildDate(day: number, month: number, now: Date): Date {
  const d = new Date(now.getFullYear(), month, day);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  if (d < today) d.setFullYear(d.getFullYear() + 1);
  return d;
}

export async function getTasksForWhatsApp(userId: string, filter?: string, search?: string): Promise<Task[]> {
  const videoCatIds = await getAllVideoCategoryIds(userId);

  let query = getSupabase()
    .from('tasks')
    .select('*, categories(name)')
    .eq('user_id', userId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(20);

  if (videoCatIds.length > 0) query = query.or(`category_id.not.in.(${videoCatIds.join(',')}),category_id.is.null`);

  if (filter) {
    const f = filter.toLowerCase();
    const dateRange = parseTimeFilter(f);

    if (f === 'overdue') {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      query = query
        .neq('status', 'completed')
        .lt('due_date', now.toISOString());
    } else if (dateRange) {
      query = query
        .neq('status', 'completed')
        .gte('due_date', dateRange.start.toISOString())
        .lte('due_date', dateRange.end.toISOString());
    } else if (['pending', 'in_progress', 'completed'].includes(f)) {
      query = query.eq('status', f);
    } else {
      // Try splitting compound filter (e.g. "work today", "personal tomorrow")
      const { time, category } = splitFilter(f);
      const compoundRange = time ? parseTimeFilter(time) : null;

      query = query.neq('status', 'completed');
      if (compoundRange) {
        query = query
          .gte('due_date', compoundRange.start.toISOString())
          .lte('due_date', compoundRange.end.toISOString());
      }
      if (category) {
        query = query.ilike('categories.name' as any, category);
      }
      // If neither time nor category extracted, treat whole string as category name
      if (!compoundRange && !category) {
        query = query.ilike('categories.name' as any, f);
      }
    }
  } else {
    // Default list: show non-completed tasks from today onwards
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    query = query
      .neq('status', 'completed')
      .or(`due_date.gte.${todayStart.toISOString()},due_date.is.null`);
  }

  if (search) {
    const keywords = search.split(/\s+/).filter(w => w.length >= 2);
    if (keywords.length > 1) {
      // Match tasks containing ANY keyword (OR)
      query = query.or(keywords.map(k => `title.ilike.%${k}%`).join(','));
    } else if (keywords.length === 1) {
      query = query.ilike('title', `%${keywords[0]}%`);
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Find an active task by keyword search (for "done with X" style commands) */
export async function findTaskByKeywords(userId: string, search: string): Promise<Task | null> {
  const keywords = search.split(/\s+/).filter(w => w.length >= 2);
  if (keywords.length === 0) return null;

  let query = getSupabase()
    .from('tasks')
    .select('*, categories(name)')
    .eq('user_id', userId)
    .neq('status', 'completed')
    .limit(10);

  if (keywords.length > 1) {
    query = query.or(keywords.map(k => `title.ilike.%${k}%`).join(','));
  } else {
    query = query.ilike('title', `%${keywords[0]}%`);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;

  // Score by how many keywords match (more = better)
  const scored = data.map(task => {
    const titleLower = task.title.toLowerCase();
    const matches = keywords.filter(k => titleLower.includes(k.toLowerCase())).length;
    return { task, matches };
  });
  scored.sort((a, b) => b.matches - a.matches);

  return scored[0].task;
}

export async function markComplete(taskId: string): Promise<void> {
  await getSupabase().from('tasks').update({ status: 'completed' }).eq('id', taskId);
  // Cancel any unsent reminders for this task
  await getSupabase().from('reminders').update({ is_sent: true }).eq('task_id', taskId).eq('is_sent', false);
}

export async function moveTask(taskId: string, userId: string, newDueDate: string): Promise<Task> {
  // Update the task's due_date
  const { data: task, error } = await getSupabase()
    .from('tasks')
    .update({ due_date: newDueDate })
    .eq('id', taskId)
    .select('*, categories(name)')
    .single();

  if (error) throw error;

  // Cancel old unsent reminders for this task
  await getSupabase()
    .from('reminders')
    .update({ is_sent: true })
    .eq('task_id', taskId)
    .eq('is_sent', false);

  // Create a new reminder 30 min before the new due date (if in future)
  const reminderTime = new Date(new Date(newDueDate).getTime() - 30 * 60_000);
  if (reminderTime.getTime() > Date.now()) {
    await getSupabase().from('reminders').insert({
      task_id: taskId,
      user_id: userId,
      reminder_time: reminderTime.toISOString(),
    });
  }

  return task;
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

/** Mark recent unacknowledged reminders as acknowledged for a user */
export async function acknowledgeReminders(userId: string): Promise<void> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();

  await getSupabase()
    .from('reminders')
    .update({ acknowledged: true })
    .eq('user_id', userId)
    .eq('is_sent', true)
    .eq('acknowledged', false)
    .gte('sent_at', thirtyMinAgo);
}

/** Get sent, unacknowledged, non-escalated reminders older than delayMin */
export async function getEscalationCandidates(delayMin: number) {
  const cutoff = new Date(Date.now() - delayMin * 60_000).toISOString();

  const { data, error } = await getSupabase()
    .from('reminders')
    .select(`
      id,
      tasks (title),
      users (whatsapp_jid)
    `)
    .eq('is_sent', true)
    .eq('acknowledged', false)
    .eq('call_escalated', false)
    .lte('sent_at', cutoff)
    .limit(50);

  if (error) {
    console.error('[ESCALATION] Query error:', error);
    return [];
  }
  return data || [];
}

/** Mark a reminder as call-escalated */
export async function markCallEscalated(reminderId: string): Promise<void> {
  await getSupabase()
    .from('reminders')
    .update({ call_escalated: true })
    .eq('id', reminderId);
}

export async function getTaskStats(userId: string) {
  const videoCatIds = await getAllVideoCategoryIds(userId);

  let query = getSupabase()
    .from('tasks')
    .select('status')
    .eq('user_id', userId);

  if (videoCatIds.length > 0) query = query.or(`category_id.not.in.(${videoCatIds.join(',')}),category_id.is.null`);

  const { data: tasks, error } = await query;
  if (error) throw error;

  const stats = { total: 0, pending: 0, in_progress: 0, completed: 0 };
  for (const task of tasks || []) {
    stats.total++;
    const s = task.status as keyof typeof stats;
    if (s in stats) stats[s]++;
  }
  return stats;
}

export async function getUpcomingReminders(userId: string) {
  const { data, error } = await getSupabase()
    .from('reminders')
    .select('id, reminder_time, tasks(title)')
    .eq('user_id', userId)
    .eq('is_sent', false)
    .order('reminder_time', { ascending: true })
    .limit(10);

  if (error) throw error;
  return data || [];
}

/** Get upcoming meetings (tasks in "Meetings" category), optionally filtered by date */
export async function getMeetings(userId: string, filter?: string) {
  // Find the Meetings category
  const { data: cat } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .is('parent_id', null)
    .ilike('name', 'Meetings')
    .single();

  if (!cat) return [];

  let query = getSupabase()
    .from('tasks')
    .select('*, categories(name)')
    .eq('user_id', userId)
    .eq('category_id', cat.id)
    .neq('status', 'completed')
    .order('due_date', { ascending: true })
    .limit(15);

  if (filter) {
    const dateRange = parseTimeFilter(filter);
    if (dateRange) {
      query = query
        .gte('due_date', dateRange.start.toISOString())
        .lte('due_date', dateRange.end.toISOString());
    }
  } else {
    // No filter = today + future only (exclude past meetings)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    query = query.gte('due_date', todayStart.toISOString());
  }

  const { data, error } = await query;
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
