"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import { callAI } from "@/lib/ai-client";
import { saveIdea, saveObjective, fetchRoles, fetchObjectives } from "@/lib/db";
import { getUserProfile, getObjGroups } from "@/lib/storage";
import { buildEvaluationPrompt } from "@/lib/evaluation-prompt";
import { getEvaluationProfile } from "@/lib/storage";
import IkigaiViz from "@/components/IkigaiViz";
import { useAIWorkspace } from "@/components/AIWorkspaceContext";
import type {
  IdeaValidationReport, IdeaDecision, MarketResearch, Objective, KeyResult, Role,
} from "@/lib/types";

type Phase =
  | "capture"
  | "rephrasing"
  | "clarifying"
  | "analyzing"
  | "report"
  | "deciding"
  | "okr-draft"
  | "okr-saving"
  | "done";

export default function NewIdeaPage() {
  const { user, requireAuth } = useAuth();
  const { t, language } = useLanguage();
  const router = useRouter();
  const zh = language === "zh-TW";
  const { setPageContext } = useAIWorkspace();

  const [phase, setPhase] = useState<Phase>("capture");
  const [analyzeStatus, setAnalyzeStatus] = useState<"searching" | "analyzing" | null>(null);
  const [rawInput, setRawInput] = useState("");
  const [confirmedTitle, setConfirmedTitle] = useState("");
  const [rephraseSuggestion, setRephraseSuggestion] = useState("");
  const [clarifyQ, setClarifyQ] = useState("");
  const [clarifyA, setClarifyA] = useState("");
  const [report, setReport] = useState<IdeaValidationReport | null>(null);
  const [decision, setDecision] = useState<IdeaDecision | null>(null);
  const [error, setError] = useState("");

  // OKR draft state
  const [roles, setRoles] = useState<Role[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draftObjective, setDraftObjective] = useState("");
  const [draftTimeframe, setDraftTimeframe] = useState("");
  const [draftKRs, setDraftKRs] = useState<string[]>(["", "", ""]);
  const [okrLoading, setOkrLoading] = useState(false);

  const [userBackground, setUserBackground] = useState<string | null>(null);

  useEffect(() => {
    const profile = getUserProfile();
    if (profile) setUserBackground(profile.statement);
    if (user) {
      fetchRoles().then(setRoles).catch(() => {});
      fetchObjectives().then(setObjectives).catch(() => {});
    }
  }, [user]);

  // Sync page context for AI workspace drawer
  useEffect(() => {
    if (phase === "report" && report && confirmedTitle) {
      setPageContext({
        label: zh ? "驗證想法" : "Idea Validation",
        systemContext: `User is reviewing an idea validation report.\nIdea: ${confirmedTitle}\nOverall score: ${report.ikigai.overallScore}/10\nVerdict: ${report.ikigai.verdict}`,
      });
    } else if (phase === "capture" || phase === "rephrasing" || phase === "clarifying") {
      setPageContext({
        label: zh ? "驗證想法" : "Idea Validation",
        systemContext: confirmedTitle
          ? `User is in the middle of validating an idea: ${confirmedTitle}`
          : "User is about to capture and validate a new idea.",
      });
    } else if (phase === "okr-draft") {
      setPageContext({
        label: zh ? "建立 OKR" : "Create OKR",
        systemContext: `User is creating an OKR from an idea they decided to pursue.\nIdea: ${confirmedTitle}\nDraft objective: ${draftObjective}`,
      });
    }
    return () => setPageContext(null);
  }, [phase, confirmedTitle, report, draftObjective]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase transitions ──────────────────────────────────────────────────────

  async function handleCapture() {
    if (!rawInput.trim()) return;
    if (!user) { requireAuth(); return; }
    setError("");

    // Rephrase if short / no notes
    if (rawInput.trim().length < 30) {
      setPhase("rephrasing");
      try {
        const { rephrased } = await callAI<{ rephrased: string | null }>(
          "rephraseInput", { ideaTitle: rawInput.trim(), userBackground }
        );
        if (rephrased) { setRephraseSuggestion(rephrased); return; }
      } catch { /* fall through */ }
      setPhase("capture");
    }

    const title = rawInput.trim();
    setConfirmedTitle(title);
    await runClarify(title);
  }

  async function confirmRephrase(useRephrased: boolean) {
    const title = useRephrased ? rephraseSuggestion : rawInput.trim();
    setConfirmedTitle(title);
    setRephraseSuggestion("");
    await runClarify(title);
  }

  async function runClarify(title: string) {
    setPhase("clarifying");
    const evalProfile = getEvaluationProfile();
    const groups = getObjGroups();
    try {
      const { shouldClarify, question } = await callAI<{ shouldClarify: boolean; question: string }>(
        "clarifyIdea", { ideaTitle: title, objectives }
      );
      if (shouldClarify && question) { setClarifyQ(question); setClarifyA(""); return; }
    } catch { /* fall through */ }
    await runAnalysis(title, "", evalProfile, groups);
  }

  async function submitClarify() {
    const evalProfile = getEvaluationProfile();
    const groups = getObjGroups();
    await runAnalysis(confirmedTitle, clarifyA, evalProfile, groups);
  }

  async function runAnalysis(title: string, notes: string, evalProfile: ReturnType<typeof getEvaluationProfile>, groups: ReturnType<typeof getObjGroups>) {
    setPhase("analyzing");
    setError("");
    try {
      // Step 1: search market data (non-blocking — fall back silently if it fails)
      setAnalyzeStatus("searching");
      let marketResearch: MarketResearch | undefined;
      try {
        marketResearch = await callAI<MarketResearch>("searchMarketData", { ideaTitle: title });
      } catch {
        // market search failure is non-fatal
      }

      // Step 2: run ikigai analysis with market context
      setAnalyzeStatus("analyzing");
      const result = await callAI<IdeaValidationReport>("analyzeIdeaValidation", {
        ideaTitle: title,
        ideaNotes: notes,
        userBackground,
        objectives,
        marketResearch,
      });
      setReport(result);
      setConfirmedTitle(title);
      setPhase("report");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("capture");
    } finally {
      setAnalyzeStatus(null);
    }
  }

  async function handleDecision(d: IdeaDecision) {
    setDecision(d);

    // Save idea to DB
    const idea = {
      id: uuid(),
      title: confirmedTitle,
      description: clarifyA,
      analysis: null,
      createdAt: new Date().toISOString(),
      ideaStatus: d === "pursue" ? "active" as const : d === "shelve" ? "shelved" as const : "abandoned" as const,
      decision: d,
      validationReport: report!,
    };
    try { await saveIdea(idea); } catch { /* non-blocking */ }

    if (d === "pursue") {
      await loadOKRDraft();
    } else {
      setPhase("done");
    }
  }

  async function loadOKRDraft() {
    setPhase("okr-draft");
    setOkrLoading(true);
    try {
      const draft = await callAI<{
        suggestedRoleId: string | null;
        objectiveTitle: string;
        timeframe: string;
        keyResults: string[];
      }>("generateIdeaOKR", {
        ideaTitle: confirmedTitle,
        ideaNotes: clarifyA,
        roles: roles.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji })),
      });
      setSelectedRoleId(draft.suggestedRoleId);
      setDraftObjective(draft.objectiveTitle);
      setDraftTimeframe(draft.timeframe);
      setDraftKRs([...draft.keyResults.slice(0, 3), "", "", ""].slice(0, 3));
    } catch {
      // Fallback: use idea title as objective
      setDraftObjective(confirmedTitle);
      setDraftTimeframe("");
      setDraftKRs(["", "", ""]);
    } finally {
      setOkrLoading(false);
    }
  }

  async function saveOKR() {
    if (!draftObjective.trim()) return;
    setPhase("okr-saving");
    try {
      const keyResults: KeyResult[] = draftKRs
        .filter((k) => k.trim())
        .map((title) => ({ id: uuid(), title }));
      const obj: Objective = {
        id: uuid(),
        title: draftObjective,
        keyResults,
        createdAt: new Date().toISOString(),
        status: "active",
        meta: {
          timeframe: draftTimeframe || undefined,
          ...(selectedRoleId ? { groupId: selectedRoleId } : {}),
        },
      };
      await saveObjective(obj);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("okr-draft");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-gray-700">
          {phase === "report" || phase === "deciding"
            ? t("ideas.report.title")
            : phase === "okr-draft" || phase === "okr-saving"
            ? t("ideas.okr.title")
            : phase === "done"
            ? (decision === "pursue" ? t("ideas.done.pursue") : decision === "shelve" ? t("ideas.done.shelve") : t("ideas.done.abandon"))
            : t("ideas.new.title")}
        </span>
      </div>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-6">

        {/* ── CAPTURE ────────────────────────────────────────────────────── */}
        {phase === "capture" && (
          <div className="space-y-4">
            <p className="text-2xl font-bold text-gray-900 leading-snug">
              {zh ? "把想法丟進來" : "Capture your idea"}
            </p>
            <p className="text-sm text-gray-400">
              {zh ? "隨意寫，不用管格式" : "Write freely, no format needed"}
            </p>
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={t("ideas.new.placeholder")}
              rows={6}
              autoFocus
              className="w-full rounded-2xl border-2 border-gray-100 focus:border-indigo-300 bg-gray-50 px-4 py-4 text-sm leading-relaxed focus:outline-none focus:ring-0 resize-none transition-colors"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={handleCapture}
              disabled={!rawInput.trim()}
              className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {t("ideas.new.submit")}
            </button>
          </div>
        )}

        {/* ── REPHRASING ─────────────────────────────────────────────────── */}
        {phase === "rephrasing" && !rephraseSuggestion && (
          <div className="flex items-center gap-3 py-12 justify-center text-sm text-gray-400">
            <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            {zh ? "AI 理解中…" : "AI is interpreting…"}
          </div>
        )}

        {phase === "rephrasing" && rephraseSuggestion && (
          <div className="space-y-4">
            <p className="text-lg font-bold text-gray-900">
              {t("ideas.new.rephraseHint")}
            </p>
            <div className="rounded-2xl border-2 border-indigo-100 bg-indigo-50/30 px-4 py-4 space-y-3">
              <textarea
                value={rephraseSuggestion}
                onChange={(e) => setRephraseSuggestion(e.target.value)}
                rows={3}
                className="w-full bg-transparent text-sm leading-relaxed focus:outline-none resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => confirmRephrase(true)}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  {t("ideas.new.rephraseConfirm")}
                </button>
                <button
                  onClick={() => confirmRephrase(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50"
                >
                  {t("ideas.new.rephraseCancel")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CLARIFYING ─────────────────────────────────────────────────── */}
        {phase === "clarifying" && !clarifyQ && (
          <div className="flex items-center gap-3 py-12 justify-center text-sm text-gray-400">
            <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            {zh ? "AI 確認中…" : "AI confirming…"}
          </div>
        )}

        {phase === "clarifying" && clarifyQ && (
          <div className="space-y-4">
            <p className="text-lg font-bold text-gray-900">
              {zh ? "先確認一個問題" : "One quick question"}
            </p>
            <div className="rounded-2xl border-2 border-indigo-100 bg-indigo-50/20 px-4 py-4 space-y-3">
              <p className="text-sm text-indigo-700 font-medium">{clarifyQ}</p>
              <textarea
                value={clarifyA}
                onChange={(e) => setClarifyA(e.target.value)}
                placeholder={zh ? "輸入你的回答…" : "Your answer…"}
                rows={3}
                autoFocus
                className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitClarify}
                  disabled={!clarifyA.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
                >
                  {zh ? "繼續 →" : "Continue →"}
                </button>
                <button
                  onClick={() => { setClarifyQ(""); runAnalysis(confirmedTitle, "", getEvaluationProfile(), getObjGroups()); }}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50"
                >
                  {zh ? "跳過" : "Skip"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── ANALYZING ──────────────────────────────────────────────────── */}
        {phase === "analyzing" && (
          <div className="flex flex-col items-center gap-4 py-16">
            <div className="w-10 h-10 border-indigo-400 border-t-transparent rounded-full animate-spin" style={{ borderWidth: 3, border: "3px solid #a5b4fc", borderTopColor: "transparent" }} />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-gray-700">
                {analyzeStatus === "searching"
                  ? (zh ? "搜尋市場資料中…" : "Searching market data…")
                  : (zh ? "分析中…" : "Analyzing…")}
              </p>
              {analyzeStatus === "searching" && (
                <p className="text-xs text-gray-400">
                  {zh ? "AI 正在搜尋市場規模、痛點與現有解法" : "AI is searching market size, pain points & existing solutions"}
                </p>
              )}
            </div>
            {/* Step indicators */}
            <div className="flex items-center gap-2 mt-2">
              <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${analyzeStatus === "searching" ? "bg-indigo-100 text-indigo-600" : "bg-green-100 text-green-600"}`}>
                {analyzeStatus !== "searching" ? "✓ " : ""}{zh ? "市場搜尋" : "Market search"}
              </span>
              <span className="text-gray-300">→</span>
              <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${analyzeStatus === "analyzing" ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-400"}`}>
                {zh ? "Ikigai 分析" : "Ikigai analysis"}
              </span>
            </div>
          </div>
        )}

        {/* ── REPORT ─────────────────────────────────────────────────────── */}
        {(phase === "report" || phase === "deciding") && report && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-semibold text-indigo-500 uppercase tracking-widest mb-1">
                {t("ideas.report.ikigai")}
              </p>
              <p className="text-base font-semibold text-gray-800 leading-snug mb-4">
                {confirmedTitle}
              </p>
              <IkigaiViz report={report} zh={zh} />
            </div>

            {/* Core Risks */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                {t("ideas.report.risks")}
              </p>
              {report.coreRisks.map((r, i) => (
                <div key={i} className="rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-3 space-y-1">
                  <p className="text-sm font-medium text-amber-800">⚠ {r.risk}</p>
                  <p className="text-xs text-amber-700 opacity-80">
                    <span className="font-medium">{t("ideas.report.fastValidation")}：</span>
                    {r.fastValidation}
                  </p>
                </div>
              ))}
            </div>

            {/* Experiment */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 px-4 py-4 space-y-2">
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest">
                {t("ideas.report.experiment")}
              </p>
              <div className="space-y-1.5 text-sm">
                <p>
                  <span className="font-medium text-indigo-700">{t("ideas.report.hypothesis")}：</span>
                  <span className="text-gray-700">{report.experiment.hypothesis}</span>
                </p>
                <p>
                  <span className="font-medium text-indigo-700">{t("ideas.report.action")}：</span>
                  <span className="text-gray-700">{report.experiment.weeklyAction}</span>
                </p>
                <p>
                  <span className="font-medium text-indigo-700">{t("ideas.report.success")}：</span>
                  <span className="text-gray-700">{report.experiment.successCriteria}</span>
                </p>
              </div>
            </div>

            {phase === "report" && (
              <button
                onClick={() => setPhase("deciding")}
                className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors"
              >
                {t("ideas.report.next")}
              </button>
            )}

            {/* ── DECIDING inline ─────────────────────────────────────── */}
            {phase === "deciding" && (
              <div className="space-y-3">
                <p className="text-base font-bold text-gray-900 pt-2">
                  {t("ideas.decide.title")}
                </p>
                {(
                  [
                    { d: "pursue" as IdeaDecision, label: t("ideas.decide.pursue"), hint: t("ideas.decide.pursueHint"), style: "bg-indigo-600 text-white hover:bg-indigo-700" },
                    { d: "shelve" as IdeaDecision, label: t("ideas.decide.shelve"), hint: t("ideas.decide.shelveHint"), style: "bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100" },
                    { d: "abandon" as IdeaDecision, label: t("ideas.decide.abandon"), hint: t("ideas.decide.abandonHint"), style: "bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100" },
                  ] as const
                ).map(({ d, label, hint, style }) => (
                  <button
                    key={d}
                    onClick={() => handleDecision(d)}
                    className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl text-sm font-semibold transition-colors ${style}`}
                  >
                    <span>{label}</span>
                    <span className="text-xs font-normal opacity-70">{hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── OKR DRAFT ──────────────────────────────────────────────────── */}
        {(phase === "okr-draft" || phase === "okr-saving") && (
          <div className="space-y-5">
            {okrLoading ? (
              <div className="flex items-center gap-3 py-12 justify-center text-sm text-gray-400">
                <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                {zh ? "AI 草擬 OKR 中…" : "AI drafting OKR…"}
              </div>
            ) : (
              <>
                {/* Role selector */}
                {roles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                      {t("ideas.okr.roleHint")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {roles.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setSelectedRoleId(selectedRoleId === r.id ? null : r.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            selectedRoleId === r.id
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : "border-gray-200 text-gray-600 hover:border-indigo-300"
                          }`}
                        >
                          <span>{r.emoji}</span>
                          <span>{r.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Objective */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                    {t("ideas.okr.objective")}
                  </label>
                  <textarea
                    value={draftObjective}
                    onChange={(e) => setDraftObjective(e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                  />
                  {draftTimeframe && (
                    <p className="text-xs text-gray-400">{draftTimeframe}</p>
                  )}
                </div>

                {/* Key Results */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                    {t("ideas.okr.keyResults")}
                  </label>
                  {draftKRs.map((kr, i) => (
                    <input
                      key={i}
                      value={kr}
                      onChange={(e) => {
                        const updated = [...draftKRs];
                        updated[i] = e.target.value;
                        setDraftKRs(updated);
                      }}
                      placeholder={`KR ${i + 1}`}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  ))}
                </div>

                {error && <p className="text-xs text-red-500">{error}</p>}

                <button
                  onClick={saveOKR}
                  disabled={!draftObjective.trim() || phase === "okr-saving"}
                  className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  {phase === "okr-saving"
                    ? (zh ? "建立中…" : "Creating…")
                    : t("ideas.okr.confirm")}
                </button>
                <button
                  onClick={() => setPhase("done")}
                  className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {t("ideas.okr.skip")}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── DONE ───────────────────────────────────────────────────────── */}
        {phase === "done" && (
          <div className="flex flex-col items-center gap-6 py-8 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-indigo-50 text-3xl">
              {decision === "pursue" ? "🎯" : decision === "shelve" ? "📦" : "🚫"}
            </div>
            <p className="text-lg font-bold text-gray-900">
              {decision === "pursue"
                ? t("ideas.done.pursue")
                : decision === "shelve"
                ? t("ideas.done.shelve")
                : t("ideas.done.abandon")}
            </p>
            <div className="flex flex-col gap-2 w-full">
              {decision === "pursue" && (
                <button
                  onClick={() => router.push("/okr")}
                  className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700"
                >
                  {t("ideas.done.viewOKR")}
                </button>
              )}
              <button
                onClick={() => router.push("/ideas")}
                className="w-full py-3 rounded-2xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
              >
                {t("ideas.done.viewIdeas")}
              </button>
              <button
                onClick={() => {
                  setPhase("capture");
                  setRawInput("");
                  setConfirmedTitle("");
                  setReport(null);
                  setDecision(null);
                  setError("");
                }}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600"
              >
                {t("ideas.done.addAnother")}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
