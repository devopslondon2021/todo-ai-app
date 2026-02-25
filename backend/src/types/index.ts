export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type AIProviderType = 'openai' | 'ollama';

export interface User {
  id: string;
  whatsapp_jid: string | null;
  phone_number: string | null;
  name: string;
  api_key: string | null;
  google_calendar_connected: boolean;
  google_client_id: string | null;
  google_client_secret: string | null;
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
  google_event_created_by_app?: boolean;
  created_at: string;
  updated_at: string;
  categories?: Category | null;
}

export interface Reminder {
  id: string;
  task_id: string;
  user_id: string;
  reminder_time: string;
  is_sent: boolean;
  sent_at: string | null;
  created_at: string;
}

export interface ParsedTask {
  title: string;
  description: string | null;
  priority: TaskPriority;
  category: string | null;
  subcategory: string | null;
  due_date: string | null;
  reminder_time: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  is_meeting?: boolean;
  has_specific_time?: boolean;
  attendees?: string[] | null;
  duration_minutes?: number | null;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  similarity_score: number;
}

export interface TaskFilters {
  user_id: string;
  category_id?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date_from?: string;
  due_date_to?: string;
  search?: string;
}
