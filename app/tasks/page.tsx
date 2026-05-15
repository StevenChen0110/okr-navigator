"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import {
  Idea, Objective, IdeaAnalysis, IdeaKRLink, IdeaStatus,
  EvaluationProfile, ObjGroup, PlanItem, PlanPeriod, PlanStatus, PlanAnalysisResult,
  StoredMessage, WeeklyLog, LogItem,
} from "@/lib/types";
import { fetchObjectives, saveIdea, fetchWeeklyLog, saveWeeklyLog, fetchLogItems, saveLogItems, saveReport } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
import { getEvaluationProfile, getObjGroups, getPlanItems, savePlanItems, getSettings, getObjectives } from "@/lib/storage";
import { buildEvaluationPrompt } from "@/lib/evaluation-prompt";
import { useLanguage } from "@/components/LanguageProvider";
import { computeWeightedScore } from "@/lib/scoring";
import { PERIOD_LABELS_ZH, PERIOD_LABELS_EN, STATUS_LABELS_ZH, STATUS_LABELS_EN, STATUS_STYLE } from "@/lib/plan-constants";

type IdeaPhase = "idle" | "clarifying" | "analyzing" | "result" | "saving";
type PlanPhase = "idle" | "analyzing" | "result";

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart);
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function TasksPage() {
  const { user, requireAuth } = useAuth();
  const { t, language } = useLanguage();
  const router = useRouter();

  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [evalProfile] = useState<EvaluationProfile>(getEvaluationProfile());
  const [groups, setGroups] = useState<ObjGroup[]>([]);

  // Weekly log state
  const [weekLog, setWeekLog] = useState<WeeklyLog | null>(null);
  const [logInput, setLogInput] = useState("");
  const [logItems, setLogItems] = useState<LogItem[]>([]);
  const [logPhase, setLogPhase] = useState<"idle" | "classifying" | "classified">("idle");
  const [isGenerating, setIsGenerating] = useState(false);
  const [logError, setLogError] = useState("");

  // Idea validator state
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaNotes, setIdeaNotes] = useState("");
  const [ideaNotesOpen, setIdeaNotesOpen] = useState(false);
  const [ideaPhase, setIdeaPhase] = useState<IdeaPhase>("idle");
  const [ideaAnalysis, setIdeaAnalysis] = useState<IdeaAnalysis | null>(null);
  const [ideaError, setIdeaError] = useState("");
  const [ideaClarifyQ, setIdeaClarifyQ] = useState("");
  const [ideaClarifyA, setIdeaClarifyA] = useState("");
  const [ideaMessages, setIdeaMessages] = useState<StoredMessage[]>([]);
  const [ideaChatInput, setIdeaChatInput] = useState("");
  const [ideaChatLoading, setIdeaChatLoading] = useState(false);
  const [suggestedLinks, setSuggestedLinks] = useState<Array<{
    objectiveId: string; objectiveTitle: string; krId: string; krTitle: string; score: number;
  }>>([]);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());
  const ideaChatRef = useRef<HTMLDivElement>(null);

  // Plan todos state
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [activePeriod, setActivePeriod] = useState<PlanPeriod>("today");
  const [newTodoText, setNewTodoText] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [planPhase, setPlanPhase] = useState<PlanPhase>("idle");
  const [planAnalysis, setPlanAnalysis] = useState<PlanAnalysisResult | null>(null);
  const [planScope, setPlanScope] = useState<"all" | PlanPeriod>("all");
  const [planScopeOpen, setPlanScopeOpen] = useState(false);
  const [planMessages, setPlanMessages] = useState<StoredMessage[]>([]);
  const [planChatInput, setPlanChatInput] = useState("");
  const [planChatLoading, setPlanChatLoading] = useState(false);
  const planChatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGroups(getObjGroups());
    setPlanItems(getPlanItems());
  }, []);

  useEffect(() => {
    if (!user) { setObjectives([]); return; }
    fetchObjectives().then(setObjectives).catch(console.error);

    // Check onboarding
    const settings = getSettings();
    const localObjs = getObjectives();
    if (!settings.onboardingCompleted && localObjs.length === 0) {
      router.push("/onboarding");
    }

    // Load this week's log
    const ws = getWeekStart();
    fetchWeeklyLog(ws).then(async (log) => {
      if (!log) return;
      setWeekLog(log);
      setLogInput(log.rawInput);
      const items = await fetchLogItems(log.id);
      if (items.length) { setLogItems(items); setLogPhase("classified"); }
    }).catch(console.error);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleClassifyLog() {
    if (!logInput.trim()) return;
    if (!user) { requireAuth(); return; }
    setLogError("");
    setLogPhase("classifying");
    try {
      const ws = getWeekStart();
      const logId = weekLog?.id ?? uuid();
      const log: WeeklyLog = { id: logId, weekStart: ws, rawInput: logInput, createdAt: new Date().toISOString() };
      await saveWeeklyLog(log);
      setWeekLog(log);

      const raw = await callAI<Array<{ content: string; krId: string | null; krTitle: string | null; isPlanned: boolean }>>(
        "classifyLogItems", { rawInput: logInput, objectives }
      );
      const items: LogItem[] = raw.map((r) => ({
        id: uuid(), logId, content: r.content, krId: r.krId, krTitle: r.krTitle,
        isPlanned: r.isPlanned, createdAt: new Date().toISOString(),
      }));
      await saveLogItems(items);
      setLogItems(items);
      setLogPhase("classified");
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e));
      setLogPhase("idle");
    }
  }

  async function handleGenerateReport() {
    if (!weekLog || !logItems.length) return;
    if (!user) { requireAuth(); return; }
    setIsGenerating(true);
    setLogError("");
    try {
      const result = await callAI<{ alignmentScore: number; aiInsight: string; suggestions: string[] }>(
        "generateAlignmentReport", { objectives, logItems }
      );
      const report = {
        id: uuid(), weekStart: weekLog.weekStart,
        alignmentScore: result.alignmentScore, aiInsight: result.aiInsight,
        suggestions: result.suggestions, logId: weekLog.id, createdAt: new Date().toISOString(),
      };
      await saveReport(report);
      router.push(`/report/${weekLog.weekStart}`);
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e));
      setIsGenerating(false);
    }
  }

  useEffect(() => {
    ideaChatRef.current?.scrollTo({ top: ideaChatRef.current.scrollHeight, behavior: "smooth" });
  }, [ideaMessages]);
  useEffect(() => {
    planChatRef.current?.scrollTo({ top: planChatRef.current.scrollHeight, behavior: "smooth" });
  }, [planMessages]);

  const isQuickIdea = !ideaNotes.trim();
  const periodLabel = language === "zh-TW" ? PERIOD_LABELS_ZH : PERIOD_LABELS_EN;
  const statusLabel = language === "zh-TW" ? STATUS_LABELS_ZH : STATUS_LABELS_EN;

  function getScopeItems(scope: "all" | PlanPeriod) {
    return scope === "all" ? planItems : planItems.filter((i) => i.period === scope);
  }

  // ── Idea handlers ─────────────────────────────────────────────────────────

  async function handleIdeaAnalyze() {
    if (!ideaTitle.trim()) return;
    if (!user) { requireAuth(); return; }
    if (objectives.length === 0) { setIdeaError(t("error.noObjectives")); return; }
    setIdeaError("");
    if (isQuickIdea) {
      setIdeaPhase("clarifying");
      try {
        const { shouldClarify, question } = await callAI<{ shouldClarify: boolean; question: string }>(
          "clarifyIdea", { ideaTitle, objectives }
        );
        if (shouldClarify && question) { setIdeaClarifyQ(question); setIdeaClarifyA(""); return; }
      } catch { /* fall through */ }
    }
    await runIdeaAnalysis();
  }

  async function runIdeaAnalysis(extraNotes?: string) {
    setIdeaPhase("analyzing");
    setIdeaError("");
    try {
      const combined = [ideaNotes, extraNotes].filter(Boolean).join("\n");
      const result = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle, ideaNotes: combined, objectives,
        evaluationContext: buildEvaluationPrompt(evalProfile), groups,
      });
      setIdeaAnalysis(result);
      const links: typeof suggestedLinks = [];
      for (const os of result.objectiveScores)
        for (const krs of os.keyResultScores)
          if (krs.score >= 5) links.push({ objectiveId: os.objectiveId, objectiveTitle: os.objectiveTitle, krId: krs.keyResultId, krTitle: krs.keyResultTitle, score: krs.score });
      links.sort((a, b) => b.score - a.score);
      setSuggestedLinks(links);
      setSelectedLinkIds(new Set(links.filter((l) => l.score >= 7).map((l) => l.krId)));
      setIdeaPhase("result");
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
      id: uuid(), title: ideaTitle, description: ideaNotes, analysis: ideaAnalysis,
      createdAt: new Date().toISOString(), completed: false, linkedKRs,
      taskStatus: "todo", ideaStatus: status, quickAnalysis: isQuickIdea,
    };
    try { await saveIdea(newIdea); resetIdeaValidator(); }
    catch (e) { setIdeaError(e instanceof Error ? e.message : String(e)); setIdeaPhase("result"); }
  }

  function resetIdeaValidator() {
    setIdeaTitle(""); setIdeaNotes(""); setIdeaNotesOpen(false);
    setIdeaPhase("idle"); setIdeaAnalysis(null); setIdeaError("");
    setIdeaClarifyQ(""); setIdeaClarifyA(""); setIdeaMessages([]);
    setSuggestedLinks([]); setSelectedLinkIds(new Set());
  }

  async function handleIdeaChat() {
    const text = ideaChatInput.trim();
    if (!text || ideaChatLoading) return;
    setIdeaChatInput("");
    const nextMessages: StoredMessage[] = [...ideaMessages, { role: "user", content: text }];
    setIdeaMessages(nextMessages);
    setIdeaChatLoading(true);
    try {
      const { content } = await callAI<{ content: string }>("chatPlanCoach", {
        messages: nextMessages,
        context: { type: "idea", ideaTitle, ideaScore: ideaAnalysis?.finalScore, ideaSummary: ideaAnalysis?.summary },
        objectives,
      });
      setIdeaMessages([...nextMessages, { role: "assistant", content }]);
    } catch (e) {
      setIdeaMessages([...nextMessages, { role: "assistant", content: String(e) }]);
    } finally { setIdeaChatLoading(false); }
  }

  // ── Plan handlers ──────────────────────────────────────────────────────────

  function addTodo() {
    const title = newTodoText.trim();
    if (!title) return;
    const item: PlanItem = {
      id: uuid(), title, period: activePeriod,
      customLabel: activePeriod === "custom" ? customLabel.trim() || undefined : undefined,
      status: "active", createdAt: new Date().toISOString(),
    };
    const next = [item, ...planItems];
    setPlanItems(next); savePlanItems(next); setNewTodoText("");
  }

  function updateTodoStatus(id: string, status: PlanStatus) {
    const next = planItems.map((i) => (i.id === id ? { ...i, status } : i));
    setPlanItems(next); savePlanItems(next);
  }

  function deleteTodo(id: string) {
    const next = planItems.filter((i) => i.id !== id);
    setPlanItems(next); savePlanItems(next);
  }

  async function handlePlanAnalyze(scope: "all" | PlanPeriod) {
    if (!user) { requireAuth(); return; }
    if (objectives.length === 0) return;
    setPlanScope(scope); setPlanScopeOpen(false); setPlanPhase("analyzing");

    const scopeItems = getScopeItems(scope);
    if (scopeItems.length === 0) { setPlanPhase("idle"); return; }

    try {
      const result = await callAI<PlanAnalysisResult>("analyzePlanItems", {
        items: scopeItems.map((i) => ({ id: i.id, title: i.title, period: i.period })),
        objectives, scope,
        evaluationContext: buildEvaluationPrompt(evalProfile),
        groups,
      });
      setPlanAnalysis(result); setPlanPhase("result");
      setPlanMessages([{
        role: "assistant",
        content: `${result.overallAssessment} ${result.suggestions || ""}`,
      }]);
    } catch {
      setPlanPhase("idle");
    }
  }

  async function handlePlanChat() {
    const text = planChatInput.trim();
    if (!text || planChatLoading) return;
    setPlanChatInput("");
    const scopeItems = getScopeItems(planScope);
    const nextMessages: StoredMessage[] = [...planMessages, { role: "user", content: text }];
    setPlanMessages(nextMessages); setPlanChatLoading(true);
    try {
      const { content } = await callAI<{ content: string }>("chatPlanCoach", {
        messages: nextMessages,
        context: {
          type: "plan",
          planItems: scopeItems.map((i) => ({ title: i.title, period: i.period, score: i.analysis?.score })),
          overallAssessment: planAnalysis?.overallAssessment, suggestions: planAnalysis?.suggestions,
        },
        objectives,
      });
      setPlanMessages([...nextMessages, { role: "assistant", content }]);
    } catch (e) {
      setPlanMessages([...nextMessages, { role: "assistant", content: String(e) }]);
    } finally { setPlanChatLoading(false); }
  }

  const periodItems = planItems.filter((i) => i.period === activePeriod);

  function scoreChip(score: number | undefined) {
    if (score === undefined) return null;
    const color = score >= 7 ? "bg-indigo-50 text-indigo-600" : score >= 4 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-400";
    return <span className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded shrink-0 ${color}`}>{score.toFixed(1)}</span>;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-8">

      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {language === "zh-TW" ? "記錄" : "Log"}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {language === "zh-TW"
            ? "記錄這週做了什麼，產出方向對齊報告"
            : "Log what you did this week and generate your alignment report"}
        </p>
      </div>

      {/* ── Section 0: Weekly Log ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">
              {language === "zh-TW" ? "本週記錄" : "Weekly Log"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatWeekRange(getWeekStart())}
            </p>
          </div>
          {logPhase === "classified" && logItems.length > 0 && (
            <span className="text-xs text-indigo-500 font-medium">
              {logItems.filter((i) => i.isPlanned).length}/{logItems.length} {language === "zh-TW" ? "對應目標" : "on-goal"}
            </span>
          )}
        </div>

        {(logPhase === "idle" || logPhase === "classifying") && (
          <div className="space-y-2">
            <textarea
              value={logInput}
              onChange={(e) => setLogInput(e.target.value)}
              placeholder={language === "zh-TW"
                ? "這週你做了什麼？自由輸入，不需要格式…\n例如：完成了設計稿、開了兩個客戶會議、跑步三次…"
                : "What did you do this week? Free-form, no format needed…"}
              rows={5}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
            <button
              onClick={handleClassifyLog}
              disabled={!logInput.trim() || logPhase === "classifying"}
              className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {logPhase === "classifying"
                ? (language === "zh-TW" ? "AI 整理中…" : "AI organizing…")
                : (language === "zh-TW" ? "AI 整理 →" : "Organize with AI →")}
            </button>
          </div>
        )}

        {logPhase === "classified" && logItems.length > 0 && (
          <div className="space-y-2">
            <div className="rounded-lg border border-gray-100 divide-y divide-gray-50">
              {logItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2 px-3 py-2">
                  <span className={`mt-0.5 text-sm ${item.isPlanned ? "text-indigo-500" : "text-gray-300"}`}>
                    {item.isPlanned ? "✓" : "○"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">{item.content}</p>
                    {item.krTitle && (
                      <p className="text-xs text-indigo-400 mt-0.5 truncate">→ {item.krTitle}</p>
                    )}
                    {!item.isPlanned && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {language === "zh-TW" ? "計劃外" : "Off-goal"}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setLogPhase("idle"); }}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                {language === "zh-TW" ? "重新輸入" : "Re-enter"}
              </button>
              <button
                onClick={handleGenerateReport}
                disabled={isGenerating}
                className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {isGenerating
                  ? (language === "zh-TW" ? "生成中…" : "Generating…")
                  : (language === "zh-TW" ? "產出本週報告 →" : "Generate Report →")}
              </button>
            </div>
          </div>
        )}

        {logError && <p className="text-xs text-red-500">{logError}</p>}
      </section>

      {/* ── Section 1: Idea Validator ─────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">
            {language === "zh-TW" ? "想法驗證" : "Idea Validator"}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {language === "zh-TW"
              ? "輸入一個想法，看它對你的目標幫助有多大"
              : "Enter an idea and see how much it helps your goals"}
          </p>
        </div>

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
              />
              <button
                onClick={ideaPhase === "idle" ? handleIdeaAnalyze : undefined}
                disabled={!ideaTitle.trim() || ideaPhase === "clarifying"}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {language === "zh-TW" ? "分析" : "Analyze"}
              </button>
            </div>

            <button
              onClick={() => setIdeaNotesOpen((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              › {language === "zh-TW" ? "補充說明（選填）" : "Add notes (optional)"}
            </button>
            {ideaNotesOpen && (
              <textarea
                value={ideaNotes}
                onChange={(e) => setIdeaNotes(e.target.value)}
                rows={2}
                placeholder={language === "zh-TW" ? "補充背景、目的或限制…" : "Add context, purpose, or constraints…"}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              />
            )}

            {ideaPhase === "clarifying" && ideaClarifyQ && (
              <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-3 space-y-2">
                <p className="text-xs text-indigo-700 font-medium">{ideaClarifyQ}</p>
                <div className="flex gap-2">
                  <input
                    value={ideaClarifyA}
                    onChange={(e) => setIdeaClarifyA(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && runIdeaAnalysis(ideaClarifyA)}
                    placeholder={language === "zh-TW" ? "輸入你的回答…" : "Your answer…"}
                    className="flex-1 text-sm rounded-lg border border-indigo-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button
                    onClick={() => runIdeaAnalysis(ideaClarifyA)}
                    disabled={!ideaClarifyA.trim()}
                    className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {language === "zh-TW" ? "繼續" : "Continue"}
                  </button>
                  <button
                    onClick={() => runIdeaAnalysis()}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    {language === "zh-TW" ? "跳過" : "Skip"}
                  </button>
                </div>
              </div>
            )}

            {ideaError && <p className="text-xs text-red-500">{ideaError}</p>}
          </div>
        )}

        {ideaPhase === "analyzing" && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-6 flex items-center justify-center">
            <span className="text-xs text-gray-400 animate-pulse">
              {language === "zh-TW" ? "AI 分析中…" : "Analyzing…"}
            </span>
          </div>
        )}

        {(ideaPhase === "result" || ideaPhase === "saving") && ideaAnalysis && (() => {
          const wScore = computeWeightedScore({ analysis: ideaAnalysis }, objectives, evalProfile, groups);
          return (
            <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center bg-indigo-50 rounded-xl px-3 py-2 shrink-0">
                  <span className="text-xl font-bold font-mono text-indigo-600">{wScore.toFixed(1)}</span>
                  <span className="text-[10px] text-gray-400">{language === "zh-TW" ? "綜合" : "Score"}</span>
                </div>
                <p className="text-sm font-medium text-gray-800 leading-snug">{ideaTitle}</p>
              </div>

              {ideaAnalysis.summary && (
                <p className="text-xs text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2 leading-relaxed">
                  {ideaAnalysis.summary}
                </p>
              )}

              <div className="space-y-1.5">
                {ideaAnalysis.objectiveScores.map((os) => (
                  <div key={os.objectiveId} className="bg-white rounded-lg border border-gray-100 px-3 py-2 flex items-start gap-2">
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
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <span className="font-medium">{language === "zh-TW" ? "風險：" : "Risks: "}</span>
                  {ideaAnalysis.risks.join("；")}
                </p>
              )}

              {suggestedLinks.length > 0 && (
                <div className="border border-gray-100 rounded-lg px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    {language === "zh-TW" ? "連結至目標" : "Link to goals"}
                  </p>
                  {suggestedLinks.map((l) => (
                    <label key={l.krId} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={selectedLinkIds.has(l.krId)} onChange={() => {
                        const n = new Set(selectedLinkIds);
                        n.has(l.krId) ? n.delete(l.krId) : n.add(l.krId);
                        setSelectedLinkIds(n);
                      }} className="accent-indigo-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 truncate">{l.krTitle}</p>
                        <p className="text-[10px] text-gray-400 truncate">{l.objectiveTitle}</p>
                      </div>
                      <span className={`text-xs font-semibold shrink-0 ${l.score >= 7 ? "text-indigo-600" : "text-amber-500"}`}>{l.score.toFixed(1)}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => handleIdeaSave("shelved")} disabled={ideaPhase === "saving"}
                  className="flex-1 py-2 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                  {language === "zh-TW" ? "暫存想法" : "Save to Backlog"}
                </button>
                <button onClick={() => handleIdeaSave("active")} disabled={ideaPhase === "saving"}
                  className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {ideaPhase === "saving"
                    ? (language === "zh-TW" ? "儲存中…" : "Saving…")
                    : (language === "zh-TW" ? "加入任務清單" : "Add to Tasks")}
                </button>
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  {language === "zh-TW" ? "與 AI 討論" : "Discuss with AI"}
                </p>
                <div ref={ideaChatRef} className="max-h-40 overflow-y-auto space-y-1.5">
                  {ideaMessages.map((m, i) => (
                    <div key={i} className={`text-xs leading-relaxed px-3 py-2 rounded-xl ${m.role === "assistant" ? "bg-indigo-50 text-indigo-800" : "bg-gray-100 text-gray-700 ml-auto max-w-[85%]"}`}>
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
                  <input value={ideaChatInput} onChange={(e) => setIdeaChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleIdeaChat()}
                    placeholder={language === "zh-TW" ? "輸入問題或想法…" : "Ask a question…"}
                    className="flex-1 text-xs rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                  <button onClick={handleIdeaChat} disabled={ideaChatLoading || !ideaChatInput.trim()}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs disabled:opacity-40">↑</button>
                </div>
              </div>

              <button onClick={resetIdeaValidator} className="text-xs text-gray-300 hover:text-gray-500 w-full text-center">
                {language === "zh-TW" ? "清除，分析下一個" : "Clear and analyze next"}
              </button>
            </div>
          );
        })()}
      </section>

      <div className="border-t border-gray-100" />

      {/* ── Section 2: Todo Planner ───────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">
              {language === "zh-TW" ? "待辦規劃" : "Todo Planner"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {language === "zh-TW"
                ? "按時間段規劃任務，AI 協助評估優先序"
                : "Plan by timeframe, AI helps evaluate priority"}
            </p>
          </div>

          <div className="relative shrink-0">
            <button
              onClick={() => setPlanScopeOpen((v) => !v)}
              disabled={planItems.length === 0 || objectives.length === 0 || planPhase === "analyzing"}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors font-medium"
            >
              {planPhase === "analyzing"
                ? (language === "zh-TW" ? "分析中…" : "Analyzing…")
                : (language === "zh-TW" ? "AI 分析" : "AI Analyze")}
              {planPhase !== "analyzing" && <span className="opacity-70">▾</span>}
            </button>
            {planScopeOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 z-20 w-28 py-1">
                {([
                  { key: "all", zh: "全部", en: "All" },
                  { key: "today", zh: "今日", en: "Today" },
                  { key: "week", zh: "本週", en: "Week" },
                  { key: "month", zh: "本月", en: "Month" },
                ] as const).map((opt) => (
                  <button key={opt.key} onClick={() => handlePlanAnalyze(opt.key)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-700">
                    {language === "zh-TW" ? opt.zh : opt.en}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex rounded-xl bg-gray-100 p-0.5 gap-0.5">
          {(["today", "week", "month", "custom"] as PlanPeriod[]).map((p) => (
            <button key={p} onClick={() => setActivePeriod(p)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${activePeriod === p ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {periodLabel[p]}
            </button>
          ))}
        </div>

        {activePeriod === "custom" && (
          <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)}
            placeholder={language === "zh-TW" ? "自訂時間標籤…" : "Custom label…"}
            className="w-full text-xs rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
        )}

        <div className="flex gap-2">
          <input
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && addTodo()}
            placeholder={language === "zh-TW" ? `新增${periodLabel[activePeriod]}任務…` : `Add ${periodLabel[activePeriod].toLowerCase()} task…`}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button onClick={addTodo} disabled={!newTodoText.trim()}
            className="w-8 h-[38px] flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-30 transition-colors text-lg leading-none">
            +
          </button>
        </div>

        {periodItems.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">
            {language === "zh-TW" ? `${periodLabel[activePeriod]}還沒有任務，輸入上方新增` : `No ${periodLabel[activePeriod].toLowerCase()} tasks yet`}
          </p>
        ) : (
          <div className="space-y-1.5">
            {periodItems.map((item) => (
              <div key={item.id} className="flex items-center gap-2 bg-white rounded-lg border border-gray-100 px-3 py-2">
                <p className={`flex-1 text-sm min-w-0 truncate ${item.status === "completed" ? "line-through text-gray-400" : "text-gray-700"}`}>
                  {item.title}
                </p>
                {item.analysis && scoreChip(item.analysis.score)}
                <select
                  value={item.status}
                  onChange={(e) => updateTodoStatus(item.id, e.target.value as PlanStatus)}
                  className={`text-xs rounded px-1.5 py-0.5 border-0 cursor-pointer focus:outline-none shrink-0 ${STATUS_STYLE[item.status]}`}
                >
                  {(["active", "in-progress", "shelved", "completed"] as PlanStatus[]).map((s) => (
                    <option key={s} value={s}>{statusLabel[s]}</option>
                  ))}
                </select>
                <button onClick={() => deleteTodo(item.id)}
                  className="text-gray-300 hover:text-red-400 text-base leading-none shrink-0">×</button>
              </div>
            ))}
          </div>
        )}

        {(planPhase === "analyzing" || planPhase === "result") && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-4 space-y-3 mt-2">
            {planPhase === "analyzing" && !planAnalysis && (
              <p className="text-xs text-gray-400 animate-pulse text-center py-4">
                {language === "zh-TW" ? "AI 分析中…" : "Analyzing…"}
              </p>
            )}

            {planAnalysis && (() => {
              const scopeItems = getScopeItems(planScope);
              const scoreMap = new Map(planAnalysis.items.map((i) => [i.id, i]));
              return (
                <>
                  <div className="bg-indigo-50 rounded-lg px-3 py-2.5">
                    <p className="text-xs font-semibold text-indigo-700 mb-1">
                      {language === "zh-TW" ? "整體評估" : "Overall Assessment"}
                    </p>
                    <p className="text-xs text-indigo-700 leading-relaxed">{planAnalysis.overallAssessment}</p>
                  </div>

                  <div className="space-y-1.5">
                    {scopeItems.map((item) => {
                      const scored = scoreMap.get(item.id);
                      return (
                        <div key={item.id} className="bg-white rounded-lg border border-gray-100 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-gray-700 flex-1 truncate">{item.title}</p>
                            {scored && scoreChip(scored.score)}
                          </div>
                          {scored && (
                            <div className="mt-0.5 space-y-0.5">
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
                    <div className="bg-gray-50 rounded-lg border border-gray-100 px-3 py-2.5">
                      <p className="text-xs font-semibold text-gray-600 mb-1">
                        {language === "zh-TW" ? "AI 建議" : "Suggestions"}
                      </p>
                      <p className="text-xs text-gray-600 leading-relaxed">{planAnalysis.suggestions}</p>
                    </div>
                  )}

                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                      {language === "zh-TW" ? "與 AI 討論" : "Discuss with AI"}
                    </p>
                    <div ref={planChatRef} className="max-h-40 overflow-y-auto space-y-1.5">
                      {planMessages.map((m, i) => (
                        <div key={i} className={`text-xs leading-relaxed px-3 py-2 rounded-xl ${m.role === "assistant" ? "bg-indigo-50 text-indigo-800" : "bg-gray-100 text-gray-700 ml-auto max-w-[85%]"}`}>
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
                      <input value={planChatInput} onChange={(e) => setPlanChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handlePlanChat()}
                        placeholder={language === "zh-TW" ? "輸入問題或調整建議…" : "Ask or suggest changes…"}
                        className="flex-1 text-xs rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                      <button onClick={handlePlanChat} disabled={planChatLoading || !planChatInput.trim()}
                        className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs disabled:opacity-40">↑</button>
                    </div>
                  </div>

                  <button onClick={() => { setPlanPhase("idle"); setPlanAnalysis(null); setPlanMessages([]); }}
                    className="text-xs text-gray-300 hover:text-gray-500 w-full text-center">
                    {language === "zh-TW" ? "清除分析結果" : "Clear analysis"}
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </section>
    </div>
  );
}
