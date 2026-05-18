import { Objective, Idea, AppSettings, EvaluationProfile, ObjGroup, Milestone, GroupSequencePhase, StoredMessage, PlanItem } from "./types";
import { DEFAULT_EVALUATION_PROFILE } from "./evaluation-prompt";

const KEYS = {
  OBJECTIVES: "okr_objectives",
  IDEAS: "okr_ideas",
  SETTINGS: "okr_settings",
  EVAL_PROFILE: "loco_eval_profile",
  OBJ_GROUPS: "loco_obj_groups",
  PLAN_ITEMS: "loco_plan_items",
  USER_PROFILE: "loco_user_profile",
} as const;

export interface UserProfile {
  statement: string;
  createdAt: string;
}

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
  const raw = load<Partial<AppSettings> & { claudeModel?: string }>(KEYS.SETTINGS, {});
  return {
    language: raw.language ?? "zh-TW",
    provider: raw.provider ?? "anthropic",
    model: raw.model ?? raw.claudeModel ?? "claude-haiku-4-5-20251001",
    apiKeys: raw.apiKeys ?? {},
    claudeModel: raw.claudeModel,
    onboardingCompleted: raw.onboardingCompleted,
    tourCompleted: raw.tourCompleted,
  };
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
    groupPriorityWeights: { ...DEFAULT_EVALUATION_PROFILE.groupPriorityWeights, ...raw.groupPriorityWeights },
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

// Plan Items
export function getPlanItems(): PlanItem[] {
  return load<PlanItem[]>(KEYS.PLAN_ITEMS, []);
}

export function savePlanItems(items: PlanItem[]): void {
  save(KEYS.PLAN_ITEMS, items);
}

// User Profile
export function getUserProfile(): UserProfile | null {
  return load<UserProfile | null>(KEYS.USER_PROFILE, null);
}
export function saveUserProfile(profile: UserProfile): void {
  save(KEYS.USER_PROFILE, profile);
}

// Chat history (key = "goalBuilder" | "optimize" | "roadmap_<id>" | "groupRoadmap_<id>")
export function getChatHistory(key: string): StoredMessage[] {
  return load<StoredMessage[]>(`chat_${key}`, []);
}
export function saveChatHistory(key: string, messages: StoredMessage[]): void {
  save(`chat_${key}`, messages);
}
export function clearChatHistory(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`chat_${key}`);
}

// Objective roadmaps (milestones)
export function getObjectiveRoadmap(objectiveId: string): Milestone[] {
  return load<Milestone[]>(`roadmap_${objectiveId}`, []);
}
export function saveObjectiveRoadmap(objectiveId: string, milestones: Milestone[]): void {
  save(`roadmap_${objectiveId}`, milestones);
}

// Group roadmaps (phase sequencing)
export function getGroupRoadmap(groupId: string): GroupSequencePhase[] {
  return load<GroupSequencePhase[]>(`groupRoadmap_${groupId}`, []);
}
export function saveGroupRoadmap(groupId: string, phases: GroupSequencePhase[]): void {
  save(`groupRoadmap_${groupId}`, phases);
}
