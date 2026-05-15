"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, WeeklyLog, LogItem, AlignmentReport } from "@/lib/types";
import { saveObjective, saveWeeklyLog, saveLogItems, saveReport } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
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
  const { user } = useAuth();
  const { language } = useLanguage();

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

  // Step 4 state
  const [weekInput, setWeekInput] = useState("");

  // Step 5 state
  const [firstReport, setFirstReport] = useState<AlignmentReport | null>(null);
  const [logItems, setLogItems] = useState<LogItem[]>([]);

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

      const keyResults: KeyResult[] = krTitles.map((title) => ({
        id: uuid(), title,
      }));
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

  async function handleWeekSubmit() {
    if (!weekInput.trim() || !savedObjective) return;
    setLoading(true);
    setError("");
    try {
      const ws = getWeekStart();
      const logId = uuid();
      const log: WeeklyLog = { id: logId, weekStart: ws, rawInput: weekInput, createdAt: new Date().toISOString() };
      await saveWeeklyLog(log);

      const raw = await callAI<Array<{ content: string; krId: string | null; krTitle: string | null; isPlanned: boolean }>>(
        "classifyLogItems", { rawInput: weekInput, objectives: [savedObjective] }
      );
      const items: LogItem[] = raw.map((r) => ({
        id: uuid(), logId, content: r.content, krId: r.krId, krTitle: r.krTitle,
        isPlanned: r.isPlanned, createdAt: new Date().toISOString(),
      }));
      await saveLogItems(items);
      setLogItems(items);

      const reportData = await callAI<{ alignmentScore: number; aiInsight: string; suggestions: string[] }>(
        "generateAlignmentReport", { objectives: [savedObjective], logItems: items }
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

  function handleComplete() {
    saveSettings({ ...getSettings(), onboardingCompleted: true });
    router.push("/tasks");
  }

  const zh = language === "zh-TW";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-8">

        {/* Progress dots */}
        {step < 6 && (
          <div className="flex justify-center gap-1.5">
            {([1, 2, 3, 4, 5] as Step[]).map((s) => (
              <div key={s} className={`h-1.5 rounded-full transition-all ${
                s === step ? "w-6 bg-indigo-600" : s < step ? "w-1.5 bg-indigo-300" : "w-1.5 bg-gray-200"
              }`} />
            ))}
          </div>
        )}

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="text-center space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-indigo-500 uppercase tracking-widest">記錄指針</p>
              <h1 className="text-3xl font-bold text-gray-900 leading-tight">
                {zh ? "你做了很多事。\n但方向對嗎？" : "You did a lot.\nBut is it in the right direction?"}
              </h1>
              <p className="text-sm text-gray-500 leading-relaxed">
                {zh
                  ? "每週一份對齊報告，讓你知道行動和目標差多遠。"
                  : "A weekly alignment report to show how close your actions are to your goals."}
              </p>
            </div>
            <button
              onClick={() => setStep(2)}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors"
            >
              {zh ? "開始設定目標 →" : "Set up my goals →"}
            </button>
          </div>
        )}

        {/* Step 2: Intent input */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs text-gray-400">{zh ? "1 / 3" : "1 / 3"}</p>
              <h2 className="text-xl font-semibold text-gray-900">
                {zh ? "最近最想完成什麼？" : "What do you most want to accomplish recently?"}
              </h2>
              <p className="text-sm text-gray-400">
                {zh ? "用一句話描述，AI 會幫你整理成可追蹤的目標" : "Describe in one sentence — AI will structure it into a trackable goal"}
              </p>
            </div>
            <textarea
              value={intentInput}
              onChange={(e) => setIntentInput(e.target.value)}
              placeholder={zh
                ? "例如：我想在三個月內把副業收入提升到每月一萬"
                : "e.g. I want to grow my side income to $1k/month in 3 months"}
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
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
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs text-gray-400">{zh ? "2 / 3" : "2 / 3"}</p>
              <h2 className="text-xl font-semibold text-gray-900">
                {zh ? "確認你的目標" : "Confirm your goal"}
              </h2>
              <p className="text-sm text-gray-400">
                {zh ? "AI 整理了你的意圖，可以直接修改" : "AI structured your intent — feel free to edit"}
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">{zh ? "目標方向" : "Goal"}</label>
                <input
                  value={confirmedTitle}
                  onChange={(e) => setConfirmedTitle(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                {draftObjective?.timeframe && (
                  <p className="text-xs text-gray-400">{zh ? "時程：" : "Timeframe: "}{draftObjective.timeframe}</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">
                  {zh ? "關鍵結果（AI 已建議，可自行修改或留空）" : "Key Results (AI-suggested — edit freely or leave blank)"}
                </label>
                {krInputs.map((kr, i) => (
                  <input
                    key={i}
                    value={kr}
                    onChange={(e) => setKrInputs((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
                    placeholder={zh ? `信號 ${i + 1}（選填）` : `Signal ${i + 1} (optional)`}
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

        {/* Step 4: This week's reality */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs text-gray-400">{zh ? "3 / 3" : "3 / 3"}</p>
              <h2 className="text-xl font-semibold text-gray-900">
                {zh ? "這週你做了什麼？" : "What did you do this week?"}
              </h2>
              <p className="text-sm text-gray-400">
                {zh
                  ? "自由輸入，AI 會對照你的目標分析對齊程度，當天就能看到第一份報告"
                  : "Free-form input — AI will analyze alignment against your goal and you'll see your first report today"}
              </p>
            </div>
            <textarea
              value={weekInput}
              onChange={(e) => setWeekInput(e.target.value)}
              placeholder={zh
                ? "例如：寫了三篇文章草稿、開了兩個客戶會議、準備了一份提案…"
                : "e.g. Wrote 3 article drafts, had 2 client meetings, prepared a proposal…"}
              rows={6}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={handleWeekSubmit}
              disabled={!weekInput.trim() || loading}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {loading
                ? (zh ? "AI 分析中，稍等一下…" : "AI analyzing, just a moment…")
                : (zh ? "產出本週報告 →" : "Generate my report →")}
            </button>
          </div>
        )}

        {/* Step 5: Aha Moment */}
        {step === 5 && firstReport && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">
                {zh ? "你的第一份方向對齊報告" : "Your first alignment report"}
              </h2>
            </div>

            <div className="flex flex-col items-center py-6 bg-white rounded-2xl border border-gray-100">
              <ScoreRing score={firstReport.alignmentScore} scale="0-100" size={96} />
              <p className="text-sm font-medium text-gray-600 mt-3">
                {zh ? "方向對齊率" : "Alignment Score"}
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {zh ? "觀察" : "Insight"}
              </h3>
              <p className="text-sm text-gray-700 leading-relaxed">{firstReport.aiInsight}</p>
            </div>

            {firstReport.suggestions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {zh ? "可以考慮的方向" : "Directions to consider"}
                </h3>
                <ul className="space-y-1.5">
                  {firstReport.suggestions.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-indigo-400">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
          <div className="space-y-6">
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
                  <p className="text-xs text-gray-400">{zh ? "AI 提醒你產出報告" : "AI reminds you to generate your report"}</p>
                </div>
                <span className="text-sm text-indigo-600 font-medium">{zh ? "週日晚上" : "Sunday evening"}</span>
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-gray-200 p-4 space-y-2">
              <p className="text-sm font-medium text-gray-500">{zh ? "外部數據連接（選填，之後設定）" : "External data sources (optional, set up later)"}</p>
              <p className="text-xs text-gray-400">
                {zh
                  ? "Google Calendar、GitHub Commits 可以自動補充你的週記錄"
                  : "Google Calendar, GitHub Commits can auto-populate your weekly log"}
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
