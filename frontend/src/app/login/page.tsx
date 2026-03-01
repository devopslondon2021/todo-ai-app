"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Mail, Globe, ArrowRight, User, Phone, Loader2, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function handleGoogle() {
    setGoogleLoading(true);
    setError("");
    try {
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${origin}/auth/callback` },
      });
    } catch {
      setError("Failed to start Google sign-in");
      setGoogleLoading(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${origin}/auth/callback`,
          data:
            tab === "signup"
              ? { name: name.trim(), phone_number: phone.trim() }
              : undefined,
        },
      });
      if (err) throw err;
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-3">
            <CheckCircle size={22} className="text-primary" />
          </div>
          <h1 className="text-xl font-bold text-text">Todo AI</h1>
          <p className="text-[12px] text-muted mt-1">Smart task management</p>
        </div>

        <div className="rounded-2xl border border-border/50 bg-bg-raised p-6 shadow-2xl shadow-black/30">
          {/* Tabs */}
          <div className="flex gap-1 mb-5 bg-surface/50 rounded-[var(--radius-md)] p-1">
            {(["signin", "signup"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setSent(false);
                  setError("");
                }}
                className={cn(
                  "flex-1 py-1.5 text-[12px] font-medium rounded-[var(--radius-sm)] transition-colors duration-150 cursor-pointer",
                  tab === t
                    ? "bg-surface-active text-text"
                    : "text-muted hover:text-text"
                )}
              >
                {t === "signin" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>

          {sent ? (
            <div className="text-center py-4">
              <Mail size={32} className="text-primary mx-auto mb-3" />
              <p className="text-[13px] font-medium text-text">Check your email</p>
              <p className="text-[11px] text-muted mt-1.5">
                We sent a magic link to{" "}
                <strong className="text-text">{email}</strong>
              </p>
              <button
                onClick={() => setSent(false)}
                className="mt-4 text-[11px] text-primary hover:underline cursor-pointer"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <>
              {/* Google button */}
              <button
                onClick={handleGoogle}
                disabled={googleLoading}
                className="w-full flex items-center justify-center gap-2.5 rounded-[var(--radius-md)] border border-border/60 bg-surface/50 px-4 py-2.5 text-[13px] font-medium text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mb-4"
              >
                {googleLoading ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Globe size={15} />
                )}
                Continue with Google
              </button>

              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-[10px] text-muted uppercase tracking-wider">
                  or
                </span>
                <div className="flex-1 h-px bg-border/40" />
              </div>

              {/* Magic link form */}
              <form onSubmit={handleMagicLink} className="space-y-2.5">
                {tab === "signup" && (
                  <>
                    <div className="relative">
                      <User
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                      />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="w-full bg-surface/50 border border-border/40 rounded-[var(--radius-md)] pl-9 pr-3 py-2 text-[12px] text-text placeholder:text-muted/50 outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <div className="relative">
                      <Phone
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                      />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Phone (optional, for WhatsApp)"
                        className="w-full bg-surface/50 border border-border/40 rounded-[var(--radius-md)] pl-9 pr-3 py-2 text-[12px] text-text placeholder:text-muted/50 outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                  </>
                )}

                <div className="relative">
                  <Mail
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    required
                    autoFocus
                    className="w-full bg-surface/50 border border-border/40 rounded-[var(--radius-md)] pl-9 pr-3 py-2 text-[12px] text-text placeholder:text-muted/50 outline-none focus:border-primary/50 transition-colors"
                  />
                </div>

                {error && <p className="text-[11px] text-danger">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-primary/15 border border-primary/30 px-4 py-2 text-[12px] font-medium text-primary hover:bg-primary/25 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <>
                      {tab === "signin" ? "Send magic link" : "Create account"}
                      <ArrowRight size={13} />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
