"use client";

import { useState, useEffect } from "react";
import { Mic, MicOff, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { ParsePreview } from "./ParsePreview";
import { MeetingConflicts } from "./MeetingConflicts";
import type { ParsedTask, Category, User, MeetingResponse, AvailabilityCheckResponse } from "@/types";

interface SmartInputProps {
  userId: string;
  user: User;
  categories: Category[];
  categoryTree: Category[];
  onTaskCreated: () => void;
}

export function SmartInput({ userId, user, categories, categoryTree, onTaskCreated }: SmartInputProps) {
  const [text, setText] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedTask, setParsedTask] = useState<ParsedTask | null>(null);
  const [parsedQueue, setParsedQueue] = useState<ParsedTask[]>([]);
  const [meetingConflicts, setMeetingConflicts] = useState<{
    conflicts: MeetingResponse["conflicts"];
    alternatives: MeetingResponse["alternatives"];
    pendingTask: ParsedTask;
  } | null>(null);
  const [conflictIsMeeting, setConflictIsMeeting] = useState(true);
  const { toast } = useToast();
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
  } = useVoiceInput();

  useEffect(() => {
    if (transcript) setText(transcript);
  }, [transcript]);

  async function handleParse() {
    if (!text.trim()) return;
    setIsParsing(true);
    try {
      const res = await api<{ data: ParsedTask; tasks?: ParsedTask[] }>("/tasks/parse", {
        method: "POST",
        body: {
          text: text.trim(),
          category_names: categories.map((c) => c.name),
        },
      });

      if (res.tasks && res.tasks.length > 1) {
        // Multi-task: show first, queue the rest
        setParsedTask(res.tasks[0]);
        setParsedQueue(res.tasks.slice(1));
      } else {
        setParsedTask(res.data);
        setParsedQueue([]);
      }
    } catch {
      toast("Failed to parse task. Try again.", "error");
    } finally {
      setIsParsing(false);
    }
  }

  function advanceQueue() {
    if (parsedQueue.length > 0) {
      const [next, ...rest] = parsedQueue;
      setParsedTask(next);
      setParsedQueue(rest);
    } else {
      setText("");
      setParsedTask(null);
    }
  }

  async function handleConfirm(task: ParsedTask) {
    try {
      // Meeting flow: check calendar if meeting + user has calendar connected
      if (task.is_meeting && user.google_calendar_connected) {
        const res = await api<MeetingResponse>("/tasks/meeting", {
          method: "POST",
          body: {
            title: task.title,
            description: task.description,
            priority: task.priority,
            category_id: task.category_id,
            due_date: task.due_date,
            duration_minutes: task.duration_minutes || 15,
            attendees: task.attendees,
          },
        });

        if (!res.data) {
          // Calendar error (no conflicts to show) — toast the message
          if (res.conflicts.length === 0 && res.alternatives.length === 0) {
            toast(res.message || "Could not check calendar availability", "error");
            return;
          }
          // Conflict — show alternatives (blocking for meetings)
          setConflictIsMeeting(true);
          setMeetingConflicts({
            conflicts: res.conflicts,
            alternatives: res.alternatives,
            pendingTask: task,
          });
          return;
        }

        // Success
        const queueLeft = parsedQueue.length;
        advanceQueue();
        toast(
          res.calendar_note
            ? `Meeting created! ${res.calendar_note}`
            : "Meeting created & added to Google Calendar!",
          "success"
        );
        if (queueLeft > 0) toast(`${queueLeft} more to review`, "info");
        onTaskCreated();
        return;
      }

      // Timed task flow: non-blocking availability check
      if (!task.is_meeting && task.has_specific_time && task.due_date && user.google_calendar_connected) {
        try {
          const avail = await api<AvailabilityCheckResponse>("/tasks/check-availability", {
            method: "POST",
            body: { due_date: task.due_date, duration_minutes: 30 },
          });

          if (!avail.free) {
            setConflictIsMeeting(false);
            setMeetingConflicts({
              conflicts: avail.conflicts,
              alternatives: avail.alternatives,
              pendingTask: task,
            });
            return;
          }
        } catch {
          // Calendar check failed — proceed with task creation
        }
      }

      // Regular task flow
      await api("/tasks", {
        method: "POST",
        body: {
          title: task.title,
          description: task.description,
          priority: task.priority,
          category_id: task.category_id,
          due_date: task.due_date,
          reminder_time: task.reminder_time,
          is_recurring: task.is_recurring,
          recurrence_rule: task.recurrence_rule,
        },
      });

      const queueLeft = parsedQueue.length;
      advanceQueue();
      toast(queueLeft > 0 ? `Task created! (${queueLeft} more to review)` : "Task created!", "success");
      onTaskCreated();
    } catch {
      toast("Failed to create task", "error");
    }
  }

  async function handleCreateAnyway() {
    if (!meetingConflicts) return;
    const task = meetingConflicts.pendingTask;
    setMeetingConflicts(null);

    try {
      await api("/tasks", {
        method: "POST",
        body: {
          title: task.title,
          description: task.description,
          priority: task.priority,
          category_id: task.category_id,
          due_date: task.due_date,
          reminder_time: task.reminder_time,
          is_recurring: task.is_recurring,
          recurrence_rule: task.recurrence_rule,
        },
      });

      advanceQueue();
      toast("Task created!", "success");
      onTaskCreated();
    } catch {
      toast("Failed to create task", "error");
    }
  }

  async function handlePickAlternative(slot: { start: string; end: string }) {
    if (!meetingConflicts) return;
    const task = meetingConflicts.pendingTask;
    setMeetingConflicts(null);

    // Non-meeting: create a regular task with the alternative time
    if (!conflictIsMeeting) {
      try {
        await api("/tasks", {
          method: "POST",
          body: {
            title: task.title,
            description: task.description,
            priority: task.priority,
            category_id: task.category_id,
            due_date: slot.start,
            reminder_time: task.reminder_time,
            is_recurring: task.is_recurring,
            recurrence_rule: task.recurrence_rule,
          },
        });

        advanceQueue();
        toast("Task created!", "success");
        onTaskCreated();
      } catch {
        toast("Failed to create task", "error");
      }
      return;
    }

    // Meeting: use the meeting endpoint
    try {
      const res = await api<MeetingResponse>("/tasks/meeting", {
        method: "POST",
        body: {
          title: task.title,
          description: task.description,
          priority: task.priority,
          category_id: task.category_id,
          due_date: slot.start,
          duration_minutes: task.duration_minutes || 15,
          attendees: task.attendees,
        },
      });

      if (!res.data) {
        setConflictIsMeeting(true);
        setMeetingConflicts({
          conflicts: res.conflicts,
          alternatives: res.alternatives,
          pendingTask: task,
        });
        return;
      }

      advanceQueue();
      toast("Meeting created & added to Google Calendar!", "success");
      onTaskCreated();
    } catch {
      toast("Failed to create meeting", "error");
    }
  }

  function handleCancel() {
    // If there are more tasks in the queue, show the next one
    if (parsedQueue.length > 0) {
      const [next, ...rest] = parsedQueue;
      setParsedTask(next);
      setParsedQueue(rest);
    } else {
      setParsedTask(null);
      setText("");
    }
  }

  return (
    <div className="space-y-2">
      {meetingConflicts && (
        <MeetingConflicts
          conflicts={meetingConflicts.conflicts}
          alternatives={meetingConflicts.alternatives}
          onPickAlternative={handlePickAlternative}
          onCancel={() => setMeetingConflicts(null)}
          onCreateAnyway={!conflictIsMeeting ? handleCreateAnyway : undefined}
        />
      )}

      {parsedTask && (
        <ParsePreview
          task={parsedTask}
          categories={categories}
          categoryTree={categoryTree}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      <div className="flex items-center gap-3">
        {/* Input bar */}
        <div
          className={cn(
            "flex flex-1 items-center gap-2 rounded-full border bg-surface/60 px-2 py-1.5 transition-[border-color,box-shadow] duration-150",
            isListening
              ? "border-danger/40"
              : "border-border/40 focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_rgba(139,124,246,0.08)]"
          )}
        >
          {/* Mic button */}
          {isSupported && (
            <button
              onClick={isListening ? stopListening : startListening}
              className={cn(
                "relative shrink-0 w-8 h-8 flex items-center justify-center rounded-full cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
                isListening
                  ? "voice-pulse bg-danger/20 text-danger"
                  : "bg-primary/15 text-primary hover:bg-primary/25"
              )}
              aria-label={isListening ? "Stop recording" : "Start voice input"}
            >
              {isListening ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
            </button>
          )}

          {/* Waveform decoration when listening */}
          {isListening && (
            <div className="flex items-center gap-[2px] shrink-0" aria-hidden="true">
              {[10, 16, 12, 14].map((h, i) => (
                <div
                  key={i}
                  className="w-[2px] bg-primary/50 rounded-full animate-pulse"
                  style={{ height: `${h}px`, animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>
          )}

          <input
            type="text"
            name="task-input"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isParsing && handleParse()}
            placeholder={"Try \u201CRemind me to call mom tomorrow at 3pm\u201D"}
            aria-label="Add a task"
            className="flex-1 bg-transparent text-[12px] text-text placeholder:text-muted/50 outline-none focus-visible:outline-none min-w-0"
          />

          <button
            onClick={handleParse}
            disabled={!text.trim() || isParsing}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-primary hover:bg-primary/10 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
            style={{ transition: "background-color 150ms" }}
            aria-label="Parse and add task"
          >
            {isParsing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
