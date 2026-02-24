import { getSupabase } from '../config/supabase';
import type { Task, TaskFilters, DuplicateCandidate } from '../types';

export async function getTasks(filters: TaskFilters): Promise<Task[]> {
  let query = getSupabase()
    .from('tasks')
    .select('*, categories(id, name, color, icon)')
    .eq('user_id', filters.user_id)
    .order('created_at', { ascending: false });

  if (filters.category_id) query = query.eq('category_id', filters.category_id);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.due_date_from) query = query.gte('due_date', filters.due_date_from);
  if (filters.due_date_to) query = query.lte('due_date', filters.due_date_to);
  if (filters.search) query = query.ilike('title', `%${filters.search}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getTaskById(id: string): Promise<Task | null> {
  const { data, error } = await getSupabase()
    .from('tasks')
    .select('*, categories(id, name, color, icon)')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function createTask(taskData: {
  user_id: string;
  category_id?: string;
  title: string;
  description?: string;
  priority?: string;
  due_date?: string;
  reminder_time?: string;
  is_recurring?: boolean;
  recurrence_rule?: string;
  google_event_id?: string;
  google_event_created_by_app?: boolean;
}): Promise<Task> {
  let { data, error } = await getSupabase()
    .from('tasks')
    .insert(taskData)
    .select('*, categories(id, name, color, icon)')
    .single();

  // If the google_event_created_by_app column doesn't exist yet (migration pending), retry without it
  if (error?.code === 'PGRST204' && error.message?.includes('google_event_created_by_app')) {
    const { google_event_created_by_app, ...rest } = taskData;
    ({ data, error } = await getSupabase()
      .from('tasks')
      .insert(rest)
      .select('*, categories(id, name, color, icon)')
      .single());
  }

  if (error) throw error;

  // Create reminder if reminder_time exists
  if (taskData.reminder_time && data) {
    await getSupabase().from('reminders').insert({
      task_id: data.id,
      user_id: taskData.user_id,
      reminder_time: taskData.reminder_time,
    });
  }

  return data;
}

export async function updateTask(id: string, updates: Record<string, unknown>): Promise<Task> {
  const { data, error } = await getSupabase()
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select('*, categories(id, name, color, icon)')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await getSupabase().from('tasks').delete().eq('id', id);
  if (error) throw error;
}

export async function reorderTasks(items: { id: string; sort_order: number }[]): Promise<void> {
  const supabase = getSupabase();
  for (const item of items) {
    const { error } = await supabase
      .from('tasks')
      .update({ sort_order: item.sort_order })
      .eq('id', item.id);
    if (error) throw error;
  }
}

export async function getTaskStats(userId: string) {
  // Exclude "Videos" parent + subcategories (Instagram, YouTube) from stats
  const { data: videoCat } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .eq('name', 'Videos')
    .is('parent_id', null)
    .maybeSingle();

  const excludeIds: string[] = [];
  if (videoCat) {
    excludeIds.push(videoCat.id);
    const { data: subs } = await getSupabase()
      .from('categories')
      .select('id')
      .eq('user_id', userId)
      .eq('parent_id', videoCat.id);
    if (subs) excludeIds.push(...subs.map(s => s.id));
  }

  let query = getSupabase()
    .from('tasks')
    .select('status, category_id')
    .eq('user_id', userId);

  if (excludeIds.length > 0) query = query.not('category_id', 'in', `(${excludeIds.join(',')})`);

  const { data: tasks, error } = await query;

  if (error) throw error;

  const stats = { total: 0, pending: 0, in_progress: 0, completed: 0 };
  for (const task of tasks || []) {
    stats.total++;
    stats[task.status as keyof typeof stats]++;
  }
  return stats;
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
