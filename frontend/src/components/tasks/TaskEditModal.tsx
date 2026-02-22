"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  Calendar,
  AlignLeft,
  Tag,
  Flag,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import type { Task, Category, TaskPriority } from "@/types";

interface TaskEditModalProps {
  task: Task;
  categories: Category[];
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function TaskEditModal({ task, categories, open, onClose, onUpdate }: TaskEditModalProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.due_date ? toLocalDatetime(task.due_date) : "");
  const [categoryId, setCategoryId] = useState(task.category_id || "");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(task.title);
      setDescription(task.description || "");
      setPriority(task.priority);
      setDueDate(task.due_date ? toLocalDatetime(task.due_date) : "");
      setCategoryId(task.category_id || "");
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [open, task]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
  }, [open, onClose]);

  if (!open) return null;

  // Filter to root-level categories only
  const rootCategories = categories.filter((c) => !c.parent_id);

  async function handleSave() {
    if (!title.trim()) {
      toast("Title is required", "error");
      return;
    }
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        category_id: categoryId || null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      };
      await api(`/tasks/${task.id}`, { method: "PATCH", body: updates });
      toast("Task updated", "success");
      onUpdate();
      onClose();
    } catch {
      toast("Failed to update task", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={handleKeyDown}>
        <div
          className="w-full max-w-md rounded-[var(--radius-lg)] border border-border/60 bg-bg-raised shadow-2xl shadow-black/50 animate-fade-in-up"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <h2 className="text-[14px] font-semibold text-text">Edit Task</h2>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-muted hover:text-text hover:bg-surface-hover cursor-pointer"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="px-4 py-3 space-y-3">
            {/* Title */}
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted mb-1">
                Title
              </label>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-border/60 bg-bg px-3 py-1.5 text-[13px] text-text placeholder:text-muted/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                placeholder="Task title"
              />
            </div>

            {/* Description */}
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted mb-1">
                <AlignLeft size={10} />
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-[var(--radius-sm)] border border-border/60 bg-bg px-3 py-1.5 text-[13px] text-text placeholder:text-muted/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 resize-none"
                placeholder="Add details..."
              />
            </div>

            {/* Due date */}
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted mb-1">
                <Calendar size={10} />
                Due Date
              </label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-border/60 bg-bg px-3 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 [color-scheme:dark]"
              />
            </div>

            {/* Priority */}
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted mb-1">
                <Flag size={10} />
                Priority
              </label>
              <div className="flex gap-1.5">
                {(["low", "medium", "high"] as const).map((p) => {
                  const cfg = PRIORITY_CONFIG[p];
                  return (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={cn(
                        "flex-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px] font-medium border cursor-pointer transition-all duration-150",
                        priority === p
                          ? `${cfg.bg} ${cfg.text} border-current/30`
                          : "bg-bg border-border/40 text-muted hover:text-text-secondary hover:border-border-light"
                      )}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted mb-1">
                <Tag size={10} />
                Category
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-border/60 bg-bg px-3 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 [color-scheme:dark]"
              >
                <option value="">No category</option>
                {rootCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/40">
            <span className="text-[10px] text-muted mr-auto">
              {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to save
            </span>
            <button
              onClick={onClose}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium text-muted hover:text-text border border-border/40 hover:border-border-light cursor-pointer transition-all duration-150"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-[var(--radius-sm)] px-4 py-1.5 text-[12px] font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 cursor-pointer transition-all duration-150 flex items-center gap-1.5"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Convert ISO string to datetime-local input value (YYYY-MM-DDTHH:MM) */
function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
