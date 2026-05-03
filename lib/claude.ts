import { complete } from "./llm";
import type { AIProvider } from "./types";
import { Objective, ObjGroup, IdeaAnalysis, KRConfidence } from "./types";

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/** Extract the outermost JSON object or array from a string, tolerating extra surrounding text. */
function extractJSON(text: string): string {
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let start = -1;
  let isArray = false;
  if (firstBrace === -1 && firstBracket === -1) return text;
  if (firstBrace === -1) { start = firstBracket; isArray = true; }
  else if (firstBracket === -1) { start = firstBrace; }
  else if (firstBracket < firstBrace) { start = firstBracket; isArray = true; }
  else { start = firstBrace; }
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start); // truncated — return what we have
}

function langInstruction(language: "zh-TW" | "en"): string {
  return language === "zh-TW"
    ? "Respond in Traditional Chinese (繁體中文)."
    : "Respond in English.";
}

function currentDateInstruction(): string {
  const today = new Date().toISOString().split("T")[0]; // e.g. 2026-04-05
  return `Today's date is ${today}. All deadlines and timeframes in your output must be on or after this date.`;
}

// ── Stage 1: Refine one-liner into structured Objective ──────────────────────

export async function refineObjective(
  apiKey: string, model: string, language: "zh-TW" | "en", rawInput: string,
  provider: AIProvider = "anthropic",
): Promise<{ title: string; timeframe: string }> {
  const text = await complete(provider, apiKey, model, `You are an OKR coach. The user describes a goal in one sentence. Infer:
- title: a concise, action-oriented Objective title (≤15 words)
- timeframe: one of "本月", "本季", "半年", "全年"

${langInstruction(language)}
Output ONLY valid JSON: {"title":"...","timeframe":"..."}
No markdown fences.`, rawInput, 256);
  return JSON.parse(extractJSON(stripFences(text)));
}

// ── Stage 2: Propose SMART KRs ───────────────────────────────────────────────

export async function suggestKeyResults(
  apiKey: string, model: string, language: "zh-TW" | "en",
  objectiveTitle: string, objectiveDescription?: string, existingKRs?: string[],
  provider: AIProvider = "anthropic",
): Promise<string[]> {
  const existing = existingKRs?.length
    ? `\nExisting KRs (do NOT duplicate): ${existingKRs.map((k) => `"${k}"`).join(", ")}` : "";
  const text = await complete(provider, apiKey, model, `You are an OKR expert. Suggest 3-5 Key Results for the given Objective.
Each KR should describe an observable end state — what will be clearly true when the objective is achieved.
Use plain, concrete language. Prefer patterns like "不再需要手動做 X" or "從 A 狀態變成 B 狀態".
Do NOT include deadlines or verbose metric formulas in the KR title. Keep each KR to one sentence.
${currentDateInstruction()}
${langInstruction(language)}
Output ONLY a JSON array of strings. No markdown fences.`,
    `Objective: ${objectiveTitle}${objectiveDescription ? `\nContext: ${objectiveDescription}` : ""}${existing}`, 512);
  return JSON.parse(extractJSON(stripFences(text))) as string[];
}

// ── Stage 2: Convert user-written KRs to SMART format ────────────────────────

export async function convertAllToSMART(
  apiKey: string, model: string, language: "zh-TW" | "en",
  krs: string[], objectiveTitle: string, timeframe: string,
  provider: AIProvider = "anthropic",
): Promise<string[]> {
  const text = await complete(provider, apiKey, model, `You are an OKR coach. Convert each Key Result to SMART format (specific, measurable, time-bound).
Keep the user's original intent. Add numbers or deadlines only if missing. Use the timeframe hint if no deadline is specified.
${currentDateInstruction()}
${langInstruction(language)}
Output ONLY a JSON array of strings in the same order as input. No markdown fences.`,
    `Objective: ${objectiveTitle}\nTimeframe: ${timeframe}\nKRs to convert:\n${JSON.stringify(krs)}`, 768);
  return JSON.parse(extractJSON(stripFences(text))) as string[];
}

// ── Confidence: Analyze why confidence dropped ───────────────────────────────

export async function analyzeConfidenceDrop(
  apiKey: string, model: string, language: "zh-TW" | "en",
  krTitle: string, objectiveTitle: string, confidence: KRConfidence,
  provider: AIProvider = "anthropic",
): Promise<string> {
  const levelMap = {
    "at-risk": "at-risk (struggling but might still achieve)",
    "needs-rethink": "needs rethink (unlikely to achieve)",
  };
  return complete(provider, apiKey, model, `You are an OKR coach. The user marked a KR as "${levelMap[confidence as keyof typeof levelMap]}". Give a 2-3 sentence response:
1. Ask whether the issue is execution difficulty or the KR itself is no longer suitable
2. Suggest one concrete next step based on the confidence level
Keep it practical and direct. ${langInstruction(language)}`,
    `Objective: ${objectiveTitle}\nKR: ${krTitle}`, 300);
}

// ── Quarter scoring: Get AI recommendation ───────────────────────────────────

export async function getQuarterRecommendation(
  apiKey: string, model: string, language: "zh-TW" | "en",
  objectiveTitle: string, okrType: "committed" | "aspirational",
  krScores: Array<{ title: string; score: number }>,
  provider: AIProvider = "anthropic",
): Promise<{ verdict: "complete" | "continue" | "reset"; reasoning: string }> {
  const typeLabel = okrType === "committed" ? "committed" : "aspirational";
  const avgScore = krScores.reduce((s, k) => s + k.score, 0) / krScores.length;
  const text = await complete(provider, apiKey, model, `You are an OKR coach. Based on the quarterly scores, give a recommendation.
For committed OKRs: avg ≥ 0.9 → "complete", 0.5-0.9 → "continue", < 0.5 → "reset"
For aspirational OKRs: avg ≥ 0.7 → "complete", 0.4-0.7 → "continue", < 0.4 → "reset"
${langInstruction(language)}
Output ONLY valid JSON: {"verdict":"complete"|"continue"|"reset","reasoning":"2-3 sentences explaining why and what to do next"}
No markdown fences.`,
    `Objective: ${objectiveTitle}\nType: ${typeLabel}\nAverage score: ${avgScore.toFixed(2)}\nKR scores:\n${krScores.map((k) => `- ${k.title}: ${k.score.toFixed(1)}`).join("\n")}`, 400);
  return JSON.parse(extractJSON(stripFences(text)));
}

// ── KR Metric Parsing ────────────────────────────────────────────────────────

export async function parseKRMetrics(
  apiKey: string, model: string, krTitle: string,
  provider: AIProvider = "anthropic",
): Promise<{ metricName: string; targetValue: number; unit: string; deadline: string | null }> {
  const text = await complete(provider, apiKey, model, `You are an OKR analyst. Extract the measurable metric from a SMART Key Result.
${currentDateInstruction()}
Output ONLY valid JSON: {"metricName":"...","targetValue":number,"unit":"...","deadline":"YYYY-MM-DD or null"}
- metricName: short noun phrase for what is tracked (≤6 words)
- targetValue: the numeric goal
- unit: unit of measurement (e.g. 個, 本, %, 小時, sessions)
- deadline: YYYY-MM-DD if mentioned, else null
No markdown fences.`, krTitle, 200);
  return JSON.parse(extractJSON(stripFences(text)));
}

// ── KR Classification ────────────────────────────────────────────────────────

export interface KRClassification {
  krType: "cumulative" | "measurement" | "milestone";
  metricName: string;       // empty string for milestone
  targetValue: number | null; // null for milestone
  unit: string;             // empty string for milestone
  deadline: string | null;  // YYYY-MM-DD or null
  incrementPerTask: number; // for cumulative (default 1); 1 for others
}

export async function classifyKR(
  apiKey: string, model: string, language: "zh-TW" | "en",
  krTitle: string, objectiveTitle: string,
  provider: AIProvider = "anthropic",
): Promise<KRClassification> {
  const text = await complete(provider, apiKey, model, `You are an OKR analyst. Given a Key Result title and its parent Objective, classify the KR into one of three types and extract measurement details.

KR Types:
- "milestone": binary done/not-done, no tracking number needed (e.g. 取得證照, 完成上線, 發布產品, 通過考試)
- "cumulative": counting repeated actions; each task completion adds N units (e.g. 完成24次練習, 讀完10本書, 發布12篇文章)
- "measurement": tracking a changing numeric state; user manually records current value (e.g. 體重降到70kg, 月營收達10萬, 英語閱讀速度200wpm)

${currentDateInstruction()}
${langInstruction(language)}

Output ONLY valid JSON:
{
  "krType": "cumulative"|"measurement"|"milestone",
  "metricName": "short noun phrase for what is tracked (≤6 words, empty string for milestone)",
  "targetValue": number or null (null for milestone),
  "unit": "unit of measurement, empty string for milestone",
  "deadline": "YYYY-MM-DD or null",
  "incrementPerTask": number (for cumulative: units per task, e.g. 1; for others: 1)
}
No markdown fences.`,
    `Objective: ${objectiveTitle}\nKR: ${krTitle}`, 300);
  return JSON.parse(extractJSON(stripFences(text))) as KRClassification;
}

// ── KR Title Refinement ──────────────────────────────────────────────────────

export async function refineKRTitle(
  apiKey: string, model: string, language: "zh-TW" | "en",
  objectiveTitle: string, currentTitle: string, userInstruction: string,
  provider: AIProvider = "anthropic",
): Promise<string> {
  return complete(provider, apiKey, model, `You are an OKR coach. The user has a Key Result and wants to refine its wording based on their instruction.
Keep the SMART properties (specific, measurable, time-bound) intact. Apply only what the user asks for.
${currentDateInstruction()}
${langInstruction(language)}
Output ONLY the revised KR title as plain text. No quotes, no markdown.`,
    `Objective: ${objectiveTitle}\nCurrent KR: ${currentTitle}\nUser instruction: ${userInstruction}`, 200);
}

// ── Idea Clarification Gate ──────────────────────────────────────────────────

export async function clarifyIdea(
  apiKey: string, model: string, language: "zh-TW" | "en",
  ideaTitle: string, objectives: Objective[],
  provider: AIProvider = "anthropic",
): Promise<{ shouldClarify: boolean; question: string }> {
  const objList = objectives.map((o) => `- ${o.title}`).join("\n");
  const text = await complete(provider, apiKey, model, `You are an OKR coach. A user just typed an idea title. Decide whether you need one clarifying question to score it accurately against their OKRs.

Ask (shouldClarify: true) when ANY of these apply:
- The title is very short (fewer than 3 meaningful words) and its meaning isn't obvious
- The title looks like a test input, typo, abbreviation, or placeholder (e.g. "m/4", "test", "aaa")
- The title is genuinely ambiguous — the same words could mean very different things relative to the OKRs (e.g. "學習新技術" could mean many things)

Do NOT ask for self-explanatory, specific titles that clearly map to a domain.
${langInstruction(language)}
Output ONLY valid JSON: {"shouldClarify":true|false,"question":"one focused question, or empty string if false"}
No markdown fences.`,
    `Idea: ${ideaTitle}\n\nUser's OKRs:\n${objList}`, 200);
  return JSON.parse(extractJSON(stripFences(text)));
}

// ── Idea Analysis ─────────────────────────────────────────────────────────────

const IDEA_SYSTEM_PROMPT = `You are an OKR decision navigator. Given a user's Objectives and Key Results (OKRs) and a new Idea they are considering, you must analyze how much this Idea helps achieve each Objective.

Output ONLY valid JSON matching this exact schema:
{
  "summary": "string (1-2 sentences overall verdict — the most important conclusion the user needs to know)",
  "objectiveScores": [
    {
      "objectiveId": "string",
      "objectiveTitle": "string",
      "objectiveDescription": "string (if the objective has no user description, write a concise 1-line explanation of what this objective means, ≤20 chars; if user provided a description, copy it verbatim here)",
      "overallScore": number (0-10, how much this idea helps achieve this Objective),
      "keyResultScores": [
        {
          "keyResultId": "string",
          "keyResultTitle": "string",
          "score": number (0-10),
          "reasoning": "string (≤15 Chinese characters — the single most critical point only)"
        }
      ],
      "reasoning": "string (≤15 Chinese characters — the single most critical point explaining this objective's score)"
    }
  ],
  "finalScore": number (0-10, weighted average — each objective's weight = objective_priority_weight × group_priority_weight, where priority P1/P2/P3 → weight 3/2/1),
  "risks": ["string", ...] (list of risks or negative side effects, empty array if none),
  "executionSuggestions": ["string", ...] (2-3 concrete action steps to execute this idea)
}

Scoring guide:
- 0-2: No meaningful contribution or actively harmful
- 3-4: Slight indirect contribution
- 5-6: Moderate contribution
- 7-8: Strong contribution
- 9-10: This idea is central to achieving the objective

finalScore must be a weighted average: weight = objective_priority_weight × group_priority_weight (both use P1=3, P2=2, P3=1; no group = group weight 1). Output ONLY the JSON object, no markdown fences.`;

export async function analyzeIdea(
  apiKey: string, model: string, language: "zh-TW" | "en",
  ideaTitle: string, ideaNotes: string, objectives: Objective[],
  evaluationContext?: string, groups?: ObjGroup[],
  provider: AIProvider = "anthropic",
): Promise<IdeaAnalysis> {
  const groupMap = new Map((groups ?? []).map((g) => [g.id, g]));
  const okrContext = objectives
    .map((o) => {
      const group = o.meta?.groupId ? groupMap.get(o.meta.groupId) : undefined;
      return (
        `Objective ID: ${o.id}\nObjective: ${o.title}` +
        (o.description ? `\nDescription: ${o.description}` : "") +
        (o.meta?.deadline ? `\nDeadline: ${o.meta.deadline}` : "") +
        `\nPriority: ${o.meta?.priority ?? 2} (1=highest, 3=lowest)` +
        (group ? `\nGroup: ${group.name} (Group Priority: ${group.priority}, 1=highest)` : "") +
        `\nKey Results:\n${o.keyResults.map((kr) => `  - KR ID: ${kr.id}\n    KR: ${kr.title}`).join("\n")}`
      );
    })
    .join("\n\n");

  const parts = [`Title: ${ideaTitle}`];
  if (ideaNotes.trim()) parts.push(`Additional notes: ${ideaNotes}`);

  const text = await complete(
    provider, apiKey, model,
    IDEA_SYSTEM_PROMPT + (evaluationContext ?? "") + `\n\n${langInstruction(language)}`,
    `USER'S OKRs:\n${okrContext}\n\nIDEA TO ANALYZE:\n${parts.join("\n")}`,
    4096,
  );
  const parsed = JSON.parse(extractJSON(stripFences(text))) as Omit<IdeaAnalysis, "analyzedAt">;
  return { ...parsed, analyzedAt: new Date().toISOString() };
}
