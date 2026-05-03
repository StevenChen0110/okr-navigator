import { EvaluationProfile, EvalMode } from "./types";

export const DEFAULT_EVALUATION_PROFILE: EvaluationProfile = {
  mode: "execute",
  considerPriority: true,
  priorityWeights: { 1: 3, 2: 2, 3: 1 },
  considerGroupPriority: false,
  groupPriorityWeights: { 1: 3, 2: 2, 3: 1 },
  considerDeadline: false,
  deadlineUrgencyDays: 30,
  activeGroupIds: null,
};

export const MODE_LABELS: Record<EvalMode, string> = {
  explore: "快速驗證",
  execute: "深度執行",
  sustain: "穩定積累",
};

export const MODE_DESCRIPTIONS: Record<EvalMode, string> = {
  explore: "2 週內見效，適合探索期",
  execute: "高影響力，值得持續投入，衝刺期",
  sustain: "建立習慣或系統，長期複利",
};

const MODE_PROMPT: Record<EvalMode, string> = {
  explore:
    "The user is currently in EXPLORATION mode: prioritize ideas that can be tested or validated within 2 weeks. " +
    "Penalize ideas requiring long sustained effort with uncertain outcomes. " +
    "Favor quick experiments and reversible actions.",
  execute:
    "The user is currently in EXECUTION mode: prioritize ideas with high impact that are worth sustained effort. " +
    "Favor ideas that make a meaningful dent in key results. " +
    "Balance ambition with feasibility.",
  sustain:
    "The user is currently in SUSTAIN mode: prioritize ideas that build systems, habits, or compounding assets. " +
    "Favor actions that reduce future friction or create leverage. " +
    "De-prioritize one-off tasks with no lasting effect.",
};

export function buildEvaluationPrompt(profile: EvaluationProfile): string {
  const lines: string[] = ["\n\nUSER EVALUATION CONTEXT:", MODE_PROMPT[profile.mode]];

  const w = profile.priorityWeights ?? DEFAULT_EVALUATION_PROFILE.priorityWeights;
  const gw = profile.groupPriorityWeights ?? DEFAULT_EVALUATION_PROFILE.groupPriorityWeights;

  if (profile.considerPriority && profile.considerGroupPriority) {
    lines.push(
      `When computing finalScore, use weight = objective_priority_weight × group_priority_weight. ` +
      `Objective weights: P1=${w[1]}×, P2=${w[2]}×, P3=${w[3]}×. ` +
      `Group weights: P1=${gw[1]}×, P2=${gw[2]}×, P3=${gw[3]}×. No group = group weight 1×.`
    );
  } else if (profile.considerPriority) {
    lines.push(
      `When computing finalScore, weight objectives by their Priority field: P1=${w[1]}×, P2=${w[2]}×, P3=${w[3]}×. Ignore group priority.`
    );
  } else if (profile.considerGroupPriority) {
    lines.push(
      `When computing finalScore, weight by group priority only (ignore objective priority): Group P1=${gw[1]}×, P2=${gw[2]}×, P3=${gw[3]}×. No group = weight 1×.`
    );
  } else {
    lines.push("Treat all objectives as equally important when computing finalScore.");
  }

  const urgencyDays = profile.deadlineUrgencyDays ?? DEFAULT_EVALUATION_PROFILE.deadlineUrgencyDays;
  if (profile.considerDeadline) {
    lines.push(
      `If an objective has a Deadline field, factor in urgency: ideas that advance objectives with deadlines within ${urgencyDays} days should score higher.`
    );
  }

  return lines.join("\n");
}
