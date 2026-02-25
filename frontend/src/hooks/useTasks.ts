"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import type { Task, TaskFilters } from "@/types";

export function useTasks(userId: string | undefined, filters: TaskFilters = {}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const hasFetchedRef = useRef(false);

  const fetchTasks = useCallback(async () => {
    if (!userId) return;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Only show loading skeleton on initial fetch, not on refetches
    if (!hasFetchedRef.current) {
      setLoading(true);
    }

    try {
      const res = await api<{ data: Task[] }>("/tasks", {
        params: {
          user_id: userId,
          category_id: filters.category_id,
          priority: filters.priority,
          status: filters.status,
          due_date_from: filters.due_date_from,
          due_date_to: filters.due_date_to,
          search: filters.search,
        },
        signal: controller.signal,
      });
      setTasks(res.data);
      hasFetchedRef.current = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to fetch tasks:", err);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [userId, filters.category_id, filters.priority, filters.status, filters.due_date_from, filters.due_date_to, filters.search]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Supabase Realtime for live updates
  useEffect(() => {
    if (!userId) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel("tasks-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchTasks]);

  return { tasks, loading, refetch: fetchTasks };
}
