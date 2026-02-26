"use client";

import { useState, useRef, useEffect } from "react";
import {
  LayoutGrid,
  CalendarDays,
  CalendarClock,
  Settings,
  Flame,
  Clock,
  CheckCircle2,
  Sun,
  Plus,
  ChevronRight,
  ChevronDown,
  Trash2,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { api } from "@/lib/api";
import { DEFAULT_CATEGORY_COLORS } from "@/lib/constants";
import { startOfDay, endOfDay } from "date-fns";
import type { User, Category } from "@/types";

interface SidebarProps {
  user: User;
  categories: Category[];
  categoryTree: Category[];
  userId: string;
  onCategoriesChanged: () => void;
  onSettingsClick: () => void;
}

// Inline create form
function CategoryForm({
  parentId,
  userId,
  onDone,
}: {
  parentId: string | null;
  userId: string;
  onDone: (created: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(
    DEFAULT_CATEGORY_COLORS[Math.floor(Math.random() * DEFAULT_CATEGORY_COLORS.length)]
  );
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSave() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await api("/categories", {
        method: "POST",
        body: {
          user_id: userId,
          name: name.trim(),
          color,
          icon: "tag",
          is_default: false,
          parent_id: parentId,
        },
      });
      onDone(true);
    } catch {
      onDone(false);
    }
  }

  return (
    <div className="px-2 py-1.5 space-y-1.5 animate-fade-in-up">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onDone(false);
        }}
        placeholder={parentId ? "Subcategory name" : "Category name"}
        className="w-full bg-surface border border-border/60 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-text placeholder:text-muted/50 outline-none focus-visible:border-primary/50"
      />
      <div className="flex items-center gap-1">
        {DEFAULT_CATEGORY_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={cn(
              "w-4 h-4 rounded-full cursor-pointer transition-transform duration-100 shrink-0",
              color === c ? "ring-2 ring-white/40 scale-110" : "hover:scale-110"
            )}
            style={{ backgroundColor: c }}
            aria-label={`Color ${c}`}
          />
        ))}
        <div className="flex-1" />
        <button
          onClick={() => onDone(false)}
          className="p-0.5 text-muted hover:text-text rounded transition-colors duration-100 cursor-pointer"
          aria-label="Cancel"
        >
          <X size={12} />
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="p-0.5 text-cta hover:text-green-300 rounded transition-colors duration-100 cursor-pointer disabled:opacity-30"
          aria-label="Save"
        >
          <Check size={12} />
        </button>
      </div>
    </div>
  );
}

// Single category item (recursive for children)
function CategoryItem({
  cat,
  activeId,
  navTo,
  userId,
  onCategoriesChanged,
  depth,
}: {
  cat: Category;
  activeId: string;
  navTo: (id: string) => void;
  userId: string;
  onCategoriesChanged: () => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showSubCreate, setShowSubCreate] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const hasChildren = cat.children && cat.children.length > 0;
  const catId = `cat_${cat.id}`;
  const isActive = activeId === catId;

  async function handleDelete() {
    setShowMenu(false);
    try {
      await api(`/categories/${cat.id}`, { method: "DELETE" });
      onCategoriesChanged();
    } catch {
      // silently fail
    }
  }

  return (
    <div>
      <div
        className="group/cat flex items-center"
        style={{ paddingLeft: `${depth * 10}px` }}
      >
        {/* Expand/collapse for parents */}
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-4 h-4 flex items-center justify-center shrink-0 text-muted hover:text-text cursor-pointer"
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Category button */}
        <button
          onClick={() => navTo(catId)}
          className={cn(
            "flex items-center gap-2 flex-1 min-w-0 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12px] font-medium cursor-pointer text-left transition-colors duration-150",
            isActive
              ? "bg-primary/12 text-primary"
              : "text-text-secondary hover:text-text hover:bg-surface-hover"
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: cat.color }}
            aria-hidden="true"
          />
          <span className="truncate">{cat.name}</span>
        </button>

        {/* Actions on hover */}
        <div className="flex items-center shrink-0 opacity-0 group-hover/cat:opacity-100 transition-opacity duration-100">
          {/* Add subcategory (only for root/depth < 2) */}
          {depth < 2 && (
            <button
              onClick={() => setShowSubCreate(true)}
              className="w-5 h-5 flex items-center justify-center text-muted hover:text-primary cursor-pointer rounded transition-colors duration-100"
              aria-label="Add subcategory"
            >
              <Plus size={10} />
            </button>
          )}
          {/* Delete */}
          {!cat.is_default && (
            <button
              onClick={handleDelete}
              className="w-5 h-5 flex items-center justify-center text-muted hover:text-danger cursor-pointer rounded transition-colors duration-100"
              aria-label="Delete category"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {cat.children!.map((child) => (
            <CategoryItem
              key={child.id}
              cat={child}
              activeId={activeId}
              navTo={navTo}
              userId={userId}
              onCategoriesChanged={onCategoriesChanged}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* Subcategory create form */}
      {showSubCreate && (
        <div style={{ paddingLeft: `${(depth + 1) * 10 + 4}px` }}>
          <CategoryForm
            parentId={cat.id}
            userId={userId}
            onDone={(created) => {
              setShowSubCreate(false);
              if (created) onCategoriesChanged();
            }}
          />
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  user,
  categories,
  categoryTree,
  userId,
  onCategoriesChanged,
  onSettingsClick,
}: SidebarProps) {
  const { filters, setFilter, clearFilters, viewMode, setViewMode } = useAppStore();
  const [showCatCreate, setShowCatCreate] = useState(false);

  function getActiveId(): string {
    if (viewMode === "daily") return "cal_today";
    if (viewMode === "weekly") return "cal_week";
    if (filters.category_id) return `cat_${filters.category_id}`;
    if (filters.priority === "high") return "high";
    if (filters.status === "completed") return "completed";
    if (filters.status === "pending") return "upcoming";
    if (filters.due_date_from) return "today";
    return "all";
  }

  const activeId = getActiveId();
  const displayName = user.name || "User";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function navTo(id: string) {
    setViewMode("list");
    clearFilters();
    switch (id) {
      case "all":
        break;
      case "today": {
        const now = new Date();
        setFilter("due_date_from", startOfDay(now).toISOString());
        setFilter("due_date_to", endOfDay(now).toISOString());
        break;
      }
      case "upcoming":
        setFilter("status", "pending");
        break;
      case "high":
        setFilter("priority", "high");
        break;
      case "completed":
        setFilter("status", "completed");
        break;
      case "cal_today":
        setViewMode("daily");
        break;
      case "cal_week":
        setViewMode("weekly");
        break;
      default:
        if (id.startsWith("cat_")) {
          setFilter("category_id", id.replace("cat_", ""));
        }
    }
  }

  const navItemClass = (id: string) =>
    cn(
      "flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium cursor-pointer w-full text-left transition-colors duration-150",
      activeId === id
        ? "bg-primary/12 text-primary"
        : "text-text-secondary hover:text-text hover:bg-surface-hover"
    );

  return (
    <aside className="flex flex-col w-[200px] bg-bg-raised border-r border-border/40 shrink-0">
      {/* User profile */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/30">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
          <span className="text-[11px] font-bold text-primary">{initials}</span>
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-text truncate">{displayName}</p>
          <p className="text-[10px] text-muted truncate">
            {user.phone_number || user.id}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-2">
        {/* My Tasks section */}
        <div className="mb-3">
          <p className="px-3 mb-1 text-[10px] font-bold text-muted uppercase tracking-widest">
            My Tasks
          </p>
          <button onClick={() => navTo("all")} className={navItemClass("all")}>
            <LayoutGrid size={14} aria-hidden="true" />
            All Tasks
          </button>
          <button onClick={() => navTo("today")} className={navItemClass("today")}>
            <Sun size={14} aria-hidden="true" />
            Today
          </button>
          <button onClick={() => navTo("upcoming")} className={navItemClass("upcoming")}>
            <Clock size={14} aria-hidden="true" />
            Upcoming
          </button>
          <button onClick={() => navTo("high")} className={navItemClass("high")}>
            <Flame size={14} aria-hidden="true" />
            High Priority
          </button>
          <button onClick={() => navTo("completed")} className={navItemClass("completed")}>
            <CheckCircle2 size={14} aria-hidden="true" />
            Completed
          </button>
        </div>

        {/* Categories section with tree + create */}
        <div className="mb-3">
          <div className="flex items-center justify-between px-3 mb-1">
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest">
              Categories
            </p>
            <button
              onClick={() => setShowCatCreate(!showCatCreate)}
              className="w-4 h-4 flex items-center justify-center text-muted hover:text-primary cursor-pointer rounded transition-colors duration-100"
              aria-label="Add category"
            >
              <Plus size={11} />
            </button>
          </div>

          {showCatCreate && (
            <CategoryForm
              parentId={null}
              userId={userId}
              onDone={(created) => {
                setShowCatCreate(false);
                if (created) onCategoriesChanged();
              }}
            />
          )}

          {/* Meetings first, then the rest */}
          {[
            ...categoryTree.filter((c) => c.name === "Meetings"),
            ...categoryTree.filter((c) => c.name !== "Meetings"),
          ].map((cat) => (
            <CategoryItem
              key={cat.id}
              cat={{ ...cat, color: cat.name === "Meetings" ? "#EF4444" : cat.color }}
              activeId={activeId}
              navTo={navTo}
              userId={userId}
              onCategoriesChanged={onCategoriesChanged}
              depth={0}
            />
          ))}

          {categoryTree.length === 0 && !showCatCreate && (
            <p className="px-3 py-2 text-[11px] text-muted/50 italic">No categories</p>
          )}
        </div>

        {/* Calendar section */}
        <div className="mb-3">
          <p className="px-3 mb-1 text-[10px] font-bold text-muted uppercase tracking-widest">
            Calendar
          </p>
          <button onClick={() => navTo("cal_today")} className={navItemClass("cal_today")}>
            <CalendarDays size={14} aria-hidden="true" />
            Day View
          </button>
          <button onClick={() => navTo("cal_week")} className={navItemClass("cal_week")}>
            <CalendarClock size={14} aria-hidden="true" />
            Week View
          </button>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="border-t border-border/30 px-2.5 py-2">
        <button
          onClick={onSettingsClick}
          className="flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:text-text hover:bg-surface-hover cursor-pointer w-full transition-colors duration-150"
        >
          <Settings size={14} aria-hidden="true" />
          Settings
        </button>
      </div>
    </aside>
  );
}
