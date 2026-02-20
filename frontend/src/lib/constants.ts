export const PRIORITY_CONFIG = {
  low: { label: "Low", color: "#60A5FA", bg: "bg-blue-500/15", text: "text-blue-400" },
  medium: { label: "Medium", color: "#FBBF24", bg: "bg-amber-500/15", text: "text-amber-400" },
  high: { label: "High", color: "#F87171", bg: "bg-red-500/20", text: "text-red-400" },
} as const;

export const STATUS_CONFIG = {
  pending: { label: "Pending", color: "#6B7280" },
  in_progress: { label: "In Progress", color: "#F59E0B" },
  completed: { label: "Completed", color: "#22C55E" },
} as const;

export const DEFAULT_CATEGORY_COLORS = [
  "#EF4444", "#3B82F6", "#F59E0B", "#10B981",
  "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
];
