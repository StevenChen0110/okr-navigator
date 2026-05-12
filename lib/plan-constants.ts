import type { PlanPeriod, PlanStatus } from "./types";

export const PERIOD_LABELS_ZH: Record<PlanPeriod, string> = { today: "今日", week: "本週", month: "本月", custom: "自訂" };
export const PERIOD_LABELS_EN: Record<PlanPeriod, string> = { today: "Today", week: "This Week", month: "This Month", custom: "Custom" };
export const STATUS_LABELS_ZH: Record<PlanStatus, string> = { active: "待辦", "in-progress": "進行中", shelved: "擱置", completed: "已完成" };
export const STATUS_LABELS_EN: Record<PlanStatus, string> = { active: "Active", "in-progress": "In Progress", shelved: "Shelved", completed: "Completed" };
export const STATUS_STYLE: Record<PlanStatus, string> = {
  active: "bg-gray-100 text-gray-500",
  "in-progress": "bg-amber-50 text-amber-600",
  shelved: "bg-orange-50 text-orange-500",
  completed: "bg-green-50 text-green-600",
};
