"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { TaskCard } from "./TaskCard";
import { SortableTaskCard } from "./SortableTaskCard";
import { ChevronDown, ChevronRight, ClipboardList, Sparkles } from "lucide-react";
import { sortTasksCompletedLast } from "@/lib/taskSort";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import type { Task } from "@/types";

interface TaskListProps {
  tasks: Task[];
  loading: boolean;
  onUpdate: () => void;
}

export function TaskList({ tasks, loading, onUpdate }: TaskListProps) {
  const { toast } = useToast();
  const [completedOpen, setCompletedOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sorted = sortTasksCompletedLast(tasks);
  const activeTasks = sorted.filter((t) => t.status !== "completed");
  const completedTasks = sorted.filter((t) => t.status === "completed");

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = activeTasks.findIndex((t) => t.id === active.id);
      const newIndex = activeTasks.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...activeTasks];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const items = reordered.map((t, i) => ({ id: t.id, sort_order: i + 1 }));

      try {
        await api("/tasks/reorder", {
          method: "PATCH",
          body: { items },
        });
        onUpdate();
      } catch {
        toast("Reorder failed — run the sort_order migration first", "error");
      }
    },
    [activeTasks, onUpdate, toast]
  );

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-[var(--radius-md)] skeleton"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] bg-surface border border-border/40 mb-2.5">
          <ClipboardList size={18} className="text-muted" aria-hidden="true" />
        </div>
        <h2 className="text-[13px] font-medium text-text mb-0.5">No tasks yet</h2>
        <p className="text-[11px] text-muted max-w-[240px] leading-relaxed">
          Type a task below in plain English
        </p>
        <p className="flex items-center gap-1 mt-1.5 text-[11px] text-primary/70 font-medium">
          <Sparkles size={11} aria-hidden="true" />
          &ldquo;Buy groceries tomorrow at 5pm&rdquo;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Active tasks — draggable */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={activeTasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {activeTasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onUpdate={onUpdate} />
          ))}
        </SortableContext>
      </DndContext>

      {/* Completed section — collapsible */}
      {completedTasks.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setCompletedOpen(!completedOpen)}
            className="flex items-center gap-1.5 px-1 py-1.5 text-[13px] font-medium text-muted hover:text-text-secondary transition-colors duration-150 cursor-pointer"
          >
            {completedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Completed ({completedTasks.length})
          </button>

          {completedOpen && (
            <div className="space-y-1.5 mt-1.5">
              {completedTasks.map((task) => (
                <TaskCard key={task.id} task={task} onUpdate={onUpdate} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
