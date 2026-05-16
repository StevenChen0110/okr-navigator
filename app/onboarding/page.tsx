"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, WeeklyLog, LogItem, AlignmentReport } from "@/lib/types";
import { saveObjective, saveWeeklyLog, saveLogItems, saveReport } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useLanguage } from "@/components/LanguageProvider";
import { getSettings, saveSettings } from "@/lib/storage";
import ScoreRing from "@/components/ScoreRing";

type Step = 1 | 2 | 3 | 4 | 5 | 6;

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

export default function OnboardingPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const zh = language === "zh-TW";

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 2 state
  const [intentInput, setIntentInput] = useState("");
  const [draftObjective, setDraftObjective] = useState<{ title: string; timeframe: string } | null>(null);

  // Step 3 state
  const [confirmedTitle, setConfirmedTitle] = useState("");
  const [krInputs, setKrInputs] = useState(["", "", ""]);
  const [savedObjective, setSavedObjective] = useState<Objective | null>(null);

  // Step 4 state — structured item list instead of free-text
  const [weekItems, setWeekItems] = useState<string[]>([]);
  const [newWeekItem, setNewWeekItem] = useState("");

  // Step 5 state
  const [firstReport, setFirstReport] = useState<AlignmentReport | null>(null);
  const [savedLogId, setSavedLogId] = useState<string | null>(null);

  async function handleIntentSubmit() {
    if (!intentInput.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await callAI<{ title: string; timeframe: string }>("refineObjective", {
        rawInput: intentInput,
      });
      setDraftObjective(result);
      setConfirmedTitle(result.title);

      // Auto-generate KRs for user to review
      try {
        const suggested = await callAI<string[]>("suggestKeyResults", {
          objectiveTitle: result.title,
          existingKRs: [],
        });
        setKrInputs([...suggested.slice(0, 3), "", "", ""].slice(0, 3));
      } catch {
        setKrInputs(["", "", ""]);
      }

      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleOKRConfirm() {
    if (!confirmedTitle.trim()) return;
    setLoading(true);
    setError("");
    try {
      const filledKRs = krInputs.filter((k) => k.trim());
      let krTitles = filledKRs;

      if (krTitles.length === 0) {
        const suggested = await callAI<string[]>("suggestKeyResults", {
          objectiveTitle: confirmedTitle,
          existingKRs: [],
        });
        krTitles = suggested.slice(0, 3);
      }

      const keyResults: KeyResult[] = krTitles.map((title) => ({ id: uuid(), title }));
      const obj: Objective = {
        id: uuid(), title: confirmedTitle, keyResults,
        createdAt: new Date().toISOString(), status: "active",
        meta: { timeframe: draftObjective?.timeframe },
      };
      await saveObjective(obj);
      setSavedObjective(obj);
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function addWeekItem() {
    const item = newWeekItem.trim();
    if (!item) return;
    setWeekItems((prev) => [...prev, item]);
    setNewWeekItem("");
  }

  function removeWeekItem(i: number) {
    setWeekItems((prev) => prev.filter((_, j) => j !== i));
  }

  async function handleWeekSubmit() {
    if (!weekItems.length || !savedObjective) return;
    setLoading(true);
    setError("");
    try {
      const ws = getWeekStart();
      const logId = uuid();
      const rawInput = weekItems.join("\n");
      const log: WeeklyLog = { id: logId, weekStart: ws, rawInput, createdAt: new Date().toISOString() };
      await saveWeeklyLog(log);
      setSavedLogId(logId);

      const raw = await callAI<Array<{ content: string; krId: string | null; krTitle: string | null; isPlanned: boolean }>>(
        "classifyLogItems", { rawInput, objectives: [savedObjective] }
      );
      const items: LogItem[] = raw.map((r) => ({
        id: uuid(), logId, content: r.content, krId: r.krId, krTitle: r.krTitle,
        isPlanned: r.isPlanned, createdAt: new Date().toISOString(),
      }));
      await saveLogItems(items);

      const reportData = await callAI<{ alignmentScore: number; aiInsight: string; suggestions: string[] }>(
        "generateAlignmentReport", {
          objectives: [savedObjective],
          items: items.map((i) => ({ content: i.content, isPlanned: i.isPlanned, krTitle: i.krTitle })),
        }
      );
      const report: AlignmentReport = {
        id: uuid(), weekStart: ws, alignmentScore: reportData.alignmentScore,
        aiInsight: reportData.aiInsight, suggestions: reportData.suggestions,
        logId, createdAt: new Date().toISOString(),
      };
      await saveReport(report);
      setFirstReport(report);
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Regenerate report with updated items
  async function handleRegenerate() {
    if (!weekItems.length || !savedObjective || !savedLogId) return;
    setLoading(true);
    setError("");
    try {
      const ws = getWeekStart();
      const rawInput = weekItems.join("\n");
      const log: WeeklyLog = { id: savedLogId, weekStart: ws, rawInput, createdAt: new Date().toISOString() };
      await saveWeeklyLog(log);

      const raw = await callAI<Array<{ content: string; krId: string | null; krTitle: string | null; isPlanned: boolean }>>(
        "classifyLogItems", { rawInput, objectives: [savedObjective] }
      );
      const items: LogItem[] = raw.map((r) => ({
        id: uuid(), logId: savedLogId, content: r.content, krId: r.krId, krTitle: r.krTitle,
        isPlanned: r.isPlanned, createdAt: new Date().toISOString(),
      }));
      await saveLogItems(items);

      const reportData = await callAI<{ alignmentScore: number; aiInsight: string; suggestions: string[] }>(
        "generateAlignmentReport", {
          objectives: [savedObjective],
          items: items.map((i) => ({ content: i.content, isPlanned: i.isPlanned, krTitle: i.krTitle })),
        }
      );
      const report: AlignmentReport = {
        id: uuid(), weekStart: ws, alignmentScore: reportData.alignmentScore,
        aiInsight: reportData.aiInsight, suggestions: reportData.suggestions,
        logId: savedLogId, createdAt: new Date().toISOString(),
      };
      await saveReport(report);
      setFirstReport(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleComplete() {
    saveSettings({ ...getSettings(), onboardingCompleted: true });
    router.push("/tasks");
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-8">

        {/* Progress bar */}
        {step < 6 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>{zh ? `步驟 ${Math.min(step, 5)} / 5` : `Step ${Math.min(step, 5)} of 5`}</span>
              <span>{Math.round(((step - 1) / 4) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${((step - 1) / 4) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="step-enter text-center space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-indigo-500 uppercase tracking-widest">記錄指針</p>
              <h1 className="text-3xl font-bold text-gray-900 leading-tight">
                {zh ? "30 秒知道哪個想法\n最值得做" : "Know in 30 seconds\nwhich idea matters most"}
              </h1>
              <p className="text-sm text-gray-500 leading-relaxed">
                {zh
                  ? "不是 OKR 工具——是決策加速器。連結你的目標，AI 秒算每件事的貢獻度。"
                  : "Not an OKR tool — a decision accelerator. Link your goals, AI instantly scores each idea."}
              </p>
            </div>
            <button
              onClick={() => setStep(2)}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors"
            >
              {zh ? "開始，只要 3 步驟 →" : "Get started, just 3 steps →"}
            </button>
          </div>
        )}

        {/* Step 2: Intent input */}
        {step === 2 && (
          <div className="step-enter space-y-5">
            <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
              <span className="text-xl mt-0.5">✍️</span>
              <div>
                <p className="text-xs font-semibold text-indigo-700">{zh ? "不用想太多" : "Don't overthink it"}</p>
                <p className="text-[11px] text-indigo-500 mt-0.5 leading-snug">
                  {zh ? "一句話就夠，AI 會幫你整理成可追蹤的格式" : "One sentence is enough — AI will structure it for you"}
                </p>
              </div>
            </div>
            <h2 className="text-xl font-semibold text-gray-900">
              {zh ? "最近最想完成什麼？" : "What do you most want to accomplish recently?"}
            </h2>
            <textarea
              value={intentInput}
              onChange={(e) => setIntentInput(e.target.value)}
              placeholder={zh
                ? "例如：我想在三個月內把副業收入提升到每月一萬"
                : "e.g. I want to grow my side income to $1k/month in 3 months"}
              rows={3}
              autoFocus
              className="w-full rounded-xl border border-indigo-200 bg-indigo-50/20 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white resize-none transition-colors"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={handleIntentSubmit}
              disabled={!intentInput.trim() || loading}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {loading ? (zh ? "AI 分析中…" : "Analyzing…") : (zh ? "下一步 →" : "Next →")}
            </button>
          </div>
        )}

        {/* Step 3: OKR confirmation */}
        {step === 3 && (
          <div className="step-enter space-y-5">
            <div className="flex items-start gap-3 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
              <span className="text-xl mt-0.5">✅</span>
              <div>
                <p className="text-xs font-semibold text-green-700">{zh ? "AI 幫你整理好了" : "AI structured your goal"}</p>
                <p className="text-[11px] text-green-600 mt-0.5 leading-snug">
                  {zh ? "直接修改成你的版本，或照樣接受都可以" : "Edit freely — or just accept as-is"}
                </p>
              </div>
            </div>
            <h2 className="text-xl font-semibold text-gray-900">
              {zh ? "確認你的目標" : "Confirm your goal"}
            </h2>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{zh ? "目標方向" : "Goal"}</label>
                <input
                  value={confirmedTitle}
                  onChange={(e) => setConfirmedTitle(e.target.value)}
                  autoFocus
                  className="w-full rounded-xl border border-indigo-200 bg-indigo-50/20 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white transition-colors"
                />
                {draftObjective?.timeframe && (
                  <p className="text-xs text-gray-400">{zh ? "時程：" : "Timeframe: "}{draftObjective.timeframe}</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">
                  {zh ? "關鍵結果（AI 已建議，可修改或留空）" : "Key Results (AI-suggested — edit freely or leave blank)"}
                </label>
                {krInputs.map((kr, i) => (
                  <input
                    key={i}
                    value={kr}
                    onChange={(e) => setKrInputs((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
                    placeholder={zh ? `關鍵結果 ${i + 1}（選填）` : `Key Result ${i + 1} (optional)`}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                ))}
              </div>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={handleOKRConfirm}
              disabled={!confirmedTitle.trim() || loading}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {loading ? (zh ? "儲存中…" : "Saving…") : (zh ? "確認，繼續 →" : "Confirm & continue →")}
            </button>
          </div>
        )}

        {/* Step 4: This week's actions — structured list */}
        {step === 4 && (
          <div className="step-enter space-y-5">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <span className="text-xl mt-0.5">📋</span>
              <div>
                <p className="text-xs font-semibold text-amber-700">{zh ? "任何事都算" : "Everything counts"}</p>
                <p className="text-[11px] text-amber-600 mt-0.5 leading-snug">
                  {zh ? "大事小事都可以記，AI 會自動對照你的目標分類" : "Big or small — AI automatically maps each item to your goals"}
                </p>
              </div>
            </div>
            <h2 className="text-xl font-semibold text-gray-900">
              {zh ? "這週你做了什麼？" : "What did you do this week?"}
            </h2>

            <div className="space-y-2">
              {weekItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                  <span className="text-gray-300 text-sm shrink-0">○</span>
                  <span className="text-sm text-gray-700 flex-1">{item}</span>
                  <button
                    onClick={() => removeWeekItem(i)}
                    className="text-gray-300 hover:text-red-400 text-lg leading-none shrink-0"
                  >×</button>
                </div>
              ))}

              <div className="flex gap-2">
                <input
                  value={newWeekItem}
                  onChange={(e) => setNewWeekItem(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && addWeekItem()}
                  placeholder={zh ? "加一條這週做的事…" : "Add something you did this week…"}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={addWeekItem}
                  disabled={!newWeekItem.trim()}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-30 text-xl leading-none transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              onClick={handleWeekSubmit}
              disabled={!weekItems.length || loading}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {loading
                ? (zh ? "AI 分析中，稍等一下…" : "AI analyzing, just a moment…")
                : (zh ? "產出本週報告 →" : "Generate my first report →")}
            </button>
          </div>
        )}

        {/* Step 5: Aha Moment */}
        {step === 5 && firstReport && (
          <div className="step-enter space-y-5">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-gray-900">
                {zh ? "你的第一份方向報告" : "Your first alignment report"}
              </h2>
              <p className="text-sm text-gray-400">
                {zh ? "這是你的行動和目標的距離" : "Here's how aligned your actions are with your goals"}
              </p>
            </div>

            {/* Score */}
            <div className="flex flex-col items-center py-6 bg-white rounded-2xl border border-gray-100">
              <ScoreRing score={firstReport.alignmentScore} scale="0-100" size={96} />
              <p className="text-sm font-medium text-gray-600 mt-3">
                {zh ? "方向對齊率" : "Alignment Score"}
              </p>
            </div>

            {/* Insight */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                {zh ? "AI 觀察" : "Insight"}
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">{firstReport.aiInsight}</p>
            </div>

            {firstReport.suggestions.length > 0 && (
              <div className="space-y-2">
                {firstReport.suggestions.map((s, i) => (
                  <div key={i} className="bg-indigo-50 rounded-xl border border-indigo-100 p-3.5 flex gap-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm text-indigo-900 leading-relaxed">{s}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Regenerate option */}
            <div className="rounded-xl border border-dashed border-gray-200 p-4 space-y-3">
              <p className="text-xs text-gray-500">
                {zh
                  ? "覺得這週記錄不完整？補充更多行動再重新生成"
                  : "Recorded incomplete? Add more actions and regenerate"}
              </p>
              <div className="flex gap-2">
                <div className="flex gap-2 flex-1">
                  <input
                    value={newWeekItem}
                    onChange={(e) => setNewWeekItem(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && addWeekItem()}
                    placeholder={zh ? "補充一條…" : "Add more…"}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button
                    onClick={addWeekItem}
                    disabled={!newWeekItem.trim()}
                    className="px-2.5 rounded-lg border border-gray-200 text-gray-400 hover:text-indigo-600 disabled:opacity-30 text-base leading-none"
                  >+</button>
                </div>
                <button
                  onClick={handleRegenerate}
                  disabled={loading || weekItems.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  {loading ? "…" : (zh ? "重新生成" : "Regenerate")}
                </button>
              </div>
              {weekItems.length > 0 && (
                <div className="space-y-1">
                  {weekItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="text-gray-300">○</span>
                      <span className="flex-1">{item}</span>
                      <button onClick={() => removeWeekItem(i)} className="text-gray-300 hover:text-red-400">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Feature highlights */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                {zh ? "工具箱裡還有" : "More in the toolkit"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded-xl p-3 space-y-1 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-700">{zh ? "想法驗證" : "Idea Validation"}</p>
                  <p className="text-[11px] text-gray-500 leading-snug">
                    {zh ? "輸入任何想法，AI 幫你評估對目標的幫助度" : "Enter any idea, AI scores how much it helps your goals"}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 space-y-1 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-700">{zh ? "隨時跟 AI 討論" : "AI Discussion"}</p>
                  <p className="text-[11px] text-gray-500 leading-snug">
                    {zh ? "每個分析後都可以直接跟 AI 對話，深入討論" : "Chat with AI directly after every analysis"}
                  </p>
                </div>
              </div>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              onClick={() => setStep(6)}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors"
            >
              {zh ? "最後一步 →" : "Last step →"}
            </button>
          </div>
        )}

        {/* Step 6: Preferences */}
        {step === 6 && (
          <div className="step-enter space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">
                {zh ? "偏好設定" : "Preferences"}
              </h2>
              <p className="text-sm text-gray-400">
                {zh ? "之後可以在設定頁修改" : "You can change these in settings later"}
              </p>
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">{zh ? "復盤時間" : "Review time"}</p>
                  <p className="text-xs text-gray-400">{zh ? "每週提醒你產出報告" : "Weekly reminder to generate your report"}</p>
                </div>
                <span className="text-sm text-indigo-600 font-medium">{zh ? "週日晚上" : "Sunday evening"}</span>
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-gray-200 p-4 space-y-2">
              <p className="text-sm font-medium text-gray-500">{zh ? "外部數據連接（選填，之後設定）" : "External data sources (optional, set up later)"}</p>
              <p className="text-xs text-gray-400">
                {zh
                  ? "Google Calendar、GitHub 可以自動補充你的週記錄"
                  : "Google Calendar, GitHub can auto-populate your weekly log"}
              </p>
            </div>

            <button
              onClick={handleComplete}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors"
            >
              {zh ? "開始使用記錄指針 →" : "Start using 記錄指針 →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
