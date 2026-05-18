"use client";

import { useState, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import {
  Idea,
  Objective,
  IdeaAnalysis,
  IdeaKRLink,
  IdeaStatus,
  EvaluationProfile,
  ObjGroup,
  PlanItem,
  PlanPeriod,
  PlanStatus,
  PlanAnalysisResult,
} from "@/lib/types";
import { fetchIdeas, fetchObjectives, saveIdea } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
import { getEvaluationProfile, getObjGroups, getPlanItems, savePlanItems, getUserProfile } from "@/lib/storage";
import { buildEvaluationPrompt } from "@/lib/evaluation-prompt";
import { useLanguage } from "@/components/LanguageProvider";
import RichTextArea from "@/components/RichTextArea";
import { computeWeightedScore } from "@/lib/scoring";
import { PERIOD_LABELS_ZH, PERIOD_LABELS_EN, STATUS_LABELS_ZH, STATUS_LABELS_EN, STATUS_STYLE } from "@/lib/plan-constants";

// ── Guest Trial ───────────────────────────────────────────────────────────────

const GUEST_OBJECTIVES: Objective[] = [
  {
    id: "guest-1", title: "提升職業競爭力與技能", status: "active", createdAt: "",
    keyResults: [
      { id: "gkr-1", title: "完成線上課程或認證" },
      { id: "gkr-2", title: "建立個人作品集或公開專案" },
    ],
  },
  {
    id: "guest-2", title: "改善身心健康", status: "active", createdAt: "",
    keyResults: [
      { id: "gkr-3", title: "每週固定運動 3 次" },
      { id: "gkr-4", title: "維持充足睡眠與飲食習慣" },
    ],
  },
  {
    id: "guest-3", title: "拓展額外收入來源", status: "active", createdAt: "",
    keyResults: [
      { id: "gkr-5", title: "啟動副業或接案項目" },
      { id: "gkr-6", title: "每月副業收入達設定目標" },
    ],
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type IdeaPhase = "idle" | "rephrasing" | "clarifying" | "analyzing" | "result" | "saving";
type PlanPhase = "idle" | "analyzing" | "result";
type ActivePanel = "idea" | "plan" | null;

interface ChatMsg { role: "user" | "assistant"; content: string; }


// ── Component ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { user, requireAuth, openLogin } = useAuth();
  const { t, language } = useLanguage();

  // Guest trial
  const [guestTrialActive, setGuestTrialActive] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("guestTrialActive") === "1"
  );

  // Shared
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [evalProfile, setEvalProfile] = useState<EvaluationProfile>(getEvaluationProfile());
  const [groups, setGroups] = useState<ObjGroup[]>([]);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  // ── Idea Validator state ──
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaNotes, setIdeaNotes] = useState("");
  const [ideaNotesOpen, setIdeaNotesOpen] = useState(false);
  const [ideaPhase, setIdeaPhase] = useState<IdeaPhase>("idle");
  const [ideaAnalysis, setIdeaAnalysis] = useState<IdeaAnalysis | null>(null);
  const [ideaError, setIdeaError] = useState("");
  const [ideaClarifyQ, setIdeaClarifyQ] = useState("");
  const [ideaClarifyA, setIdeaClarifyA] = useState("");
  const [ideaRephraseSuggestion, setIdeaRephraseSuggestion] = useState("");
  const [ideaMessages, setIdeaMessages] = useState<ChatMsg[]>([]);
  const [ideaChatInput, setIdeaChatInput] = useState("");
  const [ideaChatLoading, setIdeaChatLoading] = useState(false);
  const ideaChatRef = useRef<HTMLDivElement>(null);

  // Suggested KR links after analysis
  const [suggestedLinks, setSuggestedLinks] = useState<Array<{
    objectiveId: string; objectiveTitle: string; krId: string; krTitle: string; score: number;
  }>>([]);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());

  // ── Plan Todos state ──
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [activePeriod, setActivePeriod] = useState<PlanPeriod>("today");
  const [newTodoText, setNewTodoText] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [planPhase, setPlanPhase] = useState<PlanPhase>("idle");
  const [planAnalysis, setPlanAnalysis] = useState<PlanAnalysisResult | null>(null);
  const [planScope, setPlanScope] = useState<"all" | "today" | "week" | "month">("all");
  const [planScopeOpen, setPlanScopeOpen] = useState(false);
  const [planMessages, setPlanMessages] = useState<ChatMsg[]>([]);
  const [planChatInput, setPlanChatInput] = useState("");
  const [planChatLoading, setPlanChatLoading] = useState(false);
  const planChatRef = useRef<HTMLDivElement>(null);

  const [userBackground, setUserBackground] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    setEvalProfile(getEvaluationProfile());
    setGroups(getObjGroups());
    setPlanItems(getPlanItems());
    const profile = getUserProfile();
    if (profile?.statement) setUserBackground(profile.statement);
  }, []);

  useEffect(() => {
    if (!user) { setObjectives([]); return; }
    fetchObjectives().then(setObjectives).catch(console.error);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll chat to bottom
  useEffect(() => {
    ideaChatRef.current?.scrollTo({ top: ideaChatRef.current.scrollHeight, behavior: "smooth" });
  }, [ideaMessages]);
  useEffect(() => {
    planChatRef.current?.scrollTo({ top: planChatRef.current.scrollHeight, behavior: "smooth" });
  }, [planMessages]);

  const isQuickIdea = !ideaNotes.trim();
  const activeObjectives = user ? objectives : (guestTrialActive ? GUEST_OBJECTIVES : []);
  const periodLabel = language === "zh-TW" ? PERIOD_LABELS_ZH : PERIOD_LABELS_EN;
  const statusLabel = language === "zh-TW" ? STATUS_LABELS_ZH : STATUS_LABELS_EN;

  // ── Idea Validator handlers ────────────────────────────────────────────────

  async function handleIdeaAnalyze() {
    if (!ideaTitle.trim()) return;

    // Auto-start guest trial instead of prompting login
    let effectiveObjectives = activeObjectives;
    if (!user && !guestTrialActive) {
      localStorage.setItem("guestTrialActive", "1");
      setGuestTrialActive(true);
      effectiveObjectives = GUEST_OBJECTIVES;
    }

    if (effectiveObjectives.length === 0) { setIdeaError(t("error.noObjectives")); return; }
    setIdeaError("");

    // Rephrase short/vague input (< 20 chars)
    if (ideaTitle.trim().length < 20 && isQuickIdea) {
      setIdeaPhase("rephrasing");
      try {
        const { rephrased } = await callAI<{ rephrased: string | null }>(
          "rephraseInput", { ideaTitle: ideaTitle.trim(), userBackground }
        );
        if (rephrased) {
          setIdeaRephraseSuggestion(rephrased);
          return; // wait for user confirmation in UI
        }
      } catch { /* fall through */ }
      setIdeaPhase("idle");
    }

    if (isQuickIdea) {
      setIdeaPhase("clarifying");
      try {
        const { shouldClarify, question } = await callAI<{ shouldClarify: boolean; question: string }>(
          "clarifyIdea", { ideaTitle, objectives: effectiveObjectives }
        );
        if (shouldClarify && question) {
          setIdeaClarifyQ(question);
          setIdeaClarifyA("");
          return;
        }
      } catch { /* fall through */ }
    }
    await runIdeaAnalysis(undefined, undefined, effectiveObjectives);
  }

  async function runIdeaAnalysis(extraNotes?: string, titleOverride?: string, objOverride?: Objective[]) {
    setIdeaPhase("analyzing");
    setIdeaError("");
    try {
      const effectiveTitle = titleOverride ?? ideaTitle;
      const combined = [ideaNotes, extraNotes].filter(Boolean).join("\n");
      const objs = objOverride ?? activeObjectives;
      const result = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle: effectiveTitle,
        ideaNotes: combined,
        objectives: objs,
        evaluationContext: buildEvaluationPrompt(evalProfile, userBackground),
        groups,
      });
      setIdeaAnalysis(result);

      const links: typeof suggestedLinks = [];
      for (const os of result.objectiveScores) {
        for (const krs of os.keyResultScores) {
          if (krs.score >= 5)
            links.push({
              objectiveId: os.objectiveId,
              objectiveTitle: os.objectiveTitle,
              krId: krs.keyResultId,
              krTitle: krs.keyResultTitle,
              score: krs.score,
            });
        }
      }
      links.sort((a, b) => b.score - a.score);
      setSuggestedLinks(links);
      setSelectedLinkIds(new Set(links.filter((l) => l.score >= 7).map((l) => l.krId)));
      setIdeaPhase("result");
      setActivePanel("idea");
      setIdeaMessages([{
        role: "assistant",
        content: language === "zh-TW"
          ? `這個想法的綜合分數是 ${result.finalScore.toFixed(1)}/10。${result.summary} 你有什麼想討論或調整的嗎？`
          : `This idea scored ${result.finalScore.toFixed(1)}/10. ${result.summary} Want to discuss or adjust anything?`,
      }]);
    } catch (e) {
      setIdeaError(e instanceof Error ? e.message : String(e));
      setIdeaPhase("idle");
    }
  }

  async function handleIdeaSave(status: IdeaStatus) {
    if (!ideaAnalysis) return;
    setIdeaPhase("saving");
    const linkedKRs: IdeaKRLink[] = suggestedLinks
      .filter((l) => selectedLinkIds.has(l.krId))
      .map((l) => ({ objectiveId: l.objectiveId, krId: l.krId }));
    const newIdea: Idea = {
      id: uuid(),
      title: ideaTitle,
      description: ideaNotes,
      analysis: ideaAnalysis,
      createdAt: new Date().toISOString(),
      completed: false,
      linkedKRs,
      taskStatus: "todo",
      ideaStatus: status,
      quickAnalysis: isQuickIdea,
    };
    try {
      await saveIdea(newIdea);
      resetIdeaValidator();
    } catch (e) {
      setIdeaError(e instanceof Error ? e.message : String(e));
      setIdeaPhase("result");
    }
  }

  function resetIdeaValidator() {
    setIdeaTitle("");
    setIdeaNotes("");
    setIdeaNotesOpen(false);
    setIdeaPhase("idle");
    setIdeaAnalysis(null);
    setIdeaError("");
    setIdeaClarifyQ("");
    setIdeaClarifyA("");
    setIdeaRephraseSuggestion("");
    setIdeaMessages([]);
    setSuggestedLinks([]);
    setSelectedLinkIds(new Set());
    if (activePanel === "idea") setActivePanel(null);
  }

  async function handleIdeaChat() {
    const text = ideaChatInput.trim();
    if (!text || ideaChatLoading) return;
    setIdeaChatInput("");
    const nextMessages: ChatMsg[] = [...ideaMessages, { role: "user", content: text }];
    setIdeaMessages(nextMessages);
    setIdeaChatLoading(true);
    try {
      const { content } = await callAI<{ content: string }>("chatPlanCoach", {
        messages: nextMessages,
        context: {
          type: "idea",
          ideaTitle,
          ideaScore: ideaAnalysis?.finalScore,
          ideaSummary: ideaAnalysis?.summary,
        },
        objectives,
      });
      setIdeaMessages([...nextMessages, { role: "assistant", content }]);
    } catch (e) {
      setIdeaMessages([...nextMessages, { role: "assistant", content: String(e) }]);
    } finally {
      setIdeaChatLoading(false);
    }
  }

  // ── Plan Todo handlers ─────────────────────────────────────────────────────

  function addTodo() {
    const title = newTodoText.trim();
    if (!title) return;
    const item: PlanItem = {
      id: uuid(),
      title,
      period: activePeriod,
      customLabel: activePeriod === "custom" ? customLabel.trim() || undefined : undefined,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    const next = [item, ...planItems];
    setPlanItems(next);
    savePlanItems(next);
    setNewTodoText("");
  }

  function updateTodoStatus(id: string, status: PlanStatus) {
    const next = planItems.map((i) => (i.id === id ? { ...i, status } : i));
    setPlanItems(next);
    savePlanItems(next);
  }

  function deleteTodo(id: string) {
    const next = planItems.filter((i) => i.id !== id);
    setPlanItems(next);
    savePlanItems(next);
  }

  async function handlePlanAnalyze(scope: "all" | "today" | "week" | "month") {
    if (!user) { requireAuth(); return; }
    if (objectives.length === 0) return;
    setPlanScope(scope);
    setPlanScopeOpen(false);
    setPlanPhase("analyzing");
    setActivePanel("plan");

    const scopeItems = scope === "all"
      ? planItems
      : planItems.filter((i) => i.period === (scope === "today" ? "today" : scope === "week" ? "week" : "month"));

    if (scopeItems.length === 0) {
      setPlanPhase("idle");
      setActivePanel(null);
      return;
    }

    try {
      const result = await callAI<PlanAnalysisResult>("analyzePlanItems", {
        items: scopeItems.map((i) => ({ id: i.id, title: i.title, period: i.period })),
        objectives,
        scope,
        evaluationContext: buildEvaluationPrompt(evalProfile),
        groups,
      });
      setPlanAnalysis(result);
      setPlanPhase("result");
      setPlanMessages([{
        role: "assistant",
        content: language === "zh-TW"
          ? `計畫分析完成。${result.overallAssessment} 有什麼想調整的嗎？`
          : `Plan analysis complete. ${result.overallAssessment} Want to make any adjustments?`,
      }]);

      // Apply scores to items
      const scoreMap = new Map(result.items.map((i) => [i.id, i]));
      const next = planItems.map((item) => {
        const scored = scoreMap.get(item.id);
        if (!scored) return item;
        return {
          ...item,
          analysis: {
            score: scored.score,
            reasoning: scored.reasoning,
            periodNote: scored.periodNote,
            objectiveContributions: [],
          },
        };
      });
      setPlanItems(next);
      savePlanItems(next);
    } catch (e) {
      console.error(e);
      setPlanPhase("idle");
      setActivePanel(null);
    }
  }

  async function handlePlanChat() {
    const text = planChatInput.trim();
    if (!text || planChatLoading) return;
    setPlanChatInput("");
    const scopeItems = planScope === "all"
      ? planItems
      : planItems.filter((i) => i.period === (planScope === "today" ? "today" : planScope === "week" ? "week" : "month"));
    const nextMessages: ChatMsg[] = [...planMessages, { role: "user", content: text }];
    setPlanMessages(nextMessages);
    setPlanChatLoading(true);
    try {
      const { content } = await callAI<{ content: string }>("chatPlanCoach", {
        messages: nextMessages,
        context: {
          type: "plan",
          planItems: scopeItems.map((i) => ({
            title: i.title,
            period: i.period,
            score: i.analysis?.score,
          })),
          overallAssessment: planAnalysis?.overallAssessment,
          suggestions: planAnalysis?.suggestions,
        },
        objectives,
      });
      setPlanMessages([...nextMessages, { role: "assistant", content }]);
    } catch (e) {
      setPlanMessages([...nextMessages, { role: "assistant", content: String(e) }]);
    } finally {
      setPlanChatLoading(false);
    }
  }

  const periodItems = planItems.filter((i) => i.period === activePeriod);

  // Score display helper
  function scoreChip(score: number | undefined) {
    if (score === undefined) return null;
    const color = score >= 7 ? "bg-indigo-50 text-indigo-600" : score >= 4 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-400";
    return (
      <span className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded shrink-0 ${color}`}>
        {score.toFixed(1)}
      </span>
    );
  }

  // ── Right Panel ────────────────────────────────────────────────────────────

  function IdeaPanel() {
    if (!ideaAnalysis) return null;
    const wScore = computeWeightedScore({ analysis: ideaAnalysis }, objectives, evalProfile, groups);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center bg-indigo-50 rounded-xl px-3 py-2 shrink-0">
            <span className="text-2xl font-bold font-mono text-indigo-600">{wScore.toFixed(1)}</span>
            <span className="text-[10px] text-gray-400">{language === "zh-TW" ? "綜合" : "Score"}</span>
          </div>
          <p className="text-sm font-semibold text-gray-800 leading-snug">{ideaTitle}</p>
        </div>

        {ideaAnalysis.summary && (
          <p className="text-xs text-indigo-700 bg-indigo-50 rounded-xl px-3 py-2 leading-relaxed">
            {ideaAnalysis.summary}
          </p>
        )}

        <div className="space-y-2">
          {ideaAnalysis.objectiveScores.map((os) => (
            <div key={os.objectiveId} className="bg-gray-50 rounded-lg px-3 py-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700 truncate">{os.objectiveTitle}</p>
                {os.reasoning && <p className="text-[11px] text-gray-500 mt-0.5">{os.reasoning}</p>}
              </div>
              <span className={`text-xs font-bold font-mono shrink-0 mt-0.5 ${os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-400"}`}>
                {os.overallScore.toFixed(1)}
              </span>
            </div>
          ))}
        </div>

        {ideaAnalysis.risks.length > 0 && (
          <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <span className="font-medium">{language === "zh-TW" ? "風險：" : "Risks: "}</span>
            {ideaAnalysis.risks.join("；")}
          </div>
        )}

        {/* Save actions */}
        {user ? (
          <div className="flex gap-2">
            <button
              onClick={() => handleIdeaSave("shelved")}
              disabled={ideaPhase === "saving"}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              {language === "zh-TW" ? "暫存想法" : "Save to Backlog"}
            </button>
            <button
              onClick={() => handleIdeaSave("active")}
              disabled={ideaPhase === "saving"}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {ideaPhase === "saving"
                ? (language === "zh-TW" ? "儲存中…" : "Saving…")
                : (language === "zh-TW" ? "加入任務清單" : "Add to Tasks")}
            </button>
          </div>
        ) : (
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 space-y-2">
            <p className="text-xs font-semibold text-indigo-800">
              {language === "zh-TW" ? "這是以範例目標為基準的試用分析" : "This is a demo analysis based on sample goals"}
            </p>
            <p className="text-[11px] text-indigo-600 leading-snug">
              {language === "zh-TW"
                ? "建立帳號，輸入你真實的目標，讓 AI 給你個人化的決策分析。"
                : "Sign up to set your real goals and get a personalized analysis."}
            </p>
            <button
              onClick={openLogin}
              className="text-xs text-indigo-700 font-semibold hover:underline"
            >
              {language === "zh-TW" ? "免費註冊，保存你的目標 →" : "Sign up free to save your goals →"}
            </button>
          </div>
        )}

        {/* Discussion */}
        <div className="border-t border-gray-100 pt-3 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {language === "zh-TW" ? "與 AI 討論" : "Discuss"}
          </p>
          <div ref={ideaChatRef} className="max-h-48 overflow-y-auto space-y-2">
            {ideaMessages.map((m, i) => (
              <div key={i} className={`text-xs leading-relaxed px-3 py-2 rounded-xl max-w-[90%] ${m.role === "assistant" ? "bg-indigo-50 text-indigo-800 self-start" : "bg-gray-100 text-gray-700 ml-auto"}`}>
                {m.content}
              </div>
            ))}
            {ideaChatLoading && (
              <div className="text-xs text-indigo-400 animate-pulse px-3">
                {language === "zh-TW" ? "思考中…" : "Thinking…"}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={ideaChatInput}
              onChange={(e) => setIdeaChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleIdeaChat()}
              placeholder={language === "zh-TW" ? "輸入問題或想法…" : "Ask a question…"}
              className="flex-1 text-xs rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <button
              onClick={handleIdeaChat}
              disabled={ideaChatLoading || !ideaChatInput.trim()}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs disabled:opacity-40"
            >
              ↑
            </button>
          </div>
        </div>

        <button onClick={resetIdeaValidator} className="text-xs text-gray-300 hover:text-gray-500 w-full text-center pt-1">
          {language === "zh-TW" ? "清除，分析下一個" : "Clear, analyze next"}
        </button>
      </div>
    );
  }

  function PlanPanel() {
    if (!planAnalysis) return null;
    const scopeItems = planScope === "all"
      ? planItems
      : planItems.filter((i) => i.period === (planScope === "today" ? "today" : planScope === "week" ? "week" : "month"));
    const scoreMap = new Map(planAnalysis.items.map((i) => [i.id, i]));
    return (
      <div className="space-y-4">
        <div className="bg-indigo-50 rounded-xl px-3 py-2.5">
          <p className="text-xs font-semibold text-indigo-700 mb-1">{language === "zh-TW" ? "整體評估" : "Overall Assessment"}</p>
          <p className="text-xs text-indigo-700 leading-relaxed">{planAnalysis.overallAssessment}</p>
        </div>

        <div className="space-y-1.5">
          {scopeItems.map((item) => {
            const scored = scoreMap.get(item.id);
            return (
              <div key={item.id} className="bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-700 flex-1 truncate">{item.title}</p>
                  {scored && scoreChip(scored.score)}
                </div>
                {scored && (
                  <div className="mt-1 space-y-0.5">
                    {scored.reasoning && <p className="text-[11px] text-gray-500">{scored.reasoning}</p>}
                    {scored.periodNote && (
                      <p className="text-[11px] text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 inline-block">
                        {scored.periodNote}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {planAnalysis.suggestions && (
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-xs font-semibold text-gray-600 mb-1">{language === "zh-TW" ? "AI 建議" : "Suggestions"}</p>
            <p className="text-xs text-gray-600 leading-relaxed">{planAnalysis.suggestions}</p>
          </div>
        )}

        {/* Discussion */}
        <div className="border-t border-gray-100 pt-3 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {language === "zh-TW" ? "與 AI 討論" : "Discuss"}
          </p>
          <div ref={planChatRef} className="max-h-48 overflow-y-auto space-y-2">
            {planMessages.map((m, i) => (
              <div key={i} className={`text-xs leading-relaxed px-3 py-2 rounded-xl max-w-[90%] ${m.role === "assistant" ? "bg-indigo-50 text-indigo-800" : "bg-gray-100 text-gray-700 ml-auto"}`}>
                {m.content}
              </div>
            ))}
            {planChatLoading && (
              <div className="text-xs text-indigo-400 animate-pulse px-3">
                {language === "zh-TW" ? "思考中…" : "Thinking…"}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={planChatInput}
              onChange={(e) => setPlanChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handlePlanChat()}
              placeholder={language === "zh-TW" ? "輸入問題或調整建議…" : "Ask or suggest changes…"}
              className="flex-1 text-xs rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <button
              onClick={handlePlanChat}
              disabled={planChatLoading || !planChatInput.trim()}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs disabled:opacity-40"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasRightPanel = activePanel !== null && (
    (activePanel === "idea" && ideaPhase === "result") ||
    (activePanel === "plan" && (planPhase === "result" || planPhase === "analyzing"))
  );

  function renderPanelContent() {
    return (
      <>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            {activePanel === "idea"
              ? (language === "zh-TW" ? "想法分析" : "Idea Analysis")
              : (language === "zh-TW" ? "計畫分析" : "Plan Analysis")}
          </p>
          <button onClick={() => setActivePanel(null)} className="text-gray-300 hover:text-gray-500 text-lg leading-none">×</button>
        </div>
        {activePanel === "idea" && planPhase !== "analyzing" && IdeaPanel()}
        {activePanel === "plan" && planPhase === "analyzing" && (
          <div className="text-center py-10">
            <div className="text-3xl mb-3 animate-pulse text-indigo-400">◎</div>
            <p className="text-xs text-gray-400">
              {language === "zh-TW" ? "AI 分析計畫中…" : "Analyzing your plan…"}
            </p>
          </div>
        )}
        {activePanel === "plan" && planPhase === "result" && PlanPanel()}
      </>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-8">

      {/* ── Guest Hero ──────────────────────────────────────────────── */}
      {!user && !guestTrialActive && (
        <div className="step-enter mb-8 rounded-2xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 p-6 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-indigo-500 uppercase tracking-widest">記錄指針</p>
            <h1 className="text-2xl font-bold text-gray-900 leading-snug">
              {language === "zh-TW"
                ? "把想法丟進來，我幫你判斷值不值得做"
                : "Drop in an idea — I'll tell you if it's worth doing"}
            </h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              {language === "zh-TW"
                ? "連結你的目標，AI 秒算每個想法的貢獻度，30 秒做出更好的決策。"
                : "Link your goals, AI scores each idea's impact in 30 seconds."}
            </p>
          </div>
          {/* Idea input embedded in hero */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={ideaTitle}
                onChange={(e) => setIdeaTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleIdeaAnalyze()}
                placeholder={language === "zh-TW" ? "例如：開始寫技術部落格、學習 AI 工具…" : "e.g. Start a technical blog, learn AI tools…"}
                className="flex-1 rounded-xl border border-indigo-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                autoFocus
              />
              <button
                onClick={handleIdeaAnalyze}
                disabled={!ideaTitle.trim()}
                className="px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 shrink-0 transition-colors"
              >
                {language === "zh-TW" ? "分析 →" : "Analyze →"}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              {language === "zh-TW" ? "無需帳號即可試用。" : "No account needed. "}
              <button onClick={openLogin} className="text-indigo-500 hover:underline">
                {language === "zh-TW" ? "登入 / 註冊" : "Sign in / Sign up"}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* ── Page Header ─────────────────────────────────────────────── */}
      {(user || guestTrialActive) && (
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">
            {language === "zh-TW" ? "驗證你的想法" : "Validate Your Ideas"}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {language === "zh-TW"
              ? "輸入想法，AI 算出它對你目標的貢獻值"
              : "Enter an idea, AI scores its impact on your goals"}
          </p>
        </div>
      )}

      <div className={`flex gap-6 ${hasRightPanel ? "items-start" : ""}`}>

        {/* ── Left Column ────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-8">

          {/* ── Section 1: Idea Validator ── */}
          <section className="space-y-3">
            {(user || guestTrialActive) && (
              <div>
                <h2 className="text-base font-semibold text-gray-800">
                  {language === "zh-TW" ? "想法驗證" : "Idea Validator"}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {language === "zh-TW"
                    ? "一句話描述你的想法，AI 告訴你它值不值得做"
                    : "Describe your idea in one line — AI tells you if it's worth doing"}
                </p>
              </div>
            )}

            {ideaPhase === "rephrasing" && !ideaRephraseSuggestion && (
              <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
                <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                {language === "zh-TW" ? "AI 理解中…" : "AI is interpreting…"}
              </div>
            )}

            {ideaPhase === "rephrasing" && ideaRephraseSuggestion && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 space-y-2.5">
                <p className="text-xs font-semibold text-indigo-600">
                  {language === "zh-TW" ? "你的意思是：" : "Did you mean:"}
                </p>
                <input
                  value={ideaRephraseSuggestion}
                  onChange={(e) => setIdeaRephraseSuggestion(e.target.value)}
                  className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { const t = ideaRephraseSuggestion; setIdeaTitle(t); setIdeaRephraseSuggestion(""); runIdeaAnalysis(undefined, t); }}
                    className="flex-1 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
                  >
                    {language === "zh-TW" ? "對，用這個分析 →" : "Yes, analyze this →"}
                  </button>
                  <button
                    onClick={() => { setIdeaRephraseSuggestion(""); setIdeaPhase("idle"); }}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50"
                  >
                    {language === "zh-TW" ? "用原本的" : "Use original"}
                  </button>
                </div>
              </div>
            )}

            {(ideaPhase === "idle" || ideaPhase === "clarifying") && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    value={ideaTitle}
                    onChange={(e) => setIdeaTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && ideaPhase === "idle" && handleIdeaAnalyze()}
                    placeholder={language === "zh-TW" ? "用一句話描述這個想法…" : "Describe your idea in one line…"}
                    disabled={ideaPhase === "clarifying" && !!ideaClarifyQ}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
                    autoFocus
                  />
                  <button
                    onClick={ideaPhase === "idle" ? handleIdeaAnalyze : undefined}
                    disabled={!ideaTitle.trim() || ideaPhase !== "idle"}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 shrink-0"
                  >
                    {language === "zh-TW" ? "分析" : "Analyze"}
                  </button>
                </div>

                {ideaPhase === "idle" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setIdeaNotesOpen((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
                    >
                      <span className={`transition-transform ${ideaNotesOpen ? "rotate-90" : ""}`}>›</span>
                      {language === "zh-TW" ? "補充說明（選填）" : "Add notes (optional)"}
                      {ideaNotes.trim() && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
                    </button>
                    {ideaNotesOpen && (
                      <div className="pl-3 border-l-2 border-gray-100">
                        <RichTextArea
                          value={ideaNotes}
                          onChange={setIdeaNotes}
                          placeholder={language === "zh-TW" ? "備註，幫助 AI 更準確判斷" : "Notes to help AI score more accurately"}
                          rows={2}
                        />
                      </div>
                    )}
                  </>
                )}

                {ideaPhase === "clarifying" && ideaClarifyQ && (
                  <div className="bg-indigo-50 rounded-xl px-4 py-3 space-y-2">
                    <p className="text-sm text-indigo-800 font-medium">{ideaClarifyQ}</p>
                    <div className="flex gap-2">
                      <input
                        value={ideaClarifyA}
                        onChange={(e) => setIdeaClarifyA(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && runIdeaAnalysis(ideaClarifyA.trim() || undefined)}
                        placeholder={language === "zh-TW" ? "你的回答…" : "Your answer…"}
                        autoFocus
                        className="flex-1 rounded-lg border border-indigo-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                      <button
                        onClick={() => runIdeaAnalysis()}
                        className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 shrink-0"
                      >
                        {language === "zh-TW" ? "跳過" : "Skip"}
                      </button>
                      <button
                        onClick={() => runIdeaAnalysis(ideaClarifyA.trim() || undefined)}
                        disabled={!ideaClarifyA.trim()}
                        className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 shrink-0"
                      >
                        {language === "zh-TW" ? "繼續" : "Continue"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {ideaPhase === "analyzing" && (
              <div className="flex items-center gap-2 py-3 text-sm text-indigo-600">
                <span className="animate-pulse text-lg">◎</span>
                {language === "zh-TW" ? "AI 分析中…" : "Analyzing…"}
              </div>
            )}

            {ideaPhase === "result" && (
              <div className="flex items-center gap-3 bg-white rounded-xl border border-indigo-100 px-4 py-3">
                <div className="flex flex-col items-center bg-indigo-50 rounded-lg px-2.5 py-1.5 shrink-0">
                  <span className="text-lg font-bold font-mono text-indigo-600">
                    {computeWeightedScore({ analysis: ideaAnalysis }, objectives, evalProfile, groups).toFixed(1)}
                  </span>
                  <span className="text-[10px] text-gray-400">{language === "zh-TW" ? "分" : "pts"}</span>
                </div>
                <p className="text-sm font-medium text-gray-800 flex-1 truncate">{ideaTitle}</p>
                <span className="text-xs text-indigo-500 shrink-0">
                  {language === "zh-TW" ? "→ 查看右側分析" : "→ See analysis →"}
                </span>
              </div>
            )}

            {ideaPhase === "saving" && (
              <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
                <span className="animate-pulse">◎</span>
                {language === "zh-TW" ? "儲存中…" : "Saving…"}
              </div>
            )}

            {ideaError && (
              <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{ideaError}</p>
            )}
          </section>

          <div className="border-t border-gray-100" />

          {/* ── Section 2: Todo Planner ── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">
                  {language === "zh-TW" ? "待辦規劃" : "Todo Planner"}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {language === "zh-TW"
                    ? "按時間段規劃任務，AI 協助評估優先序"
                    : "Plan tasks by time period, AI evaluates priorities"}
                </p>
              </div>

              {/* AI Analyze button */}
              <div className="relative">
                <button
                  onClick={() => setPlanScopeOpen((v) => !v)}
                  disabled={planPhase === "analyzing" || planItems.length === 0}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  {planPhase === "analyzing"
                    ? <span className="animate-pulse">◎</span>
                    : null}
                  {language === "zh-TW" ? "AI 分析" : "AI Analyze"}
                  <span className="text-indigo-300">▾</span>
                </button>
                {planScopeOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-10 min-w-[120px]">
                    {(["all", "today", "week", "month"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => handlePlanAnalyze(s)}
                        className="w-full text-left text-xs px-4 py-2 hover:bg-indigo-50 text-gray-700"
                      >
                        {language === "zh-TW"
                          ? s === "all" ? "全部分析" : `只分析${PERIOD_LABELS_ZH[s as PlanPeriod]}`
                          : s === "all" ? "Analyze All" : `Only ${PERIOD_LABELS_EN[s as PlanPeriod]}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Period Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {(["today", "week", "month", "custom"] as PlanPeriod[]).map((p) => {
                const count = planItems.filter((i) => i.period === p).length;
                return (
                  <button
                    key={p}
                    onClick={() => setActivePeriod(p)}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activePeriod === p ? "bg-white text-gray-800 shadow-sm" : "text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {periodLabel[p]}
                    {count > 0 && (
                      <span className={`text-[10px] px-1 py-0.5 rounded-full ${activePeriod === p ? "bg-gray-100 text-gray-500" : "bg-gray-200 text-gray-400"}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Custom label input */}
            {activePeriod === "custom" && (
              <input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder={language === "zh-TW" ? "自訂時間標籤（如：下週四、6月前）" : "Custom label (e.g., Next Thursday)"}
                className="w-full text-xs rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            )}

            {/* New todo input */}
            <div className="flex gap-2">
              <input
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && addTodo()}
                placeholder={language === "zh-TW"
                  ? `新增${periodLabel[activePeriod]}任務…`
                  : `Add ${periodLabel[activePeriod]} task…`}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                onClick={addTodo}
                disabled={!newTodoText.trim()}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                +
              </button>
            </div>

            {/* Todo list */}
            {periodItems.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm text-gray-400">
                  {language === "zh-TW"
                    ? `${periodLabel[activePeriod]}還沒有任務，輸入上方新增`
                    : `No ${periodLabel[activePeriod]} tasks yet`}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {periodItems.map((item) => (
                  <div
                    key={item.id}
                    className={`bg-white rounded-xl border px-4 py-3 flex items-center gap-3 ${
                      item.status === "completed"
                        ? "border-gray-100 opacity-60"
                        : item.status === "shelved"
                        ? "border-orange-100 bg-orange-50/30"
                        : "border-gray-200"
                    }`}
                  >
                    <p className={`flex-1 text-sm min-w-0 truncate ${item.status === "completed" ? "line-through text-gray-400" : "text-gray-800"}`}>
                      {item.title}
                    </p>
                    {item.analysis && scoreChip(item.analysis.score)}
                    <select
                      value={item.status}
                      onChange={(e) => updateTodoStatus(item.id, e.target.value as PlanStatus)}
                      className={`text-xs px-2 py-0.5 rounded-lg font-medium border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-300 shrink-0 ${STATUS_STYLE[item.status]}`}
                    >
                      {(["active", "in-progress", "shelved", "completed"] as PlanStatus[]).map((s) => (
                        <option key={s} value={s}>{statusLabel[s]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => deleteTodo(item.id)}
                      className="text-gray-200 hover:text-red-400 text-sm shrink-0 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Right Panel (desktop sticky) ───────────────────────────── */}
        {hasRightPanel && (
          <div className="hidden md:block w-[360px] shrink-0 sticky top-6 self-start max-h-[calc(100vh-5rem)] overflow-y-auto">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              {renderPanelContent()}
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile: Right Panel below ───────────────────────────────── */}
      {hasRightPanel && (
        <div className="md:hidden mt-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            {renderPanelContent()}
          </div>
        </div>
      )}
    </div>
  );
}
