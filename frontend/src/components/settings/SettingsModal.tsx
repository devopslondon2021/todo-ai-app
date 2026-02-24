"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Bot, Cpu, Mic, Copy, Eye, EyeOff, RefreshCw, ExternalLink, Calendar, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export function SettingsModal({ open, onClose, userId }: SettingsModalProps) {
  const [provider, setProvider] = useState<"openai" | "ollama">("openai");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Siri section state
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);

  // Google Calendar state
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarConfigured, setCalendarConfigured] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Google credential form state
  const [gcClientId, setGcClientId] = useState("");
  const [gcClientSecret, setGcClientSecret] = useState("");
  const [credSaving, setCredSaving] = useState(false);

  const fetchApiKey = useCallback(() => {
    if (!userId || userId.startsWith("demo")) return;
    setKeyLoading(true);
    api<{ data: { api_key: string } }>(`/users/${userId}/api-key`)
      .then((res) => setApiKey(res.data.api_key))
      .catch(() => setApiKey(null))
      .finally(() => setKeyLoading(false));
  }, [userId]);

  const fetchCalendarStatus = useCallback(() => {
    if (!userId || userId.startsWith("demo")) return;
    api<{ data: { connected: boolean; configured: boolean } }>(`/calendar/status`, { params: { user_id: userId } })
      .then((res) => {
        setCalendarConnected(res.data.connected);
        setCalendarConfigured(res.data.configured);
      })
      .catch(() => {
        setCalendarConnected(false);
        setCalendarConfigured(false);
      });
  }, [userId]);

  useEffect(() => {
    if (open) {
      api<{ data: { ai_provider: string } }>("/settings")
        .then((res) => setProvider(res.data.ai_provider as "openai" | "ollama"))
        .catch(() => {});
      fetchApiKey();
      fetchCalendarStatus();
      setKeyVisible(false);
    }
  }, [open, fetchApiKey, fetchCalendarStatus]);

  // Listen for popup callback message
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "google-calendar-connected") {
        setCalendarConnected(true);
        toast("Google Calendar connected", "success");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [toast]);

  async function handleToggle(newProvider: "openai" | "ollama") {
    setLoading(true);
    try {
      await api("/settings", {
        method: "PUT",
        body: { ai_provider: newProvider },
      });
      setProvider(newProvider);
      toast(`Switched to ${newProvider === "openai" ? "OpenAI" : "Ollama"}`, "success");
    } catch (err: any) {
      toast(err.message || "Failed to switch provider", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyKey() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    toast("API key copied", "success");
  }

  async function handleRegenerate() {
    if (!confirm("Regenerate API key? Your existing Siri Shortcut will stop working until you update it.")) return;
    setKeyLoading(true);
    try {
      const res = await api<{ data: { api_key: string } }>(`/users/${userId}/api-key/regenerate`, { method: "POST" });
      setApiKey(res.data.api_key);
      setKeyVisible(true);
      toast("New API key generated", "success");
    } catch (err: any) {
      toast(err.message || "Failed to regenerate key", "error");
    } finally {
      setKeyLoading(false);
    }
  }

  async function handleConnectCalendar() {
    setCalendarLoading(true);
    try {
      const res = await api<{ data: { url: string } }>("/calendar/auth-url", { params: { user_id: userId } });
      // Open Google OAuth in a popup
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        res.data.url,
        "google-auth",
        `width=${width},height=${height},left=${left},top=${top},popup=1`
      );
      // If popup was blocked, redirect instead
      if (!popup) {
        window.location.href = res.data.url;
      }
    } catch (err: any) {
      if (err.message?.includes("NOT_CONFIGURED")) {
        setCalendarConfigured(false);
        toast("Google credentials not configured. See setup instructions.", "error");
      } else {
        toast(err.message || "Failed to start Google login", "error");
      }
    } finally {
      setCalendarLoading(false);
    }
  }

  async function handleDisconnectCalendar() {
    if (!confirm("Disconnect Google Calendar? Synced meetings will remain as tasks.")) return;
    setCalendarLoading(true);
    try {
      await api("/calendar/disconnect", { method: "DELETE", params: { user_id: userId } });
      setCalendarConnected(false);
      toast("Google Calendar disconnected", "success");
    } catch (err: any) {
      toast(err.message || "Failed to disconnect", "error");
    } finally {
      setCalendarLoading(false);
    }
  }

  async function handleSyncCalendar() {
    setSyncing(true);
    try {
      const res = await api<{ data: { synced: number } }>("/calendar/sync", {
        method: "POST",
        body: { user_id: userId },
      });
      toast(`Synced ${res.data.synced} events`, "success");
    } catch (err: any) {
      toast(err.message || "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveCredentials() {
    if (!gcClientId.trim() || !gcClientSecret.trim()) {
      toast("Both Client ID and Client Secret are required", "error");
      return;
    }
    if (!gcClientId.includes(".apps.googleusercontent.com")) {
      toast("Client ID should end with .apps.googleusercontent.com", "error");
      return;
    }
    setCredSaving(true);
    try {
      await api("/calendar/credentials", {
        method: "POST",
        body: { user_id: userId, client_id: gcClientId.trim(), client_secret: gcClientSecret.trim() },
      });
      setCalendarConfigured(true);
      setGcClientId("");
      setGcClientSecret("");
      toast("Google credentials saved", "success");
    } catch (err: any) {
      toast(err.message || "Failed to save credentials", "error");
    } finally {
      setCredSaving(false);
    }
  }

  function maskKey(key: string): string {
    if (key.length <= 14) return key;
    return key.slice(0, 7) + "\u2022".repeat(16) + key.slice(-4);
  }

  if (!open) return null;

  const isDemo = userId.startsWith("demo");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto overscroll-contain rounded-2xl border border-border-light/50 bg-bg-raised p-5 shadow-2xl shadow-black/40 animate-fade-in-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-[var(--radius-sm)] p-1.5 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* AI Provider Toggle */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2.5 block">
            AI Provider
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => handleToggle("openai")}
              disabled={loading}
              className={cn(
                "flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border p-4 transition-[background-color,border-color,box-shadow] duration-150 cursor-pointer",
                provider === "openai"
                  ? "border-primary/40 bg-primary/8 glow-primary"
                  : "border-border/40 hover:border-border-light hover:bg-surface-hover"
              )}
            >
              <Bot size={20} className={provider === "openai" ? "text-primary" : "text-muted"} aria-hidden="true" />
              <span className={cn("text-[13px] font-medium", provider === "openai" ? "text-primary" : "text-text")}>
                OpenAI
              </span>
              <span className="text-[10px] text-muted">GPT-4o-mini</span>
            </button>

            <button
              onClick={() => handleToggle("ollama")}
              disabled={loading}
              className={cn(
                "flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border p-4 transition-[background-color,border-color,box-shadow] duration-150 cursor-pointer",
                provider === "ollama"
                  ? "border-primary/40 bg-primary/8 glow-primary"
                  : "border-border/40 hover:border-border-light hover:bg-surface-hover"
              )}
            >
              <Cpu size={20} className={provider === "ollama" ? "text-primary" : "text-muted"} aria-hidden="true" />
              <span className={cn("text-[13px] font-medium", provider === "ollama" ? "text-primary" : "text-text")}>
                Ollama
              </span>
              <span className="text-[10px] text-muted">Local model</span>
            </button>
          </div>
          <p className="mt-2.5 text-[11px] text-muted leading-relaxed">
            {provider === "openai"
              ? "Using OpenAI GPT-4o-mini for natural language parsing. Requires API key."
              : "Using local Ollama model. Ensure Ollama is running and accessible."}
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-border/30 my-5" />

        {/* Google Calendar Integration */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2.5 flex items-center gap-1.5">
            <Calendar size={12} aria-hidden="true" />
            Google Calendar
          </label>

          {isDemo ? (
            <p className="text-[12px] text-muted">
              Connect to the backend to enable Google Calendar sync.
            </p>
          ) : !calendarConfigured ? (
            <div className="rounded-[var(--radius-lg)] border border-border/40 bg-surface/50 p-3.5">
              <ol className="space-y-1.5 text-[11px] text-muted leading-relaxed list-decimal list-inside mb-3">
                <li>
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Google Cloud Console &rarr; Credentials
                  </a>{" "}
                  &rarr; Create <strong className="text-text">OAuth client ID</strong> (Web application)
                </li>
                <li>
                  Add redirect URI: <code className="text-primary bg-bg/50 px-1 py-0.5 rounded text-[10px]">{typeof window !== 'undefined' ? window.location.origin : ''}/auth/google/callback</code>
                </li>
                <li>
                  Enable the{" "}
                  <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Google Calendar API
                  </a>
                </li>
                <li>Paste your credentials below:</li>
              </ol>
              <div className="space-y-2">
                <input
                  type="text"
                  value={gcClientId}
                  onChange={(e) => setGcClientId(e.target.value)}
                  placeholder="Client ID (xxx.apps.googleusercontent.com)"
                  className="w-full rounded-[var(--radius-md)] border border-border/40 bg-bg px-3 py-1.5 text-[12px] text-text placeholder:text-muted/50 outline-none focus:border-primary/50 transition-colors"
                />
                <input
                  type="password"
                  value={gcClientSecret}
                  onChange={(e) => setGcClientSecret(e.target.value)}
                  placeholder="Client Secret"
                  className="w-full rounded-[var(--radius-md)] border border-border/40 bg-bg px-3 py-1.5 text-[12px] text-text placeholder:text-muted/50 outline-none focus:border-primary/50 transition-colors"
                />
                <button
                  onClick={handleSaveCredentials}
                  disabled={credSaving || !gcClientId.trim() || !gcClientSecret.trim()}
                  className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-primary/15 border border-primary/30 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/25 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {credSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {credSaving ? "Saving..." : "Save Credentials"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-border/40 bg-surface/50 p-3.5">
              {calendarConnected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cta shrink-0" />
                    <span className="text-[12px] text-text font-medium">Connected</span>
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">
                    Your Google Calendar events are synced as meetings. They appear in the Meetings category with reminders.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSyncCalendar}
                      disabled={syncing}
                      className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border/40 bg-bg px-3 py-1.5 text-[11px] font-medium text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw size={11} className={syncing ? "animate-spin" : ""} aria-hidden="true" />
                      {syncing ? "Syncing..." : "Sync Now"}
                    </button>
                    <button
                      onClick={handleDisconnectCalendar}
                      disabled={calendarLoading}
                      className="rounded-[var(--radius-md)] border border-danger/30 px-3 py-1.5 text-[11px] font-medium text-danger hover:bg-danger/10 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted leading-relaxed">
                    Connect your Google Calendar to sync meetings. Events appear as tasks with reminders and meeting links.
                  </p>
                  <button
                    onClick={handleConnectCalendar}
                    disabled={calendarLoading}
                    className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border/60 bg-bg px-4 py-2 text-[12px] font-medium text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center"
                  >
                    {calendarLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <GoogleIcon size={16} />
                    )}
                    {calendarLoading ? "Opening..." : "Sign in with Google"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border/30 my-5" />

        {/* Siri Voice Integration */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2.5 flex items-center gap-1.5">
            <Mic size={12} aria-hidden="true" />
            Siri Voice Integration
          </label>

          {isDemo ? (
            <p className="text-[12px] text-muted">
              Connect to the backend to enable Siri integration.
            </p>
          ) : (
            <>
              {/* API Key */}
              <div className="rounded-[var(--radius-lg)] border border-border/40 bg-surface/50 p-3.5 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-muted">Your API Key</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setKeyVisible(!keyVisible)}
                      className="rounded-[var(--radius-sm)] p-1 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
                      aria-label={keyVisible ? "Hide API key" : "Reveal API key"}
                    >
                      {keyVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      onClick={handleCopyKey}
                      disabled={!apiKey}
                      className="rounded-[var(--radius-sm)] p-1 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Copy API key to clipboard"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={handleRegenerate}
                      disabled={keyLoading}
                      className="rounded-[var(--radius-sm)] p-1 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Regenerate API key"
                    >
                      <RefreshCw size={13} className={keyLoading ? "animate-spin" : ""} />
                    </button>
                  </div>
                </div>
                <code className="block text-[12px] text-primary font-mono break-all leading-relaxed">
                  {keyLoading ? "Loading\u2026" : apiKey ? (keyVisible ? apiKey : maskKey(apiKey)) : "No key found"}
                </code>
              </div>

              {/* Backend URL */}
              <div className="rounded-[var(--radius-lg)] border border-border/40 bg-surface/50 p-3.5 mb-3">
                <span className="text-[11px] font-medium text-muted block mb-1.5">Backend URL</span>
                <code className="text-[12px] text-primary font-mono">{BACKEND_URL}</code>
              </div>

              {/* Setup Instructions */}
              <div className="rounded-[var(--radius-lg)] border border-border/40 bg-surface/50 p-3.5">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <ExternalLink size={13} className="text-primary" aria-hidden="true" />
                  <span className="text-[11px] font-semibold text-text">Shortcut Setup (iPhone)</span>
                </div>
                <ol className="space-y-2 text-[11px] text-muted leading-relaxed list-decimal list-inside">
                  <li>Open the <strong className="text-text">Shortcuts</strong> app</li>
                  <li>Tap <strong className="text-text">+</strong> &rarr; <strong className="text-text">Add Action</strong> &rarr; search <strong className="text-text">&quot;Ask for Input&quot;</strong></li>
                  <li>Set input type to <strong className="text-text">Text</strong>, prompt: <strong className="text-text">&quot;What task?&quot;</strong></li>
                  <li>Add action: <strong className="text-text">&quot;Get Contents of URL&quot;</strong></li>
                  <li>
                    URL: <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">{BACKEND_URL}/api/tasks/quick</code>
                  </li>
                  <li>Method: <strong className="text-text">POST</strong></li>
                  <li>
                    Headers: <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">Authorization</code> = <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">Bearer {apiKey ? (keyVisible ? apiKey : "your_api_key") : "your_api_key"}</code>
                    <br />
                    <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md ml-3">Content-Type</code> = <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">application/json</code>
                  </li>
                  <li>Body: JSON &rarr; key <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">text</code> = <strong className="text-text">&quot;Provided Input&quot;</strong> (magic variable from step 3)</li>
                  <li>Add action: <strong className="text-text">&quot;Show Result&quot;</strong> &rarr; select the URL output</li>
                  <li>Tap the name at top &rarr; rename to <strong className="text-text">&quot;Add Task&quot;</strong></li>
                  <li>Say <strong className="text-primary">&quot;Hey Siri, Add Task&quot;</strong> to test!</li>
                </ol>
              </div>

              {/* Today's Tasks Shortcut */}
              <div className="rounded-[var(--radius-lg)] border border-border/40 bg-surface/50 p-3.5 mt-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <ExternalLink size={13} className="text-primary" aria-hidden="true" />
                  <span className="text-[11px] font-semibold text-text">Today&apos;s Tasks Shortcut</span>
                </div>
                <ol className="space-y-2 text-[11px] text-muted leading-relaxed list-decimal list-inside">
                  <li>Open <strong className="text-text">Shortcuts</strong> &rarr; tap <strong className="text-text">+</strong></li>
                  <li>Add action: <strong className="text-text">&quot;Get Contents of URL&quot;</strong></li>
                  <li>
                    URL: <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">{BACKEND_URL}/api/tasks/siri/today</code>
                  </li>
                  <li>Method: <strong className="text-text">GET</strong></li>
                  <li>
                    Headers: <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">Authorization</code> = <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">Bearer {apiKey ? (keyVisible ? apiKey : "your_api_key") : "your_api_key"}</code>
                  </li>
                  <li>Add action: <strong className="text-text">&quot;Get Dictionary Value&quot;</strong> &rarr; key <code className="text-primary bg-bg/50 px-1.5 py-0.5 rounded-md">data.summary</code></li>
                  <li>Add action: <strong className="text-text">&quot;Speak Text&quot;</strong> &rarr; select the dictionary value</li>
                  <li>Rename to <strong className="text-text">&quot;Today&apos;s Tasks&quot;</strong></li>
                  <li>Say <strong className="text-primary">&quot;Hey Siri, Today&apos;s Tasks&quot;</strong> to test!</li>
                </ol>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
