"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import type { User } from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface AuthContextValue {
  supabaseUser: SupabaseUser | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  supabaseUser: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const router = useRouter();
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchAppUser(accessToken: string) {
    try {
      const res = await fetch(`${BASE_URL}/api/users/me`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.data);
      }
    } catch {}
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;

      setSupabaseUser(session?.user ?? null);
      if (session?.access_token) {
        await fetchAppUser(session.access_token);
      }
      if (mounted) setLoading(false);
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted || event === "INITIAL_SESSION") return;
      setSupabaseUser(session?.user ?? null);
      if (session?.access_token) {
        await fetchAppUser(session.access_token);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSupabaseUser(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ supabaseUser, user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
