"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { TaskCard } from "./TaskCard";
import type { Task, Category } from "@/types";

interface SortableTaskCardProps {
  task: Task;
  onUpdate: () => void;
  categories?: Category[];
}

export function SortableTaskCard({ task, onUpdate, categories }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="group/drag flex items-stretch gap-0">
      <button
        {...attributes}
        {...listeners}
        className="flex items-center px-1 text-muted/30 hover:text-muted cursor-grab active:cursor-grabbing transition-all duration-150 shrink-0 opacity-0 group-hover/drag:opacity-100"
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <TaskCard task={task} onUpdate={onUpdate} categories={categories} />
      </div>
    </div>
  );
}
