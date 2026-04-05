import Anthropic from "@anthropic-ai/sdk";
import { Objective, IdeaAnalysis, KRConfidence } from "./types";

function getClient(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

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
  apiKey: string,
  model: string,
  language: "zh-TW" | "en",
  rawInput: string
): Promise<{
  title: string;
  motivation: string;
  okrType: "committed" | "aspirational";
  timeframe: string;
}> {
  const client = getClient(apiKey);
  const message = await client.messages.create({
    model,
    max_tokens: 512,
    system: `You are an OKR coach. The user describes a goal in one sentence. Infer:
- title: a concise, action-oriented Objective title (≤15 words)
- motivation: why they likely want this (1 sentence)
- okrType: "committed" if it sounds like a must-achieve goal, "aspirational" if it sounds like a stretch goal
- timeframe: one of "本月", "本季", "半年", "全年"

${langInstruction(language)}
Output ONLY valid JSON: {"title":"...","motivation":"...","okrType":"committed"|"aspirational","timeframe":"..."}
No markdown fences.`,
    messages: [{ role: "user", content: rawInput }],
  });
  const raw = stripFences((message.content[0] as { type: string; text: string }).text.trim());
  return JSON.parse(extractJSON(raw));
}

// ── Stage 2: Propose SMART KRs ───────────────────────────────────────────────

export async function suggestKeyResults(
  apiKey: string,
  model: string,
  language: "zh-TW" | "en",
  objectiveTitle: string,
  objectiveDescription?: string,
  existingKRs?: string[]
): Promise<string[]> {
  const client = getClient(apiKey);
  const existing = existingKRs?.length
    ? `\nExisting KRs (do NOT duplicate): ${existingKRs.map((k) => `"${k}"`).join(", ")}`
    : "";
  const message = await client.messages.create({
    model,
    max_tokens: 512,
    system: `You are an OKR expert. Suggest 3-5 Key Results for the given Objective.
Each KR must be SMART: specific, measurable (include numbers), and time-bound.
Format: "verb + metric + number + deadline".
${currentDateInstruction()}
${langInstruction(language)}
Output ONLY a JSON array of strings. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Objective: ${objectiveTitle}${objectiveDescription ? `\nContext: ${objectiveDescription}` : ""}${existing}`,
      },
    ],
  });
  const raw = stripFences((message.content[0] as { type: string; text: string }).text.trim());
  return JSON.parse(extractJSON(raw)) as string[];
}

// ── Stage 2: Convert user-written KRs to SMART format ────────────────────────

export async function convertAllToSMART(
  apiKey: string,
  model: string,
  language: "zh-TW" | "en",
  krs: string[],
  objectiveTitle: string,
  timeframe: string
): Promise<string[]> {
  const client = getClient(apiKey);
  const message = await client.messages.create({
    model,
    max_tokens: 768,
    system: `You are an OKR coach. Convert each Key Result to SMART format (specific, measurable, time-bound).
Keep the user's original intent. Add numbers or deadlines only if missing. Use the timeframe hint if no deadline is specified.
${currentDateInstruction()}
${langInstruction(language)}
Output ONLY a JSON array of strings in the same order as input. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Objective: ${objectiveTitle}\nTimeframe: ${timeframe}\nKRs to convert:\n${JSON.stringify(krs)}`,
      },
    ],
  });
  const raw = stripFences((message.content[0] as { type: string; text: string }).text.trim());
  return JSON.parse(extractJSON(raw)) as string[];
}

// ── Stage 3: Generate snapshot summary ──────────────────────────────────────

export async function generateSnapshot(
  apiKey: string,
  model: string,
  language: "zh-TW" | "en",
  objectiveTitle: string,
  motivation: string,
  okrType: "committed" | "aspirational",
  timeframe: string,
  krs: string[]
): Promise<string> {
  const client = getClient(apiKey);
  const typeLabel = okrType === "committed" ? "承諾型（必達）" : "願景型（挑戰）";
  const message = await client.messages.create({
    model,
    max_tokens: 300,
    system: `You are an OKR coach. Based on the goal details provided, write a concise setting background that the user can read months later to recall why they set this goal. Use 2-4 short bullet points covering: core motivation, type of commitment, and what success looks like. Keep each bullet to 1 sentence. Do NOT repeat the KRs verbatim. ${langInstruction(language)}`,
    messages: [
      {
        role: "user",
        content: `目標：${objectiveTitle}\n類型：${typeLabel}\n時間範圍：${timeframe}\n動機：${motivation}\nKR：\n${krs.map((k, i) => `${i + 1}. ${k}`).join("\n")}`,
      },
    ],
  });
  return (message.content[0] as { type: string; text: string }).text.trim();
}

// ── Confidence: Analyze why confidence dropped ───────────────────────────────

export async function analyzeConfidenceDrop(
  apiKey: string,
  model: string,
  language: "zh-TW" | "en",
  krTitle: string,
  objectiveTitle: string,
  confidence: KRConfidence
): Promise<string> {
  const client = getClient(apiKey);
  const levelMap = {
    "at-risk": "at-risk (struggling but might still achieve)",
    "needs-rethink": "needs rethink (unlikely to achieve)",
  };
  const message = await client.messages.create({
    model,
    max_tokens: 300,
    system: `You are an OKR coach. The user marked a KR as "${levelMap[confidence as keyof typeof levelMap]}". Give a 2-3 sentence response:
1. Ask whether the issue is execution difficulty or the KR itself is no longer suitable
2. Suggest one concrete next step based on the confidence level
Keep it practical and direct. ${langInstruction(language)}`,
    messages: [
      {
        role: "user",
        content: `Objective: ${objectiveTitle}\nKR: ${krTitle}`,
      },
    ],
  });
  return (message.content[0] as { type: string; text: string }).text.trim();
}

// ── Quarter scoring: Get AI recommendation ───────────────────────────────────

export async function getQuarterRecommendation(
  apiKey: string,
  model: string,
  language: "zh-TW" | "en",
  objectiveTitle: string,
  okrType: "committed" | "aspirational",
  krScores: Array<{ title: string; score: number }>
): Promise<{ verdict: "complete" | "continue" | "reset"; reasoning: string }> {
  const client = getClient(apiKey);
  const typeLabel = okrType === "committed" ? "committed" : "aspirational";
  const avgScore = krScores.reduce((s, k) => s + k.score, 0) / krScores.length;
  const message = await client.messages.create({
    model,
    max_tokens: 400,
    system: `You are an OKR coach. Based on the quarterly scores, give a recommendation.
For committed OKRs: avg ≥ 0.9 → "complete", 0.5-0.9 → "continue", < 0.5 → "reset"
For aspirational OKRs: avg ≥ 0.7 → "complete", 0.4-0.7 → "continue", < 0.4 → "reset"
${langInstruction(language)}
Output ONLY valid JSON: {"verdict":"complete"|"continue"|"reset","reasoning":"2-3 sentences explaining why and what to do next"}
No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Objective: ${objectiveTitle}\nType: ${typeLabel}\nAverage score: ${avgScore.toFixed(2)}\nKR scores:\n${krScores.map((k) => `- ${k.title}: ${k.score.toFixed(1)}`).join("\n")}`,
      },
    ],
  });
  const raw = stripFences((message.content[0] as { type: string; text: string }).text.trim());
  return JSON.parse(extractJSON(raw));
}

// ── KR Metric Parsing ────────────────────────────────────────────────────────

export async function parseKRMetrics(
  apiKey: string,
  model: string,
  krTitle: string
): Promise<{ metricName: string; targetValue: number; unit: string; deadline: string | null }> {
  const client = getClient(apiKey);
  const message = await client.messages.create({
    model,
    max_tokens: 200,
    system: `You are an OKR analyst. Extract the measurable metric from a SMART Key Result.
${currentDateInstruction()}
Output ONLY valid JSON: {"metricName":"...","targetValue":number,"unit":"...","deadline":"YYYY-MM-DD or null"}
- metricName: short noun phrase for what is tracked (≤6 words)
- targetValue: the numeric goal
- unit: unit of measurement (e.g. 個, 本, %, 小時, sessions)
- deadline: YYYY-MM-DD if mentioned, else null
No markdown fences.`,
    messages: [{ role: "user", content: krTitle }],
  });
  const raw = stripFences((message.content[0] as { type: string; text: string }).text.trim());
  return JSON.parse(extractJSON(raw));
}

// ── Idea Analysis ─────────────────────────────────────────────────────────────

const IDEA_SYSTEM_PROMPT = `You are an OKR decision navigator. Given a user's Objectives and Key Results (OKRs) and a new Idea they are considering, you must analyze how much this Idea helps achieve each Objective.

Output ONLY valid JSON matching this exact schema:
{
  "objectiveScores": [
    {
      "objectiveId": "string",
      "objectiveTitle": "string",
      "overallScore": number (0-10, how much this idea helps achieve this Objective),
      "keyResultScores": [
        {
          "keyResultId": "string",
          "keyResultTitle": "string",
          "score": number (0-10),
          "reasoning": "string (1-2 sentences)"
        }
      ],
      "reasoning": "string (2-3 sentences explaining the O-level score)"
    }
  ],
  "finalScore": number (0-10, weighted average priority across all objectives),
  "risks": ["string", ...] (list of risks or negative side effects, empty array if none),
  "executionSuggestions": ["string", ...] (2-3 concrete action steps to execute this idea)
}

Scoring guide:
- 0-2: No meaningful contribution or actively harmful
- 3-4: Slight indirect contribution
- 5-6: Moderate contribution
- 7-8: Strong contribution
- 9-10: This idea is central to achieving the objective

The finalScore should reflect overall priority considering all objectives together. Weigh objectives equally unless context suggests otherwise. Output ONLY the JSON object, no markdown fences.`;

export async function analyzeIdea(
  apiKey: string,
  model: string,
  language: "zh-TW" | "en",
  ideaTitle: string,
  ideaWhy: string,
  ideaOutcome: string,
  ideaNotes: string,
  objectives: Objective[]
): Promise<IdeaAnalysis> {
  const client = getClient(apiKey);

  const okrContext = objectives
    .map(
      (o) =>
        `Objective ID: ${o.id}\nObjective: ${o.title}${o.description ? `\nDescription: ${o.description}` : ""}${o.meta?.okrType ? `\nType: ${o.meta.okrType}` : ""}${o.meta?.timeframe ? `\nTimeframe: ${o.meta.timeframe}` : ""}\nKey Results:\n${o.keyResults
          .map((kr) => `  - KR ID: ${kr.id}\n    KR: ${kr.title}${kr.confidence ? `\n    Confidence: ${kr.confidence}` : ""}`)
          .join("\n")}`
    )
    .join("\n\n");

  const parts = [`Title: ${ideaTitle}`];
  if (ideaWhy.trim()) parts.push(`Why (motivation): ${ideaWhy}`);
  if (ideaOutcome.trim()) parts.push(`Expected outcome: ${ideaOutcome}`);
  if (ideaNotes.trim()) parts.push(`Additional notes: ${ideaNotes}`);

  const userPrompt = `USER'S OKRs:\n${okrContext}\n\nIDEA TO ANALYZE:\n${parts.join("\n")}`;

  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    system: IDEA_SYSTEM_PROMPT + `\n\n${langInstruction(language)}`,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = stripFences((message.content[0] as { type: string; text: string }).text.trim());
  const parsed = JSON.parse(extractJSON(raw)) as Omit<IdeaAnalysis, "analyzedAt">;

  return { ...parsed, analyzedAt: new Date().toISOString() };
}
