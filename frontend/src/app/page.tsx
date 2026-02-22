"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { StatCards } from "@/components/tasks/StatCards";
import { TaskList } from "@/components/tasks/TaskList";
import { DailyView } from "@/components/tasks/DailyView";
import { WeeklyView } from "@/components/tasks/WeeklyView";
import { SmartInput } from "@/components/input/SmartInput";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { ToastProvider } from "@/components/ui/Toast";
import { useUser } from "@/hooks/useUser";
import { useTasks } from "@/hooks/useTasks";
import { useCategories } from "@/hooks/useCategories";
import { useAppStore } from "@/store/useAppStore";
import { isToday as isTodayFn } from "date-fns";
import type { Task, Category, TaskStats, User } from "@/types";

// Demo data for when backend is not available
const DEMO_USER: User = {
  id: "demo-user",
  whatsapp_jid: null,
  phone_number: null,
  name: "Demo User",
  api_key: null,
  created_at: new Date().toISOString(),
};

const DEMO_CATEGORIES: Category[] = [
  { id: "cat-1", user_id: "demo-user", name: "Personal", color: "#EF4444", icon: "user", is_default: true, parent_id: null, created_at: new Date().toISOString() },
  { id: "cat-2", user_id: "demo-user", name: "Work", color: "#3B82F6", icon: "briefcase", is_default: true, parent_id: null, created_at: new Date().toISOString() },
];

const DEMO_TASKS: Task[] = [
  {
    id: "task-1", user_id: "demo-user", category_id: "cat-2", title: "Review pull request for auth module",
    description: "Check the new OAuth2 implementation", priority: "high", status: "pending",
    due_date: new Date(Date.now() + 3600000 * 3).toISOString(), reminder_time: new Date(Date.now() + 3600000 * 2).toISOString(),
    is_recurring: false, recurrence_rule: null, sort_order: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    categories: DEMO_CATEGORIES[1],
  },
  {
    id: "task-2", user_id: "demo-user", category_id: "cat-1", title: "Buy groceries for the week",
    description: "Milk, eggs, bread, vegetables, fruits", priority: "medium", status: "pending",
    due_date: new Date(Date.now() + 86400000).toISOString(), reminder_time: null,
    is_recurring: false, recurrence_rule: null, sort_order: 2, created_at: new Date(Date.now() - 3600000).toISOString(), updated_at: new Date().toISOString(),
    categories: DEMO_CATEGORIES[0],
  },
  {
    id: "task-3", user_id: "demo-user", category_id: "cat-2", title: "Prepare slides for team standup",
    description: null, priority: "medium", status: "in_progress",
    due_date: new Date(Date.now() + 7200000).toISOString(), reminder_time: new Date(Date.now() + 3600000).toISOString(),
    is_recurring: true, recurrence_rule: "FREQ=WEEKLY;BYDAY=MO", sort_order: 3, created_at: new Date(Date.now() - 7200000).toISOString(), updated_at: new Date().toISOString(),
    categories: DEMO_CATEGORIES[1],
  },
  {
    id: "task-4", user_id: "demo-user", category_id: "cat-1", title: "Call mom for her birthday",
    description: "Don't forget the gift!", priority: "high", status: "pending",
    due_date: new Date(Date.now() + 86400000 * 2).toISOString(), reminder_time: new Date(Date.now() + 86400000 * 2 - 3600000).toISOString(),
    is_recurring: false, recurrence_rule: null, sort_order: 4, created_at: new Date(Date.now() - 10800000).toISOString(), updated_at: new Date().toISOString(),
    categories: DEMO_CATEGORIES[0],
  },
  {
    id: "task-5", user_id: "demo-user", category_id: "cat-2", title: "Deploy v2.1 to staging",
    description: "Run smoke tests after deployment", priority: "low", status: "completed",
    due_date: new Date(Date.now() - 86400000).toISOString(), reminder_time: null,
    is_recurring: false, recurrence_rule: null, sort_order: 5, created_at: new Date(Date.now() - 86400000 * 2).toISOString(), updated_at: new Date().toISOString(),
    categories: DEMO_CATEGORIES[1],
  },
];

function Dashboard() {
  const { user: liveUser, loading: userLoading } = useUser();
  const { filters, hydrate, viewMode, clearFilters } = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const isDemo = !userLoading && !liveUser;
  const user = liveUser || DEMO_USER;
  const effectiveUserId = userLoading || isDemo ? undefined : user.id;

  // Fetch ALL tasks (unfiltered) — filter client-side so stats stay constant
  const { tasks: liveTasks, loading: tasksLoading, refetch } = useTasks(effectiveUserId);
  const { categories: liveCategories, categoryTree: liveCategoryTree, refetch: refetchCategories } = useCategories(effectiveUserId);

  const categories = isDemo ? DEMO_CATEGORIES : liveCategories;
  const categoryTree = isDemo ? DEMO_CATEGORIES : liveCategoryTree;

  const allTasks = isDemo ? DEMO_TASKS : liveTasks;

  // Identify video-related categories: "Videos" parent + its children (Instagram, YouTube)
  const videoCategoryIds = useMemo(() => {
    const ids = new Set<string>();
    const videoParent = categories.find(c => c.name === 'Videos' && !c.parent_id);
    if (videoParent) {
      ids.add(videoParent.id);
      categories.filter(c => c.parent_id === videoParent.id).forEach(c => ids.add(c.id));
    }
    return ids;
  }, [categories]);

  // Check if user is viewing a video category (parent or subcategory)
  const isVideoCategory = !!(filters.category_id && videoCategoryIds.has(filters.category_id));
  const isVideoParent = !!(filters.category_id &&
    categories.find(c => c.id === filters.category_id && c.name === 'Videos' && !c.parent_id));

  // Client-side filtering — exclude video tasks unless a video category is selected
  const tasks = useMemo(() => {
    return allTasks.filter((t) => {
      // Hide video tasks from all views EXCEPT when a video category is selected
      if (!isVideoCategory && t.category_id && videoCategoryIds.has(t.category_id)) return false;
      // When "Videos" parent is selected, show tasks from all subcategories
      if (isVideoParent) {
        if (!t.category_id || !videoCategoryIds.has(t.category_id)) return false;
      } else if (filters.category_id && t.category_id !== filters.category_id) {
        return false;
      }
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.due_date_from && filters.due_date_to) {
        if (!t.due_date) return false;
        if (!isTodayFn(new Date(t.due_date))) return false;
      }
      return true;
    });
  }, [allTasks, filters, isVideoCategory, isVideoParent, videoCategoryIds]);

  // Stats exclude video tasks
  const stats: TaskStats = useMemo(() => {
    const nonVideo = allTasks.filter(t => !t.category_id || !videoCategoryIds.has(t.category_id));
    return {
      total: nonVideo.length,
      pending: nonVideo.filter((t) => t.status === "pending").length,
      in_progress: nonVideo.filter((t) => t.status === "in_progress").length,
      completed: nonVideo.filter((t) => t.status === "completed").length,
    };
  }, [allTasks, videoCategoryIds]);

  const handleRefetch = useCallback(() => {
    if (!isDemo) refetch();
  }, [isDemo, refetch]);

  function handleAddTask() {
    // Focus the smart input
    const input = document.querySelector<HTMLInputElement>('input[name="task-input"]');
    input?.focus();
  }

  if (userLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
          <span className="text-[13px] text-muted">Loading&hellip;</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen bg-bg overflow-hidden">
      <Sidebar
        user={user}
        categories={categories}
        categoryTree={categoryTree}
        userId={user.id}
        onCategoriesChanged={refetchCategories}
        onSettingsClick={() => setSettingsOpen(true)}
      />

      <div className="flex flex-1 flex-col min-w-0">
        <Header categories={categories} onAddTask={handleAddTask} />

        <main id="main" className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-4 space-y-4">
            {isDemo && (
              <div className="rounded-[var(--radius-md)] border border-action/30 bg-action/5 px-4 py-2 text-[12px] text-action font-medium">
                Demo mode — backend not connected. Start the backend to use all features.
              </div>
            )}

            <StatCards stats={stats} />

            {/* Active filter indicator */}
            {(filters.status || filters.priority || filters.category_id || filters.due_date_from) && viewMode === "list" && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted">Filtered:</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  {filters.priority === "high" && "High Priority"}
                  {filters.status === "completed" && "Completed"}
                  {filters.status === "pending" && "Upcoming"}
                  {filters.due_date_from && "Due Today"}
                  {filters.category_id && categories.find(c => c.id === filters.category_id)?.name}
                  <button
                    onClick={clearFilters}
                    className="hover:bg-primary/20 rounded-full p-0.5 transition-colors duration-150 cursor-pointer"
                    aria-label="Clear filter"
                  >
                    <X size={10} />
                  </button>
                </span>
                <span className="text-[11px] text-muted">({tasks.length} task{tasks.length !== 1 ? "s" : ""})</span>
              </div>
            )}

            {viewMode === "list" && (
              <TaskList tasks={tasks} loading={!isDemo && tasksLoading} onUpdate={handleRefetch} />
            )}
            {viewMode === "daily" && (
              <DailyView tasks={tasks} loading={!isDemo && tasksLoading} onUpdate={handleRefetch} />
            )}
            {viewMode === "weekly" && (
              <WeeklyView tasks={tasks} loading={!isDemo && tasksLoading} onUpdate={handleRefetch} />
            )}
          </div>
        </main>

        {/* Bottom bar — user profile + smart input */}
        <div className="border-t border-border/40 glass px-6 py-2.5">
          <div className="mx-auto max-w-4xl">
            <SmartInput
              userId={user.id}
              user={user}
              categories={categories}
              categoryTree={categoryTree}
              onTaskCreated={handleRefetch}
            />
          </div>
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} userId={user.id} />
    </div>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}
