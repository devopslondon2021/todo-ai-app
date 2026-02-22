"use client";

import { create } from "zustand";
import type { TaskFilters, TaskViewMode } from "@/types";

export type SortMode = "custom" | "date";

interface AppState {
  filters: TaskFilters;
  setFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void;
  clearFilters: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  hydrated: boolean;
  hydrate: () => void;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  viewMode: TaskViewMode;
  setViewMode: (mode: TaskViewMode) => void;
  sortMode: SortMode;
  setSortMode: (mode: SortMode) => void;
}

export const useAppStore = create<AppState>((set) => ({
  filters: {},
  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value || undefined },
    })),
  clearFilters: () => set({ filters: {} }),
  sidebarOpen: false, // Start closed, hydrate sets correct value
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  hydrated: false,
  hydrate: () =>
    set({
      hydrated: true,
      sidebarOpen: typeof window !== "undefined" ? window.innerWidth >= 768 : false,
    }),
  selectedTaskId: null,
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  viewMode: "list",
  setViewMode: (mode) => set({ viewMode: mode }),
  sortMode: "custom",
  setSortMode: (mode) => set({ sortMode: mode }),
}));
