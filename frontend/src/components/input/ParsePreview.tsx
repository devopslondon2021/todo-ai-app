"use client";

import { useState } from "react";
import {
  Check,
  X,
  Calendar,
  Bell,
  Tag,
  AlertTriangle,
  Copy,
  Users,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { format } from "date-fns";
import type { ParsedTask, Category, TaskPriority } from "@/types";

interface ParsePreviewProps {
  task: ParsedTask;
  categories: Category[];
  categoryTree: Category[];
  onConfirm: (task: ParsedTask) => void;
  onCancel: () => void;
}

function flattenForSelect(
  tree: Category[],
  depth = 0
): { id: string; label: string; depth: number; parentName?: string }[] {
  const result: { id: string; label: string; depth: number; parentName?: string }[] = [];
  for (const cat of tree) {
    const indent = "\u00A0\u00A0".repeat(depth);
    result.push({ id: cat.id, label: `${indent}${cat.name}`, depth, parentName: cat.name });
    if (cat.children?.length) {
      result.push(...flattenForSelect(cat.children, depth + 1));
    }
  }
  return result;
}

export function ParsePreview({
  task,
  categories,
  categoryTree,
  onConfirm,
  onCancel,
}: ParsePreviewProps) {
  const [edited, setEdited] = useState<ParsedTask>({ ...task });

  function updateField<K extends keyof ParsedTask>(key: K, value: ParsedTask[K]) {
    setEdited((prev) => ({ ...prev, [key]: value }));
  }

  const flatOptions = flattenForSelect(categoryTree);
  const hasDuplicates = edited.duplicates && edited.duplicates.length > 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2 animate-fade-in-up">
      {hasDuplicates && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px]">
          <Copy size={12} className="shrink-0 text-amber-400 mt-0.5" aria-hidden="true" />
          <div>
            <span className="font-medium text-amber-300">
              Similar task{edited.duplicates!.length > 1 ? "s" : ""} found:
            </span>
            {edited.duplicates!.map((d) => (
              <div key={d.id} className="text-amber-400/80 mt-0.5">
                &ldquo;{d.title}&rdquo;{" "}
                <span className="text-amber-500/60">
                  ({Math.round(d.similarity_score * 100)}% match)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
          AI Parsed &mdash; Review &amp; Confirm
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => onConfirm(edited)}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-cta px-2.5 py-1 text-[11px] font-medium text-white hover:bg-green-400 transition-colors duration-150 cursor-pointer"
          >
            <Check size={12} aria-hidden="true" />
            Confirm
          </button>
          <button
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] p-1 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <input
        type="text"
        name="task-title"
        value={edited.title}
        onChange={(e) => updateField("title", e.target.value)}
        aria-label="Task title"
        className="w-full bg-transparent text-[12px] font-medium text-text outline-2 outline-offset-2 outline-transparent focus-visible:outline-primary border-b border-border/30 pb-1.5 transition-[border-color] duration-150 focus-visible:border-primary"
      />

      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <div className="flex items-center gap-1">
          <AlertTriangle size={11} className="text-muted" aria-hidden="true" />
          <select
            value={edited.priority}
            onChange={(e) =>
              updateField("priority", e.target.value as TaskPriority)
            }
            aria-label="Priority"
            className="bg-surface border border-border/50 rounded px-1.5 py-0.5 text-[11px] text-text outline-2 outline-offset-2 outline-transparent focus-visible:outline-primary cursor-pointer"
          >
            {(Object.keys(PRIORITY_CONFIG) as TaskPriority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_CONFIG[p].label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <Tag size={11} className="text-muted" aria-hidden="true" />
          <select
            value={edited.category_id || ""}
            onChange={(e) =>
              updateField("category_id", e.target.value || undefined)
            }
            aria-label="Category"
            className="bg-surface border border-border/50 rounded px-1.5 py-0.5 text-[11px] text-text outline-2 outline-offset-2 outline-transparent focus-visible:outline-primary cursor-pointer"
          >
            <option value="">No category</option>
            {flatOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {edited.due_date && (
          <div className="flex items-center gap-1 text-muted">
            <Calendar size={11} aria-hidden="true" />
            <span>{format(new Date(edited.due_date), "MMM d, h:mm a")}</span>
            {edited.due_date_is_default && (
              <span className="rounded bg-primary/12 px-1.5 py-px text-[9px] font-medium text-primary">
                This week
              </span>
            )}
          </div>
        )}

        {edited.reminder_time && (
          <div className="flex items-center gap-1 text-accent">
            <Bell size={11} aria-hidden="true" />
            <span>
              {format(new Date(edited.reminder_time), "MMM d, h:mm a")}
            </span>
          </div>
        )}

        {edited.is_meeting && (
          <span className="rounded bg-primary/12 px-1.5 py-px text-[9px] font-medium text-primary">
            Meeting
          </span>
        )}

        {edited.attendees && edited.attendees.length > 0 && (
          <div className="flex items-center gap-1 text-muted">
            <Users size={11} aria-hidden="true" />
            <span>{edited.attendees.join(", ")}</span>
          </div>
        )}

        {edited.duration_minutes && (
          <div className="flex items-center gap-1 text-muted">
            <Clock size={11} aria-hidden="true" />
            <span>{edited.duration_minutes}min</span>
          </div>
        )}
      </div>
    </div>
  );
}
