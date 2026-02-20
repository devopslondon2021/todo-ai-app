"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  format,
  startOfWeek,
  addWeeks,
  addDays,
  isToday,
  isSameDay,
} from "date-fns";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { sortTasksCompletedLast } from "@/lib/taskSort";
import type { Task } from "@/types";

interface WeeklyViewProps {
  tasks: Task[];
  loading: boolean;
  onUpdate: () => void;
}

export function WeeklyView({ tasks, loading, onUpdate }: WeeklyViewProps) {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function getTasksForDay(day: Date) {
    return sortTasksCompletedLast(
      tasks.filter((t) => t.due_date && isSameDay(new Date(t.due_date), day))
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-7 gap-2">
        {[...Array(7)].map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-[var(--radius-md)] border border-border/40 skeleton"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Week navigator */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWeekStart((w) => addWeeks(w, -1))}
          className="rounded-[var(--radius-sm)] p-1.5 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
          aria-label="Previous week"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-[15px] font-semibold text-text">
          {format(weekStart, "MMM d")} — {format(addDays(weekStart, 6), "MMM d, yyyy")}
        </div>
        <button
          onClick={() => setWeekStart((w) => addWeeks(w, 1))}
          className="rounded-[var(--radius-sm)] p-1.5 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
          aria-label="Next week"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 7-column grid — fits in window, no scrolling */}
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const dayTasks = getTasksForDay(day);
          const today = isToday(day);

          return (
            <div
              key={day.toISOString()}
              className={cn(
                "rounded-[var(--radius-md)] border p-2 transition-all duration-150 min-h-[120px]",
                today
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/50 bg-bg-raised"
              )}
            >
              {/* Day header */}
              <div className="text-center mb-2.5">
                <div
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-widest",
                    today ? "text-primary" : "text-muted"
                  )}
                >
                  {format(day, "EEE")}
                </div>
                <div
                  className={cn(
                    "text-sm font-medium mt-0.5",
                    today ? "text-primary" : "text-text"
                  )}
                >
                  {format(day, "d")}
                </div>
              </div>

              {/* Tasks */}
              {dayTasks.length > 0 ? (
                <div className="space-y-1.5">
                  {dayTasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-[var(--radius-sm)] border border-border/40 bg-surface/50 px-2 py-1.5 text-[10px] flex items-start gap-1.5"
                    >
                      <div
                        className="w-0.5 h-full min-h-[16px] rounded-full shrink-0 mt-0.5"
                        aria-hidden="true"
                        style={{
                          backgroundColor:
                            PRIORITY_CONFIG[task.priority].color,
                        }}
                      />
                      <div className="min-w-0">
                        <div
                          className={cn(
                            "font-medium text-text truncate",
                            task.status === "completed" &&
                              "line-through text-muted"
                          )}
                        >
                          {task.title}
                        </div>
                        {task.categories && (
                          <span
                            className="text-[9px] font-medium"
                            style={{ color: task.categories.color }}
                          >
                            {task.categories.name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-12 border border-dashed border-border/40 rounded-[var(--radius-sm)] text-[11px] text-muted/40">
                  —
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
