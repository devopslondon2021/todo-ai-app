"use client";

import { Search, Plus } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type { Category } from "@/types";

interface HeaderProps {
  categories: Category[];
  onAddTask?: () => void;
}

export function Header({ categories, onAddTask }: HeaderProps) {
  const { filters, setFilter, viewMode } = useAppStore();

  function getTitle(): string {
    if (viewMode === "daily") return "Calendar — Day View";
    if (viewMode === "weekly") return "Calendar — Week";
    if (filters.category_id) {
      const cat = categories.find((c) => c.id === filters.category_id);
      return cat ? cat.name : "Tasks";
    }
    if (filters.priority === "high") return "High Priority";
    if (filters.status === "completed") return "Completed";
    if (filters.status === "pending") return "Upcoming";
    if (filters.due_date_from) return "Today";
    return "All Tasks";
  }

  return (
    <header className="flex items-center gap-4 px-6 py-3 border-b border-border/40">
      <h1 className="text-[18px] font-bold text-text tracking-tight shrink-0">{getTitle()}</h1>

      <div className="flex-1" />

      {/* Search */}
      <div className="relative max-w-[260px] w-full">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          type="text"
          name="header-search"
          autoComplete="off"
          value={filters.search || ""}
          onChange={(e) => setFilter("search", e.target.value || undefined)}
          placeholder={"Search tasks\u2026"}
          aria-label="Search tasks"
          className="w-full rounded-[var(--radius-md)] bg-surface pl-8 pr-3 py-1.5 text-[12px] text-text placeholder:text-muted/60 outline-2 outline-offset-2 outline-transparent focus-visible:outline-primary border border-border/40"
          style={{ transition: "border-color 150ms" }}
        />
      </div>

      {/* Add Task */}
      <button
        onClick={onAddTask}
        className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-soft cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        style={{ transition: "background-color 150ms" }}
      >
        <Plus size={14} aria-hidden="true" />
        Add Task
      </button>
    </header>
  );
}
