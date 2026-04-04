export interface KeyResult {
  id: string;
  title: string;
  description?: string;
}

export interface Objective {
  id: string;
  title: string;
  description?: string;
  keyResults: KeyResult[];
  createdAt: string;
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
  overallScore: number; // 0-10, contribution to achieving the O
  keyResultScores: KeyResultScore[];
  reasoning: string;
}

export interface IdeaAnalysis {
  objectiveScores: ObjectiveScore[];
  finalScore: number; // 0-10, overall priority
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
}

export interface AppSettings {
  claudeApiKey: string;
  claudeModel: string;
}
