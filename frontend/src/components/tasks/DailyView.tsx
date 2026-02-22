"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Sun,
  Sunset,
  Moon,
  Inbox,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays, isToday, isSameDay } from "date-fns";
import { TaskCard } from "./TaskCard";
import { sortTasksCompletedLast } from "@/lib/taskSort";
import type { Task, Category } from "@/types";

interface DailyViewProps {
  tasks: Task[];
  loading: boolean;
  onUpdate: () => void;
  categories?: Category[];
}

type TimeGroup = {
  key: string;
  label: string;
  icon: typeof Sun;
  filter: (task: Task) => boolean;
};

const TIME_GROUPS: TimeGroup[] = [
  {
    key: "morning",
    label: "Morning",
    icon: Sun,
    filter: (t) => {
      if (!t.due_date) return false;
      const h = new Date(t.due_date).getHours();
      return h < 12;
    },
  },
  {
    key: "afternoon",
    label: "Afternoon",
    icon: Sunset,
    filter: (t) => {
      if (!t.due_date) return false;
      const h = new Date(t.due_date).getHours();
      return h >= 12 && h < 17;
    },
  },
  {
    key: "evening",
    label: "Evening",
    icon: Moon,
    filter: (t) => {
      if (!t.due_date) return false;
      const h = new Date(t.due_date).getHours();
      return h >= 17;
    },
  },
  {
    key: "no-time",
    label: "No Time",
    icon: Inbox,
    filter: (t) => !t.due_date,
  },
];

export function DailyView({ tasks, loading, onUpdate, categories = [] }: DailyViewProps) {
  const [date, setDate] = useState(new Date());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const dayTasks = tasks.filter((t) => {
    if (!t.due_date) return isSameDay(date, new Date()); // show no-due-date tasks on "today"
    return isSameDay(new Date(t.due_date), date);
  });

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-[var(--radius-md)] border border-border/40 skeleton"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Date navigator */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setDate((d) => addDays(d, -1))}
          className="rounded-[var(--radius-sm)] p-1.5 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
          aria-label="Previous day"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-center">
          <div className="text-[15px] font-semibold text-text">
            {format(date, "EEEE, MMM d")}
          </div>
          {isToday(date) && (
            <span className="text-[10px] text-primary font-medium">Today</span>
          )}
        </div>
        <button
          onClick={() => setDate((d) => addDays(d, 1))}
          className="rounded-[var(--radius-sm)] p-1.5 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
          aria-label="Next day"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Time groups */}
      {TIME_GROUPS.map(({ key, label, icon: GroupIcon, filter }) => {
        const groupTasks = sortTasksCompletedLast(dayTasks.filter(filter));
        if (groupTasks.length === 0) return null;

        const isCollapsed = collapsed[key];

        return (
          <div key={key}>
            <button
              onClick={() => toggleGroup(key)}
              className="flex items-center gap-2 mb-2 text-[11px] font-bold text-muted uppercase tracking-widest cursor-pointer hover:text-text transition-colors duration-150"
            >
              <GroupIcon size={14} aria-hidden="true" />
              {label}
              <span className="text-[10px] font-normal text-muted/50">
                ({groupTasks.length})
              </span>
              {isCollapsed ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronUp size={12} />
              )}
            </button>
            {!isCollapsed && (
              <div className="space-y-1.5">
                {groupTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onUpdate={onUpdate} categories={categories} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {dayTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-[var(--radius-lg)] bg-surface border border-border/60 mb-3">
            <Sun size={20} className="text-muted" aria-hidden="true" />
          </div>
          <p className="text-[13px] text-muted">
            No tasks for {isToday(date) ? "today" : format(date, "MMM d")}
          </p>
        </div>
      )}
    </div>
  );
}
