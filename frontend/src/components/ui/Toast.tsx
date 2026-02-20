"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const Icon = toast.type === "success" ? CheckCircle2 : toast.type === "error" ? AlertCircle : Info;
  const iconColor = toast.type === "success" ? "text-cta" : toast.type === "error" ? "text-danger" : "text-primary";

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-border-light/50 glass px-4 py-2.5 shadow-xl shadow-black/30",
        "animate-[slideIn_0.2s_ease-out] min-w-[260px] max-w-[340px]"
      )}
      role="alert"
      aria-live="polite"
    >
      <Icon size={15} className={iconColor} aria-hidden="true" />
      <span className="flex-1 text-[13px] text-text">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="cursor-pointer text-muted hover:text-text transition-colors duration-150"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}
