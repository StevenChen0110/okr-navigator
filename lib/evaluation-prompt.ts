import { EvaluationProfile, EvalMode, EvalPriority } from "./types";

export const DEFAULT_EVALUATION_PROFILE: EvaluationProfile = {
  mode: "execute",
  priorities: ["alignment", "effort", "speed", "growth"],
};

export const MODE_LABELS: Record<EvalMode, string> = {
  explore: "快速驗證",
  execute: "深度執行",
  sustain: "穩定積累",
};

export const MODE_DESCRIPTIONS: Record<EvalMode, string> = {
  explore: "快速看到結果，避免過度承諾",
  execute: "高影響力，值得持續投入",
  sustain: "建立系統和習慣，長期複利",
};

export const PRIORITY_LABELS: Record<EvalPriority, string> = {
  alignment: "OKR 對齊",
  effort:    "執行成本",
  speed:     "速度（快贏）",
  growth:    "個人成長",
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

const PRIORITY_PROMPT: Record<EvalPriority, string> = {
  alignment: "OKR alignment — how directly and strongly this advances key results",
  effort:    "execution cost — lower time/energy investment is better, all else equal",
  speed:     "time to visible results — faster feedback loops score higher",
  growth:    "personal learning value — does this build skills or knowledge that compounds?",
};

export function buildEvaluationPrompt(profile: EvaluationProfile): string {
  const modeText = MODE_PROMPT[profile.mode];
  const priorityLines = profile.priorities
    .map((p, i) => `  ${i + 1}. ${PRIORITY_PROMPT[p]}`)
    .join("\n");

  return (
    `\n\nUSER EVALUATION CONTEXT:\n` +
    `${modeText}\n` +
    `When computing scores, weigh these dimensions in this priority order:\n` +
    `${priorityLines}\n` +
    `A higher-ranked dimension should outweigh lower-ranked ones when trade-offs exist.`
  );
}
