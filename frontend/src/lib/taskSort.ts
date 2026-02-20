import type { Task } from "@/types";

/** Sort by sort_order ascending (if present), preserving original order for tasks without it */
function bySortOrder(a: Task, b: Task): number {
  const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
  return aOrder - bOrder;
}

/** Sort tasks: active first (by sort_order), completed last (by sort_order) */
export function sortTasksCompletedLast(tasks: Task[]): Task[] {
  const active = tasks.filter((t) => t.status !== "completed").sort(bySortOrder);
  const completed = tasks.filter((t) => t.status === "completed").sort(bySortOrder);
  return [...active, ...completed];
}
