export type KRConfidence = "on-track" | "at-risk" | "needs-rethink";

export interface KeyResult {
  id: string;
  title: string;
  description?: string;
  confidence?: KRConfidence;
  quarterScore?: number; // 0.0–1.0
  // Progress tracking
  metricName?: string;
  targetValue?: number;
  unit?: string;
  deadline?: string; // YYYY-MM-DD
  currentValue?: number;
}

export interface IdeaKRLink {
  objectiveId: string;
  krId: string;
}

export interface OKRMeta {
  okrType?: "committed" | "aspirational";
  timeframe?: string;
  motivation?: string;
  snapshot?: string;
}

export interface Objective {
  id: string;
  title: string;
  description?: string;
  keyResults: KeyResult[];
  createdAt: string;
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

export interface Idea {
  id: string;
  title: string;
  description: string;
  analysis: IdeaAnalysis | null;
  createdAt: string;
  completed?: boolean;
  completedAt?: string;
  linkedKRs?: IdeaKRLink[];
}

export interface AppSettings {
  claudeModel: string;
  language: "zh-TW" | "en";
}
