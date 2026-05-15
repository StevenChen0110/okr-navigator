import { complete, completeWithHistory } from "./llm";
import type { AIProvider } from "./types";
import { Objective, ObjGroup, IdeaAnalysis, KRConfidence, GoalSuggestion, Milestone, MilestoneSuggestion, GroupSequencePhase, GroupSequenceSuggestion, TaskTimeframe, PlanPeriod, PlanAnalysisResult } from "./types";

export interface ReportItem {
  content: string;
  isPlanned: boolean;
  krTitle: string | null;
  status?: string;  // "active" | "in-progress" | "shelved" | "completed"
  score?: number;   // 0-10 alignment score from prior AI analysis
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

// ── OKR Chat Coach ───────────────────────────────────────────────────────────

function parseChatSuggestion(text: string): { content: string; suggestion?: GoalSuggestion } {
  const match = text.match(/<suggestion>([\s\S]*?)<\/suggestion>/);
  if (!match) return { content: text };
  const content = text.replace(/<suggestion>[\s\S]*?<\/suggestion>/, "").trim();
  try {
    return { content, suggestion: JSON.parse(match[1].trim()) as GoalSuggestion };
  } catch {
    return { content };
  }
}

export async function chatOKRCoach(
  apiKey: string, model: string, language: "zh-TW" | "en",
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  objectives: Objective[],
  groups: ObjGroup[],
  mode: "goalBuilder" | "optimize",
  provider: AIProvider = "anthropic",
): Promise<{ content: string; suggestion?: GoalSuggestion }> {
  const active = objectives.filter((o) => !o.status || o.status === "active");
  const groupMap = new Map((groups ?? []).map((g) => [g.id, g]));
  const existingGoals = active.length > 0
    ? active.map((o) => {
        const group = o.meta?.groupId ? groupMap.get(o.meta.groupId) : undefined;
        return `- [ID:${o.id}] ${o.title}${group ? ` (Group: ${group.name})` : ""}\n  KRs: ${o.keyResults.map((kr) => kr.title).join("; ")}`;
      }).join("\n")
    : "(no existing goals)";

  const suggestionFormat = `<suggestion>
{"goals":[{"action":"add|update|remove","id":"only for update/remove","title":"...","krs":["KR 1","KR 2"],"priority":2}]}
</suggestion>`;

  let systemPrompt: string;
  if (mode === "goalBuilder") {
    systemPrompt = `You are a friendly OKR coach having a natural conversation with the user. Help them define a clear goal with measurable Key Results.

Write like you are talking to a person — no bullet points, no markdown symbols, no bold text, no headers. Just plain conversational sentences.

If what they want is clear enough, propose the goal right away without asking more questions. Only ask a question if you genuinely cannot tell what they are trying to achieve, and ask at most one question at a time.

When writing KRs, each one should describe an observable end state (e.g. "從 A 提升到 B"), not a task or process. Keep each KR to one concrete sentence.

Observer tone rules (MANDATORY): offer options ("有一個方向可以考慮"), never commands ("你應該"); NEVER say "太棒了" "做得很好" "加油".

When you have a proposal ready, place the suggestion block at the very end of your message (the user will not see this part — it is parsed separately):
${suggestionFormat}

User's current goals:
${existingGoals}

${langInstruction(language)} Do not use any markdown formatting in your reply.`;
  } else {
    systemPrompt = `You are a friendly OKR coach reviewing the user's goals. Speak naturally, as if talking through their goals with them in person.

Write in plain conversational prose — no bullet points, no markdown symbols, no bold text, no headers. Just natural sentences.

Look for things like goals that overlap and could be merged, KRs that are too vague to measure, KRs so big they deserve their own goal, or goals that are no longer relevant. Describe what you observe ("這個目標在X上著力較多") rather than what's missing ("你沒有Y"). Offer options, not commands.

Observer tone rules (MANDATORY): offer options ("有一個方向可以考慮"), never commands ("你應該"); NEVER say "太棒了" "做得很好" "加油".

After your message, append the suggestion block (the user will not see this part):
${suggestionFormat}

For updates include the goal's existing ID. For removals use action:"remove" with just the ID and an empty title.

User's current goals:
${existingGoals}

${langInstruction(language)} Do not use any markdown formatting in your reply.`;
  }

  const text = await completeWithHistory(provider, apiKey, model, systemPrompt, messages, 1024);
  return parseChatSuggestion(text);
}

// ── Roadmap ────────────────────────────────────────────────────────────────────

function parseMilestoneSuggestion(text: string): { content: string; suggestion?: MilestoneSuggestion } {
  const match = text.match(/<milestone_suggestion>([\s\S]*?)<\/milestone_suggestion>/);
  if (!match) return { content: text };
  const content = text.replace(/<milestone_suggestion>[\s\S]*?<\/milestone_suggestion>/, "").trim();
  try {
    return { content, suggestion: JSON.parse(match[1].trim()) as MilestoneSuggestion };
  } catch {
    return { content };
  }
}

function parseGroupSuggestion(text: string): { content: string; suggestion?: GroupSequenceSuggestion } {
  const match = text.match(/<group_suggestion>([\s\S]*?)<\/group_suggestion>/);
  if (!match) return { content: text };
  const content = text.replace(/<group_suggestion>[\s\S]*?<\/group_suggestion>/, "").trim();
  try {
    return { content, suggestion: JSON.parse(match[1].trim()) as GroupSequenceSuggestion };
  } catch {
    return { content };
  }
}

export async function generateMilestones(
  apiKey: string, model: string, language: "zh-TW" | "en",
  objective: Objective,
  provider: AIProvider = "anthropic",
): Promise<Milestone[]> {
  const krs = objective.keyResults.map((kr) => `- ${kr.title}`).join("\n");
  const systemPrompt = language === "zh-TW"
    ? `你是 OKR 規劃教練。根據目標和關鍵結果，規劃 4 到 7 個里程碑，形成達成目標的邏輯進程。每個里程碑是具體、可驗證的中間成果。只輸出合法的 JSON 陣列，不要輸出其他文字或 markdown 格式：[{"title":"...","timeframe":"...","order":1},...]`
    : `You are an OKR planning coach. Given the objective and key results, plan 4 to 7 milestones forming a logical progression toward the goal. Each milestone is a concrete, verifiable intermediate outcome. Output ONLY a valid JSON array, no other text: [{"title":"...","timeframe":"...","order":1},...]`;
  const userPrompt = language === "zh-TW"
    ? `目標：${objective.title}\n${objective.description ? `說明：${objective.description}\n` : ""}關鍵結果：\n${krs}`
    : `Objective: ${objective.title}\n${objective.description ? `Description: ${objective.description}\n` : ""}Key Results:\n${krs}`;
  const text = await complete(provider, apiKey, model, systemPrompt, userPrompt);
  try {
    const parsed = JSON.parse(stripFences(extractJSON(text)));
    return (Array.isArray(parsed) ? parsed : []).map((m: { title: string; timeframe?: string; order?: number }, i: number) => ({
      id: crypto.randomUUID(),
      title: String(m.title ?? ""),
      timeframe: m.timeframe,
      order: Number(m.order ?? i + 1),
    }));
  } catch {
    return [];
  }
}

export async function chatRoadmapCoach(
  apiKey: string, model: string, language: "zh-TW" | "en",
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  objective: Objective,
  milestones: Milestone[],
  provider: AIProvider = "anthropic",
): Promise<{ content: string; suggestion?: MilestoneSuggestion }> {
  const krs = objective.keyResults.map((kr) => `- ${kr.title}`).join("\n");
  const msList = milestones.length > 0
    ? milestones.map((m) => `- [ID:${m.id}] ${m.title}${m.timeframe ? ` (${m.timeframe})` : ""}`).join("\n")
    : "(尚無里程碑)";
  const suggestionFormat = `<milestone_suggestion>
{"milestones":[{"action":"add|update|remove","id":"only for update/remove","title":"...","timeframe":"...","order":1}]}
</milestone_suggestion>`;
  const systemPrompt = language === "zh-TW"
    ? `你是一位路徑圖教練，幫助用戶規劃達成目標的里程碑。用自然對話的方式回應，不使用 markdown 符號、條列符號、粗體或標題。

目標：${objective.title}
關鍵結果：
${krs}

現有里程碑：
${msList}

要建議修改時，在訊息最後附上（用戶看不到）：
${suggestionFormat}

請用繁體中文回應，不使用任何 markdown 格式。`
    : `You are a roadmap coach helping the user plan milestones toward their goal. Reply in natural conversational prose — no markdown, no bullets, no bold, no headers.

Objective: ${objective.title}
Key Results:
${krs}

Current milestones:
${msList}

When suggesting changes, append at the very end (user won't see it):
${suggestionFormat}

Do not use any markdown formatting.`;
  const text = await completeWithHistory(provider, apiKey, model, systemPrompt, messages, 1024);
  return parseMilestoneSuggestion(text);
}

export async function chatGroupRoadmapCoach(
  apiKey: string, model: string, language: "zh-TW" | "en",
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  group: ObjGroup,
  objectives: Objective[],
  currentPhases: GroupSequencePhase[],
  provider: AIProvider = "anthropic",
): Promise<{ content: string; suggestion?: GroupSequenceSuggestion }> {
  const objList = objectives.map((o) =>
    `- [ID:${o.id}] ${o.title} (priority:${o.meta?.priority ?? 2})\n  KRs: ${o.keyResults.map((kr) => kr.title).join("; ")}`
  ).join("\n");
  const currentArrangement = currentPhases.length > 0
    ? currentPhases.map((p) => `Phase ${p.phase} (${p.canParallel ? "parallel" : "sequential"}): ${p.objectiveIds.join(", ")}${p.note ? ` — ${p.note}` : ""}`).join("\n")
    : "(not arranged yet)";
  const suggestionFormat = `<group_suggestion>
{"phases":[{"phase":1,"objectiveIds":["id1","id2"],"canParallel":false,"note":"optional"},...]}
</group_suggestion>`;
  const systemPrompt = language === "zh-TW"
    ? `你是一位 OKR 教練，幫用戶規劃群組內目標的執行順序。分析哪些目標有依賴關係（必須先完成 A 才能做 B），哪些可以同時推進。建議合理的分階段方案。用自然對話方式回應，不使用 markdown。

群組：${group.name}
群組目標：
${objList}

現有排序：
${currentArrangement}

要建議排序時，在訊息最後附上（用戶看不到）：
${suggestionFormat}

請用繁體中文回應，不使用任何 markdown 格式。`
    : `You are an OKR coach helping the user sequence goals within a group. Analyze dependencies (must do A before B) and which goals can run in parallel. Suggest a phased plan. Reply in natural conversational prose — no markdown.

Group: ${group.name}
Goals in group:
${objList}

Current arrangement:
${currentArrangement}

When suggesting a sequence, append at the very end (user won't see it):
${suggestionFormat}

Do not use any markdown formatting.`;
  const text = await completeWithHistory(provider, apiKey, model, systemPrompt, messages, 1024);
  return parseGroupSuggestion(text);
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
        `\nKey Results:\n${o.keyResults.map((kr) => {
          let progress = "";
          if (kr.targetValue !== undefined && kr.currentValue !== undefined && kr.targetValue > 0) {
            const pct = Math.min(100, Math.round((kr.currentValue / kr.targetValue) * 100));
            progress = ` [Progress: ${kr.currentValue}${kr.unit ? " " + kr.unit : ""}/${kr.targetValue}${kr.unit ? " " + kr.unit : ""}, ${pct}% complete]`;
          } else if (kr.checkIns && kr.checkIns.length > 0) {
            const latest = kr.checkIns[kr.checkIns.length - 1];
            progress = ` [Latest check-in: ${latest.value}${kr.unit ? " " + kr.unit : ""} on ${latest.date.split("T")[0]}]`;
          }
          return `  - KR ID: ${kr.id}\n    KR: ${kr.title}${progress}`;
        }).join("\n")}`
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

export async function chatTaskCoach(
  apiKey: string, model: string, language: "zh-TW" | "en",
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  task: { title: string; timeframe?: string; analysis?: IdeaAnalysis | null },
  objectives: Objective[],
  provider: AIProvider = "anthropic",
): Promise<{ content: string }> {
  const objList = objectives.slice(0, 6).map((o) =>
    `- ${o.title}\n  KRs: ${o.keyResults.map((kr) => kr.title).join("; ")}`
  ).join("\n");
  const analysisCtx = task.analysis
    ? (language === "zh-TW"
      ? `\n分析分數：${task.analysis.finalScore.toFixed(1)}/10\n摘要：${task.analysis.summary}${task.analysis.risks.length > 0 ? "\n風險：" + task.analysis.risks.join("；") : ""}`
      : `\nScore: ${task.analysis.finalScore.toFixed(1)}/10\nSummary: ${task.analysis.summary}${task.analysis.risks.length > 0 ? "\nRisks: " + task.analysis.risks.join("; ") : ""}`)
    : "";
  const systemPrompt = language === "zh-TW"
    ? `你是一位任務督導 AI，幫助用戶確保每件事情都在正確軌道上。你的核心職責：確認任務是否值得做、是否有助達成目標、有沒有更好的做法。直接說重點。

當前任務：${task.title}
時間範疇：${task.timeframe ?? "未指定"}${analysisCtx}

用戶的目標：
${objList}

用自然對話方式回應，不使用 markdown 格式。請用繁體中文。`
    : `You are a task supervisor AI ensuring every task is truly worthwhile and on track. Core role: confirm if this task is worth doing, if it advances the user's goals, and if there's a better approach. Be direct.

Current task: ${task.title}
Timeframe: ${task.timeframe ?? "not specified"}${analysisCtx}

User's objectives:
${objList}

Reply in natural conversational prose, no markdown.`;
  const text = await completeWithHistory(provider, apiKey, model, systemPrompt, messages, 512);
  return { content: text };
}

// ── Plan Items Analysis ───────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are a task planning observer. Analyze a list of todo items and evaluate their contribution to the user's OKRs.

IMPORTANT SCORING PHILOSOPHY — time scope changes what a "good" score means:
- "today" items are TACTICAL single actions completable in one day. Score 7-9 if it is clearly the right action for today. Score 4-6 if acceptable but not ideal. Score 1-3 if it is too vague/large for a single day (mis-scoped).
- "week" items should advance at least one KR meaningfully within 7 days. Good items score 6-9.
- "month" items should have strategic impact and move KRs significantly. Strong items score 7-10. Score low if the item is too small/tactical for monthly planning.
- "custom" items: evaluate based on their apparent scope relative to stated timeframe.

Key insight: a today task like "制定三年計畫" is TOO BIG for today → penalize. A monthly task like "發一封郵件" is TOO SMALL for monthly planning → penalize.

Observer tone rules (MANDATORY):
- overallAssessment: describe what you observe ("這份計畫在X上投入較多"), not what's missing ("你沒有做Y")
- suggestions: always offer options ("有一個方向可以考慮：..."), never commands ("你應該...")
- NEVER say "太棒了" "做得很好" "加油" in any field

Output ONLY valid JSON:
{
  "overallAssessment": "string (2-3 sentences: is the plan well-structured? critical gaps or priority issues?)",
  "items": [
    {
      "id": "string (exact id from input)",
      "score": number (0-10),
      "reasoning": "string (≤20 Chinese characters — key reason for this score)",
      "periodNote": "string (≤20 Chinese characters — is this item appropriately scoped for its time period?)"
    }
  ],
  "suggestions": "string (2-3 concrete suggestions to improve the plan)"
}
No markdown fences.`;

export async function analyzePlanItems(
  apiKey: string, model: string, language: "zh-TW" | "en",
  items: Array<{ id: string; title: string; period: PlanPeriod }>,
  objectives: Objective[],
  scope: "all" | "today" | "week" | "month",
  evaluationContext?: string,
  groups?: ObjGroup[],
  provider: AIProvider = "anthropic",
): Promise<PlanAnalysisResult> {
  const groupMap = new Map((groups ?? []).map((g) => [g.id, g]));
  const okrContext = objectives
    .filter((o) => !o.status || o.status === "active")
    .map((o) => {
      const group = o.meta?.groupId ? groupMap.get(o.meta.groupId) : undefined;
      return (
        `Objective: ${o.title} (Priority: ${o.meta?.priority ?? 2})` +
        (group ? ` [Group: ${group.name}]` : "") +
        `\n  KRs: ${o.keyResults.map((kr) => {
          let progress = "";
          if (kr.targetValue !== undefined && kr.currentValue !== undefined && kr.targetValue > 0) {
            const pct = Math.min(100, Math.round((kr.currentValue / kr.targetValue) * 100));
            progress = ` [${pct}% complete]`;
          }
          return kr.title + progress;
        }).join("; ")}`
      );
    })
    .join("\n");

  const scopeLabel: Record<string, string> = {
    all: "all time periods",
    today: "today only",
    week: "this week only",
    month: "this month only",
  };

  const itemsText = items
    .map((item) => `- ID: ${item.id} | Period: ${item.period} | Task: ${item.title}`)
    .join("\n");

  const text = await complete(
    provider, apiKey, model,
    PLAN_SYSTEM_PROMPT + (evaluationContext ?? "") + `\n\n${langInstruction(language)}`,
    `USER'S OKRs:\n${okrContext}\n\nTODO ITEMS TO ANALYZE (scope: ${scopeLabel[scope]}):\n${itemsText}`,
    2048,
  );
  return JSON.parse(extractJSON(stripFences(text))) as PlanAnalysisResult;
}

// ── Plan / Idea Discussion Coach ──────────────────────────────────────────────

export async function chatPlanCoach(
  apiKey: string, model: string, language: "zh-TW" | "en",
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  context: {
    type: "idea" | "plan";
    ideaTitle?: string;
    ideaScore?: number;
    ideaSummary?: string;
    planItems?: Array<{ title: string; period: string; score?: number }>;
    overallAssessment?: string;
    suggestions?: string;
  },
  objectives: Objective[],
  provider: AIProvider = "anthropic",
): Promise<{ content: string }> {
  const objList = objectives.slice(0, 6).map((o) =>
    `- ${o.title}: ${o.keyResults.map((kr) => kr.title).join("; ")}`
  ).join("\n");

  let systemPrompt: string;
  if (context.type === "idea") {
    systemPrompt = language === "zh-TW"
      ? `你是一位方向觀察者，正在和用戶討論一個想法的評估結果，協助他們決定是否推進或如何調整。用自然對話語氣，不使用 markdown。
語氣規則：描述行為而非評判；給建議時提供選項而非命令；不說空洞稱讚。

想法：${context.ideaTitle ?? ""}
AI 分析分數：${context.ideaScore?.toFixed(1) ?? "─"}/10
分析摘要：${context.ideaSummary ?? ""}

用戶的目標：
${objList}

請用繁體中文回應，不使用任何 markdown 格式。`
      : `You are a direction observer, not a judge. Help the user decide whether to proceed with an idea or how to adapt it. No markdown. Offer options, don't command.

Idea: ${context.ideaTitle ?? ""}
AI score: ${context.ideaScore?.toFixed(1) ?? "─"}/10
Summary: ${context.ideaSummary ?? ""}

User's objectives:
${objList}`;
  } else {
    const itemsText = (context.planItems ?? [])
      .map((i) => `- [${i.period}] ${i.title}${i.score !== undefined ? ` (${i.score.toFixed(1)}/10)` : ""}`)
      .join("\n");
    systemPrompt = language === "zh-TW"
      ? `你是一位任務規劃觀察者，正在和用戶討論他們的待辦計畫，協助調整優先序或識別計畫缺口。用自然對話語氣，不使用 markdown。
語氣規則：說「你在X上花了最多時間」不說「你沒完成Y」；給建議時說「有一個方向可以考慮」不說「你應該」；不說「加油」「太棒了」。

整體評估：${context.overallAssessment ?? ""}
AI 建議：${context.suggestions ?? ""}

當前計畫清單：
${itemsText}

用戶的目標：
${objList}

請用繁體中文回應，不使用任何 markdown 格式。`
      : `You are a task planning observer, not a judge. Help adjust priorities or identify planning gaps. No markdown. Offer options, don't command.

Overall assessment: ${context.overallAssessment ?? ""}
Suggestions: ${context.suggestions ?? ""}

Current plan:
${itemsText}

User's objectives:
${objList}`;
  }

  const text = await completeWithHistory(provider, apiKey, model, systemPrompt, messages, 512);
  return { content: text };
}

// ── Weekly Log Classification ─────────────────────────────────────────────────

export async function classifyLogItems(
  apiKey: string, model: string, language: "zh-TW" | "en",
  rawInput: string, objectives: Objective[],
  provider: AIProvider = "anthropic",
): Promise<Array<{ content: string; krId: string | null; krTitle: string | null; isPlanned: boolean }>> {
  const krList = objectives
    .filter((o) => !o.status || o.status === "active")
    .flatMap((o) => o.keyResults.map((kr) => `KR ID: ${kr.id} | KR: ${kr.title} | Objective: ${o.title}`))
    .join("\n");

  const text = await complete(provider, apiKey, model, `You are a task classifier. The user wrote a free-form weekly log. Split it into individual action items and match each one to the most relevant Key Result from the user's goals. Be lenient — partial or thematic matches count.

User's Key Results:
${krList || "(none defined yet)"}

Rules:
- Split by sentences, line breaks, or natural action boundaries
- For each item: if it matches a KR (even loosely), set isPlanned=true and include that KR's id and title
- If no KR matches, set isPlanned=false, krId=null, krTitle=null
- Keep content as the user wrote it (minimal editing)
- Return 1-15 items max; merge trivial fragments

${langInstruction(language)}
Output ONLY a valid JSON array. No markdown fences.
[{"content":"...","krId":"...or null","krTitle":"...or null","isPlanned":true|false}]`,
    `Weekly log:\n${rawInput}`, 1024);
  return JSON.parse(extractJSON(stripFences(text)));
}

// ── Alignment Report Generation ───────────────────────────────────────────────

const OBSERVER_TONE = `Observer tone rules (MANDATORY):
- Describe what you see: "你這週在X上投入最多時間" NOT "你沒完成Y"
- Offer options: "有一個方向可以考慮：A。你也可以繼續B" NOT "你應該做A"
- No hollow praise: NEVER say "太棒了" "你做得很好" "加油" "繼續努力"
- Share insight as observation: "從這週的記錄，我注意到..." then return choice to user
- Tone: curious observer, not judge or cheerleader`;

export async function generateAlignmentReport(
  apiKey: string, model: string, language: "zh-TW" | "en",
  objectives: Objective[], items: ReportItem[],
  provider: AIProvider = "anthropic",
): Promise<{ alignmentScore: number; aiInsight: string; suggestions: string[] }> {
  const planned = items.filter((i) => i.isPlanned);
  const completed = items.filter((i) => i.status === "completed");

  // Score: planned ratio (60%) + completion ratio (40% when status available)
  const hasStatus = items.some((i) => i.status !== undefined);
  const plannedRatio = items.length > 0 ? planned.length / items.length : 0;
  const completionRatio = hasStatus && items.length > 0
    ? (completed.length + items.filter((i) => i.status === "in-progress").length * 0.5) / items.length
    : plannedRatio;
  const rawScore = Math.round((plannedRatio * 0.5 + completionRatio * 0.5) * 100);

  const okrContext = objectives
    .filter((o) => !o.status || o.status === "active")
    .map((o) => `目標：${o.title}\n  KRs: ${o.keyResults.map((kr) => kr.title).join("；")}`)
    .join("\n\n");

  const statusLabel: Record<string, string> = {
    completed: "已完成", "in-progress": "進行中", shelved: "暫存", active: "待辦",
  };

  const itemsText = items.map((i) => {
    const parts = [
      i.isPlanned ? "✓" : "○",
      i.status ? `[${statusLabel[i.status] ?? i.status}]` : "",
      i.score !== undefined ? `[分數:${i.score.toFixed(1)}]` : "",
      i.krTitle ? `[對應: ${i.krTitle}]` : "[計劃外]",
      i.content,
    ];
    return parts.filter(Boolean).join(" ");
  }).join("\n");

  const text = await complete(provider, apiKey, model, `You are a direction alignment coach. Analyze the user's weekly actions vs their goals and produce a report.

${OBSERVER_TONE}

${langInstruction(language)}

Output ONLY valid JSON:
{
  "alignmentScore": ${rawScore},
  "aiInsight": "2-3 sentences using observer tone. Mention what the user spent most time on and how it relates to their goals. Note patterns without judging.",
  "suggestions": ["1-2 items. Each offers an option, not a command. Use 有一個方向可以考慮 / One direction to consider pattern."]
}
No markdown fences.`,
    `用戶的目標：\n${okrContext}\n\n本週行動（含完成狀態）：\n${itemsText}`, 512);

  const parsed = JSON.parse(extractJSON(stripFences(text)));
  return {
    alignmentScore: Math.max(0, Math.min(100, parsed.alignmentScore ?? rawScore)),
    aiInsight: parsed.aiInsight ?? "",
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}
