"use client";

import { useAuth } from "@/context/AuthContext";

export function useUser() {
  const { user, loading } = useAuth();
  return { user, loading };
}
