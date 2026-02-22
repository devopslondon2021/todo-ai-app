import type { Task } from "@/types";
import type { SortMode } from "@/store/useAppStore";

/** Sort by sort_order ascending (if present), preserving original order for tasks without it */
function bySortOrder(a: Task, b: Task): number {
  const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
  return aOrder - bOrder;
}

/** Sort by due_date ascending (nulls last) */
function byDueDate(a: Task, b: Task): number {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
}

/** Sort tasks: active first, completed last. Active sorted by given mode. */
export function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  const sorter = mode === "date" ? byDueDate : bySortOrder;
  const active = tasks.filter((t) => t.status !== "completed").sort(sorter);
  const completed = tasks.filter((t) => t.status === "completed").sort(sorter);
  return [...active, ...completed];
}

/** Sort tasks: active first (by sort_order), completed last (by sort_order) */
export function sortTasksCompletedLast(tasks: Task[]): Task[] {
  return sortTasks(tasks, "custom");
}
