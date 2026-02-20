"use client";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { Category } from "@/types";

interface TaskFiltersProps {
  categories: Category[];
}

interface FilterChip {
  id: string;
  label: string;
  color: string;
  action: () => void;
  isActive: boolean;
}

export function TaskFilters({ categories }: TaskFiltersProps) {
  const { filters, setFilter, clearFilters } = useAppStore();

  const chips: FilterChip[] = [
    {
      id: "all",
      label: "All",
      color: "#E4E5EA",
      action: () => clearFilters(),
      isActive: !filters.status && !filters.priority && !filters.category_id,
    },
    {
      id: "today",
      label: "Today",
      color: "#8B7CF6",
      action: () => {
        clearFilters();
        // Today filter — clear other filters, keep as default view
      },
      isActive: false,
    },
    {
      id: "upcoming",
      label: "Upcoming",
      color: "#C084FC",
      action: () => {
        clearFilters();
        setFilter("status", "pending");
      },
      isActive: filters.status === "pending" && !filters.priority && !filters.category_id,
    },
    {
      id: "high",
      label: "High Priority",
      color: "#F87171",
      action: () => {
        clearFilters();
        setFilter("priority", "high");
      },
      isActive: filters.priority === "high" && !filters.category_id,
    },
    ...categories.map((cat) => ({
      id: cat.id,
      label: cat.name,
      color: cat.color,
      action: () => {
        clearFilters();
        setFilter("category_id", cat.id);
      },
      isActive: filters.category_id === cat.id,
    })),
  ];

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map((chip) => (
        <button
          key={chip.id}
          onClick={chip.action}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-150 cursor-pointer border",
            chip.isActive
              ? "bg-surface-active border-border-light text-text"
              : "bg-transparent border-border/40 text-muted hover:text-text-secondary hover:border-border-light"
          )}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: chip.color }}
            aria-hidden="true"
          />
          {chip.label}
        </button>
      ))}
    </div>
  );
}
