"use client";

import { Calendar, ClipboardCheck, CheckCircle2, ListChecks } from "lucide-react";
import type { TaskStats } from "@/types";

interface StatCardsProps {
  stats: TaskStats;
}

const CARDS = [
  {
    key: "total",
    label: "Total",
    statKey: "total" as keyof TaskStats,
    icon: ListChecks,
    gradient: "from-[#1B2345] to-[#111832]",
    iconColor: "text-indigo-300/30",
  },
  {
    key: "pending",
    label: "Pending",
    statKey: "pending" as keyof TaskStats,
    icon: Calendar,
    gradient: "from-[#2D1B69] to-[#1a1145]",
    iconColor: "text-purple-300/30",
  },
  {
    key: "in_progress",
    label: "In Progress",
    statKey: "in_progress" as keyof TaskStats,
    icon: ClipboardCheck,
    gradient: "from-[#1B2969] to-[#111a45]",
    iconColor: "text-blue-300/30",
  },
  {
    key: "completed",
    label: "Completed",
    statKey: "completed" as keyof TaskStats,
    icon: CheckCircle2,
    gradient: "from-[#1B4332] to-[#112a20]",
    iconColor: "text-green-300/30",
  },
];

export function StatCards({ stats }: StatCardsProps) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {CARDS.map(({ key, label, statKey, icon: Icon, gradient, iconColor }) => (
        <div
          key={key}
          className={`relative overflow-hidden rounded-[var(--radius-lg)] bg-gradient-to-br ${gradient} border border-white/[0.04] px-4 py-3`}
        >
          <Icon
            size={32}
            className={`absolute -right-1 -bottom-1 ${iconColor}`}
            aria-hidden="true"
          />
          <div className="relative z-10">
            <div className="flex items-center gap-1.5 mb-1">
              <Icon size={13} className="text-white/50" aria-hidden="true" />
              <span className="text-[11px] font-medium text-white/50">{label}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[22px] font-bold text-white leading-none tabular-nums">{stats[statKey]}</span>
              <span className="text-[10px] text-white/30">Tasks</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
