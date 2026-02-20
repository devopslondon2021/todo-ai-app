"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { User } from "@/types";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ data: User }>("/users/default")
      .then((res) => setUser(res.data))
      .catch(() => {}) // Silent fail — frontend falls back to demo mode
      .finally(() => setLoading(false));
  }, []);

  return { user, loading };
}
