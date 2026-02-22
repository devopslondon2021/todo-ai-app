export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "in_progress" | "completed";
export type TaskViewMode = "list" | "daily" | "weekly";

export interface User {
  id: string;
  whatsapp_jid: string | null;
  phone_number: string | null;
  name: string;
  api_key: string | null;
  google_calendar_connected?: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  is_default: boolean;
  parent_id: string | null;
  created_at: string;
  children?: Category[];
}

export interface Task {
  id: string;
  user_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  reminder_time: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  sort_order?: number;
  google_event_id?: string | null;
  created_at: string;
  updated_at: string;
  categories?: Category | null;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  similarity_score: number;
}

export interface ParsedTask {
  title: string;
  description: string | null;
  priority: TaskPriority;
  category: string | null;
  subcategory: string | null;
  category_id?: string;
  due_date: string | null;
  due_date_is_default?: boolean;
  duplicates?: DuplicateCandidate[];
  reminder_time: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  user_id?: string;
  is_meeting?: boolean;
  attendees?: string[] | null;
  duration_minutes?: number | null;
}

export interface TaskFilters {
  category_id?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date_from?: string;
  due_date_to?: string;
  search?: string;
}

export interface TaskStats {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
}
