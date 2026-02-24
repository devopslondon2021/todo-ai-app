"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Square,
  CheckSquare,
  Calendar,
  Bell,
  MoreHorizontal,
  Trash2,
  Pencil,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { TaskEditModal } from "./TaskEditModal";
import { isToday, isTomorrow, isPast, startOfDay } from "date-fns";
import type { Task, Category } from "@/types";

function InstagramIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="6" r="1.5" fill="currentColor" />
    </svg>
  );
}

function YouTubeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="2" y="4" width="20" height="16" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="currentColor" />
    </svg>
  );
}

interface TaskCardProps {
  task: Task;
  onUpdate: () => void;
  categories?: Category[];
}

export function TaskCard({ task, onUpdate, categories = [] }: TaskCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [localStatus, setLocalStatus] = useState(task.status);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { toast } = useToast();
  const priority = PRIORITY_CONFIG[task.priority];
  const menuRef = useRef<HTMLDivElement>(null);

  // Detect video platform from title prefix
  const isInstagram = task.title.startsWith("[IG]");
  const isYouTube = task.title.startsWith("[YT]");
  const isVideo = isInstagram || isYouTube;

  // Check if description starts with a URL (video link or meeting link)
  const descriptionUrl = task.description?.startsWith("https://") ? task.description.split("\n")[0] : null;
  const isMeeting = !!task.google_event_id;
  const clickableUrl = (isVideo || isMeeting) && descriptionUrl ? descriptionUrl : null;

  // Sync local status when task prop changes (after refetch)
  if (task.status !== localStatus && !isTransitioning) {
    setLocalStatus(task.status);
  }

  // Escape key handler for dropdown menu
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && menuOpen) {
      setMenuOpen(false);
    }
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [menuOpen, handleKeyDown]);

  async function toggleStatus() {
    if (isTransitioning) return;
    const newStatus = localStatus === "completed" ? "pending" : "completed";

    setLocalStatus(newStatus);
    setIsTransitioning(true);

    try {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: { status: newStatus },
      });
      setTimeout(() => {
        setIsTransitioning(false);
        onUpdate();
      }, 350);
    } catch {
      setLocalStatus(task.status);
      setIsTransitioning(false);
      toast("Failed to update task", "error");
    }
  }

  async function handleDelete() {
    setMenuOpen(false);
    setIsDeleting(true);
    try {
      await api(`/tasks/${task.id}`, { method: "DELETE" });
      toast("Task deleted", "success");
      setTimeout(onUpdate, 300);
    } catch {
      toast("Failed to delete task", "error");
      setIsDeleting(false);
    }
  }

  function handleCardClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    if (clickableUrl) {
      window.open(clickableUrl, "_blank", "noopener");
      return;
    }
    setEditOpen(true);
  }

  function formatDueDate(date: string) {
    const d = new Date(date);
    if (isToday(d)) return "Today";
    if (isTomorrow(d)) return "Tomorrow";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  }

  function formatDueTime(date: string) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date));
  }

  /** True if the due_date has a meaningful time (not midnight 00:00) */
  function hasTime(date: string) {
    const d = new Date(date);
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  }

  const isOverdue = task.due_date && isPast(new Date(task.due_date)) && !isToday(new Date(task.due_date)) && localStatus !== "completed";
  const isComplete = localStatus === "completed";
  const justToggled = isTransitioning && localStatus !== task.status;

  const displayTitle = task.title
    .replace(/^\[(IG|YT)\]\s*/, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const showPriorityBadge = task.priority === "high" || task.priority === "medium";
  const categoryName = task.categories?.name || null;

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-1.5",
        "hover:border-border-light/80 hover:bg-bg-raised/80",
        isComplete
          ? "border-border/25 bg-transparent"
          : "border-border/40 bg-bg-raised",
        isDeleting && "scale-[0.97] opacity-0 translate-x-2",
        justToggled && isComplete && "opacity-50 scale-[0.98]",
        justToggled && !isComplete && "opacity-100 scale-100",
        "cursor-pointer",
      )}
      style={{ transition: "opacity 300ms ease-out, transform 300ms ease-out, background-color 150ms, border-color 150ms" }}
    >
      {/* Checkbox */}
      <button
        onClick={toggleStatus}
        className={cn(
          "shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-bg rounded-sm",
          isTransitioning && "scale-110"
        )}
        style={{ transition: "transform 200ms" }}
        aria-label={isComplete ? "Mark incomplete" : "Mark complete"}
      >
        {isComplete ? (
          <CheckSquare size={18} className="text-cta" aria-hidden="true" />
        ) : (
          <Square
            size={18}
            className="text-border-light hover:text-primary"
            style={{ transition: "color 150ms" }}
            aria-hidden="true"
          />
        )}
      </button>

      {/* Platform icon for video tasks */}
      {isInstagram && (
        <span className="shrink-0 text-[#E1306C]">
          <InstagramIcon size={14} />
        </span>
      )}
      {isYouTube && (
        <span className="shrink-0 text-[#FF0000]">
          <YouTubeIcon size={14} />
        </span>
      )}
      {isMeeting && !isVideo && (
        <span className="shrink-0 text-[#8B5CF6]">
          <Calendar size={14} aria-hidden="true" />
        </span>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3
          className={cn(
            "text-[13px] font-medium text-text truncate",
            isComplete && "line-through text-muted"
          )}
          style={{ transition: "color 300ms, text-decoration-color 300ms" }}
        >
          {displayTitle}
        </h3>

        <div className="flex items-center gap-2 mt-0.5">
          {task.due_date && (
            <span
              className={cn(
                "flex items-center gap-1 text-[11px] shrink-0",
                isOverdue ? "text-danger font-medium" : "text-muted"
              )}
            >
              <Calendar size={10} aria-hidden="true" />
              {formatDueDate(task.due_date)}
              {hasTime(task.due_date) && (
                <span className="text-text-secondary">{" \u2022 "}{formatDueTime(task.due_date)}</span>
              )}
            </span>
          )}

          {task.reminder_time && (
            <span className="flex items-center gap-1 text-[11px] text-accent shrink-0">
              <Bell size={10} aria-hidden="true" />
              Set
            </span>
          )}
        </div>
      </div>

      {/* External link icon for video tasks (visible on hover) */}
      {clickableUrl && (
        <span className="shrink-0 text-muted/30 group-hover:text-muted transition-colors duration-150">
          <ExternalLink size={13} aria-hidden="true" />
        </span>
      )}

      {/* Overdue badge */}
      {isOverdue && (
        <span className="shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-500/20 text-red-400 border border-red-500/20">
          Overdue
        </span>
      )}

      {/* Category badge */}
      {categoryName && (
        <span
          className={cn(
            "shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-medium tracking-wide",
            isComplete && "opacity-40",
          )}
          style={{
            transition: "opacity 300ms",
            backgroundColor: (task.categories?.color || "#6b7280") + "18",
            color: task.categories?.color || "#6b7280",
          }}
        >
          {categoryName}
        </span>
      )}

      {/* Priority badge */}
      {showPriorityBadge && (
        <span
          className={cn(
            "shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            isComplete && "opacity-40",
            `${priority.bg} ${priority.text}`,
          )}
          style={{ transition: "opacity 300ms" }}
        >
          {priority.label.toUpperCase()}
        </span>
      )}

      {/* Three-dot menu */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-muted/30 hover:text-text hover:bg-surface-hover cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
          style={{ transition: "opacity 150ms, color 150ms, background-color 150ms" }}
          aria-label="Task options"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              className="absolute right-0 top-8 z-50 w-36 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised shadow-xl shadow-black/40 py-1 animate-fade-in-up"
            >
              <button
                role="menuitem"
                onClick={() => { setMenuOpen(false); setEditOpen(true); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover cursor-pointer focus-visible:bg-surface-hover focus-visible:outline-none"
                style={{ transition: "background-color 150ms" }}
              >
                <Pencil size={12} aria-hidden="true" />
                Edit
              </button>
              <button
                role="menuitem"
                onClick={handleDelete}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-danger hover:bg-surface-hover cursor-pointer focus-visible:bg-surface-hover focus-visible:outline-none"
                style={{ transition: "background-color 150ms" }}
              >
                <Trash2 size={12} aria-hidden="true" />
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      {/* Edit modal */}
      <TaskEditModal
        task={task}
        categories={categories}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onUpdate={onUpdate}
      />
    </div>
  );
}
