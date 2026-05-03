import { EvaluationProfile, EvalMode } from "./types";

export const DEFAULT_EVALUATION_PROFILE: EvaluationProfile = {
  mode: "execute",
  considerPriority: true,
  priorityWeights: { 1: 3, 2: 2, 3: 1 },
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
  if (profile.considerPriority) {
    lines.push(
      `When computing finalScore, weight objectives by their Priority field: Priority 1 = weight ${w[1]}×, Priority 2 = weight ${w[2]}×, Priority 3 = weight ${w[3]}×.`
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
