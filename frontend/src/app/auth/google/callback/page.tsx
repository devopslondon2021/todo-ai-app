"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/api";

type Status = "loading" | "success" | "error";

export default function GoogleCallbackPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Connecting Google Calendar...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const userId = params.get("state");
    const error = params.get("error");

    if (error) {
      setStatus("error");
      setMessage(error === "access_denied" ? "Access denied. You can try again from Settings." : `Error: ${error}`);
      return;
    }

    if (!code || !userId) {
      setStatus("error");
      setMessage("Missing authorization code. Please try again from Settings.");
      return;
    }

    api<{ data: { connected: boolean } }>("/calendar/connect", {
      method: "POST",
      body: { code, user_id: userId },
    })
      .then(() => {
        setStatus("success");
        setMessage("Google Calendar connected! Your meetings are syncing.");
        // Close the window after a short delay (if opened as popup)
        // or redirect back to main page
        setTimeout(() => {
          if (window.opener) {
            window.opener.postMessage({ type: "google-calendar-connected" }, "*");
            window.close();
          } else {
            window.location.href = "/";
          }
        }, 1500);
      })
      .catch((err: any) => {
        setStatus("error");
        setMessage(err.message || "Failed to connect. Please try again.");
      });
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
        {status === "loading" && (
          <Loader2 size={32} className="text-primary animate-spin" />
        )}
        {status === "success" && (
          <CheckCircle2 size={32} className="text-cta" />
        )}
        {status === "error" && (
          <XCircle size={32} className="text-danger" />
        )}

        <p className="text-[14px] text-text font-medium">{message}</p>

        {status === "error" && (
          <a
            href="/"
            className="text-[12px] text-primary hover:underline mt-2"
          >
            Back to app
          </a>
        )}
      </div>
    </div>
  );
}
