"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { Category } from "@/types";

export function useCategories(userId: string | undefined) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTree, setCategoryTree] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCategories = useCallback(async () => {
    if (!userId) return;
    try {
      const [flatRes, treeRes] = await Promise.all([
        api<{ data: Category[] }>("/categories", {
          params: { user_id: userId },
        }),
        api<{ data: Category[] }>("/categories/tree", {
          params: { user_id: userId },
        }),
      ]);
      setCategories(flatRes.data);
      setCategoryTree(treeRes.data);
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  return { categories, categoryTree, loading, refetch: fetchCategories };
}
