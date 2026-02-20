"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Bot, Cpu, Mic, Copy, Eye, EyeOff, RefreshCw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export function SettingsModal({ open, onClose, userId }: SettingsModalProps) {
  const [provider, setProvider] = useState<"openai" | "ollama">("openai");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Siri section state
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);

  const fetchApiKey = useCallback(() => {
    if (!userId || userId.startsWith("demo")) return;
    setKeyLoading(true);
    api<{ data: { api_key: string } }>(`/users/${userId}/api-key`)
      .then((res) => setApiKey(res.data.api_key))
      .catch(() => setApiKey(null))
      .finally(() => setKeyLoading(false));
  }, [userId]);

  useEffect(() => {
    if (open) {
      api<{ data: { ai_provider: string } }>("/settings")
        .then((res) => setProvider(res.data.ai_provider as "openai" | "ollama"))
        .catch(() => {});
      fetchApiKey();
      setKeyVisible(false);
    }
  }, [open, fetchApiKey]);

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
              : "Using local Ollama model. Ensure Ollama is running on localhost:11434."}
          </p>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
