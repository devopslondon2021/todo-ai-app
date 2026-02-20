"use client";

import { List, CalendarDays, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { TaskViewMode } from "@/types";

const VIEWS: { mode: TaskViewMode; icon: typeof List; label: string }[] = [
  { mode: "list", icon: List, label: "List" },
  { mode: "daily", icon: CalendarDays, label: "Day" },
  { mode: "weekly", icon: CalendarRange, label: "Week" },
];

export function ViewToggle() {
  const { viewMode, setViewMode } = useAppStore();

  return (
    <div className="flex items-center rounded-[var(--radius-md)] bg-surface p-1">
      {VIEWS.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className={cn(
            "flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-all duration-150 cursor-pointer",
            viewMode === mode
              ? "bg-surface-active text-text"
              : "text-muted hover:text-text-secondary"
          )}
          aria-label={`${label} view`}
        >
          <Icon size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
