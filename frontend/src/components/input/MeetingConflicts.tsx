"use client";

import { X, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface MeetingConflictsProps {
  conflicts: { summary: string; start: string; end: string }[];
  alternatives: { start: string; end: string }[];
  onPickAlternative: (slot: { start: string; end: string }) => void;
  onCancel: () => void;
}

export function MeetingConflicts({
  conflicts,
  alternatives,
  onPickAlternative,
  onCancel,
}: MeetingConflictsProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-2 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={13} className="text-amber-400" aria-hidden="true" />
          <span className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">
            Time Slot Busy
          </span>
        </div>
        <button
          onClick={onCancel}
          className="rounded-[var(--radius-sm)] p-1 text-muted hover:text-text hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      {conflicts.length > 0 && (
        <div className="space-y-1">
          {conflicts.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-amber-400/80">
              <span className="font-medium">{c.summary}</span>
              <span className="text-amber-500/60">
                {format(new Date(c.start), "h:mm a")} – {format(new Date(c.end), "h:mm a")}
              </span>
            </div>
          ))}
        </div>
      )}

      {alternatives.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] text-muted">Available slots:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {alternatives.map((slot, i) => (
              <button
                key={i}
                onClick={() => onPickAlternative(slot)}
                className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors duration-150 cursor-pointer"
              >
                {format(new Date(slot.start), "h:mm a")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
