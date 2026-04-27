export type KRConfidence = "on-track" | "at-risk" | "needs-rethink";

export type ObjectiveStatus = "active" | "completed" | "shelved" | "deleted";

export interface CheckIn {
  id: string;
  date: string; // ISO timestamp
  value: number;
  note?: string;
}

export type KRType = "cumulative" | "measurement" | "milestone";

export interface KeyResult {
  id: string;
  title: string;
  description?: string;
  confidence?: KRConfidence;
  quarterScore?: number; // 0.0–1.0
  // Progress tracking
  krType?: KRType;
  metricName?: string;
  targetValue?: number;
  unit?: string;
  deadline?: string; // YYYY-MM-DD
  currentValue?: number;
  incrementPerTask?: number; // cumulative only: units added per task completion
  checkIns?: CheckIn[];
}

export interface IdeaKRLink {
  objectiveId: string;
  krId?: string; // optional: absent means linked to the whole objective
}

export interface OKRMeta {
  okrType?: "committed" | "aspirational";
  timeframe?: string;
  priority?: 1 | 2 | 3;
}

export interface Objective {
  id: string;
  title: string;
  description?: string;
  keyResults: KeyResult[];
  createdAt: string;
  status?: ObjectiveStatus;
  meta?: OKRMeta;
}

export interface KeyResultScore {
  keyResultId: string;
  keyResultTitle: string;
  score: number; // 0-10
  reasoning: string;
}

export interface ObjectiveScore {
  objectiveId: string;
  objectiveTitle: string;
  overallScore: number; // 0-10
  keyResultScores: KeyResultScore[];
  reasoning: string;
}

export interface IdeaAnalysis {
  objectiveScores: ObjectiveScore[];
  finalScore: number; // 0-10
  risks: string[];
  executionSuggestions: string[];
  analyzedAt: string;
}

export type TaskStatus = "todo" | "in-progress" | "done";
export type IdeaStatus = "active" | "shelved" | "deleted" | "inbox";

export interface TodoItem {
  id: string;
  title: string;
  done: boolean;
  doneAt?: string;
}

export interface Idea {
  id: string;
  title: string;
  description: string;
  analysis: IdeaAnalysis | null;
  createdAt: string;
  completed?: boolean;
  completedAt?: string;
  linkedKRs?: IdeaKRLink[];
  taskStatus?: TaskStatus; // set when idea is promoted to a task
  ideaStatus?: IdeaStatus; // lifecycle status
  quickAnalysis?: boolean;
  needsReanalysis?: boolean;
  todos?: TodoItem[];
}

export interface AppSettings {
  claudeModel: string;
  language: "zh-TW" | "en";
}

// ── Habit ─────────────────────────────────────────────────────────────────────

export type HabitFrequency = "daily" | "weekly";

export interface Habit {
  id: string;
  name: string;
  cue?: string;
  frequency: HabitFrequency;
  streakCount: number;
  lastDoneAt?: string; // YYYY-MM-DD
  createdAt: string;
  archivedAt?: string;
}

export interface HabitLog {
  id: string;
  habitId: string;
  loggedAt: string; // YYYY-MM-DD
  skipped: boolean;
}
