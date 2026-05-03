import { Objective, Idea, AppSettings, EvaluationProfile, ObjGroup } from "./types";
import { DEFAULT_EVALUATION_PROFILE } from "./evaluation-prompt";

const KEYS = {
  OBJECTIVES: "okr_objectives",
  IDEAS: "okr_ideas",
  SETTINGS: "okr_settings",
  EVAL_PROFILE: "loco_eval_profile",
  OBJ_GROUPS: "loco_obj_groups",
} as const;

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// Objectives
export function getObjectives(): Objective[] {
  return load<Objective[]>(KEYS.OBJECTIVES, []);
}

export function saveObjectives(objectives: Objective[]): void {
  save(KEYS.OBJECTIVES, objectives);
}

// Ideas
export function getIdeas(): Idea[] {
  return load<Idea[]>(KEYS.IDEAS, []);
}

export function saveIdeas(ideas: Idea[]): void {
  save(KEYS.IDEAS, ideas);
}

export function upsertIdea(idea: Idea): void {
  const ideas = getIdeas();
  const idx = ideas.findIndex((i) => i.id === idea.id);
  if (idx >= 0) {
    ideas[idx] = idea;
  } else {
    ideas.unshift(idea);
  }
  saveIdeas(ideas);
}

export function deleteIdea(id: string): void {
  saveIdeas(getIdeas().filter((i) => i.id !== id));
}

// Settings
export function getSettings(): AppSettings {
  return load<AppSettings>(KEYS.SETTINGS, {
    claudeModel: "claude-haiku-4-5-20251001",
    language: "zh-TW",
  });
}

export function saveSettings(settings: AppSettings): void {
  save(KEYS.SETTINGS, settings);
}

// Evaluation Profile
export function getEvaluationProfile(): EvaluationProfile {
  const raw = load<Partial<EvaluationProfile>>(KEYS.EVAL_PROFILE, {});
  return {
    ...DEFAULT_EVALUATION_PROFILE,
    ...raw,
    priorityWeights: { ...DEFAULT_EVALUATION_PROFILE.priorityWeights, ...raw.priorityWeights },
  };
}

export function saveEvaluationProfile(profile: EvaluationProfile): void {
  save(KEYS.EVAL_PROFILE, profile);
}

// Objective Groups
export function getObjGroups(): ObjGroup[] {
  return load<ObjGroup[]>(KEYS.OBJ_GROUPS, []);
}

export function saveObjGroups(groups: ObjGroup[]): void {
  save(KEYS.OBJ_GROUPS, groups);
}
