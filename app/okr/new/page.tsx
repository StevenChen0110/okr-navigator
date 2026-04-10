"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, OKRMeta, Background, BackgroundCategory } from "@/lib/types";
import { getSettings } from "@/lib/storage";
import { saveObjective, fetchBackgrounds, saveBackground, removeBackground } from "@/lib/db";
import {
  refineObjective,
  suggestKeyResults,
  generateSnapshot,
  parseKRMetrics,
  refineKRTitle,
} from "@/lib/claude";
import Markdown from "@/components/Markdown";

type Step = "input" | "confirm-o" | "background" | "kr-loading" | "confirm-kr" | "saving" | "done";

const BG_CATEGORIES: BackgroundCategory[] = ["技能", "工作經歷", "學習背景", "其他"];

interface RefinedO {
  title: string;
  motivation: string;
  okrType: "committed" | "aspirational";
  timeframe: string;
}

interface ParsedKR {
  title: string;
  originalTitle: string; // AI's original suggestion for reference
  metricName: string;
  targetValue: number | null;
  unit: string;
  deadline: string | null;
}

const TIMEFRAME_OPTIONS = ["本月", "本季", "半年", "全年"];

export default function NewOKRPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [rawInput, setRawInput] = useState("");
  const [refined, setRefined] = useState<RefinedO>({
    title: "",
    motivation: "",
    okrType: "committed",
    timeframe: "本季",
  });
  const [parsedKrs, setParsedKrs] = useState<ParsedKR[]>([]);
  const [savedObjective, setSavedObjective] = useState<Objective | null>(null);
  const [error, setError] = useState("");

  // Inline KR refinement state
  const [refineOpenIdx, setRefineOpenIdx] = useState<number | null>(null);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);

  // Background step state
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [selectedBgIds, setSelectedBgIds] = useState<Set<string>>(new Set());
  const [newBgTitle, setNewBgTitle] = useState("");
  const [newBgCategory, setNewBgCategory] = useState<BackgroundCategory>("技能");
  const [bgBusy, setBgBusy] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_CLAUDE_API_KEY ?? "";
  const { claudeModel: model, language } = getSettings();

  useEffect(() => {
    fetchBackgrounds().then(setBackgrounds).catch(() => {});
  }, []);

  // Step 1 → 2: refine the one-liner
  async function handleRefine() {
    if (!rawInput.trim()) return;
    setError("");
    setStep("confirm-o");
    try {
      const result = await refineObjective(apiKey, model, language, rawInput);
      setRefined(result);
    } catch {
      setError("分析失敗，請重試");
      setStep("input");
    }
  }

  // Step 2 → background
  function handleConfirmO() {
    setStep("background");
  }

  // Add a new background inline
  async function handleAddBackground() {
    if (!newBgTitle.trim()) return;
    setBgBusy(true);
    try {
      const created = await saveBackground({ category: newBgCategory, title: newBgTitle.trim() });
      setBackgrounds((prev) => [created, ...prev]);
      setSelectedBgIds((prev) => new Set([...prev, created.id]));
      setNewBgTitle("");
    } catch {
      // ignore
    } finally {
      setBgBusy(false);
    }
  }

  // Delete a background from the list
  async function handleDeleteBackground(id: string) {
    await removeBackground(id).catch(() => {});
    setBackgrounds((prev) => prev.filter((bg) => bg.id !== id));
    setSelectedBgIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // Background → KR loading: suggest KRs + parse metrics
  async function handleConfirmBackground() {
    setStep("kr-loading");
    try {
      const selectedBgs = backgrounds.filter((bg) => selectedBgIds.has(bg.id));
      const bgContext =
        selectedBgs.length > 0
          ? selectedBgs
              .map((bg) => `[${bg.category}] ${bg.title}${bg.description ? `：${bg.description}` : ""}`)
              .join("\n")
          : undefined;
      const suggested = await suggestKeyResults(
        apiKey,
        model,
        language,
        refined.title,
        refined.motivation,
        undefined,
        bgContext
      );

      // Parse each KR into structured fields in parallel
      const parsed = await Promise.all(
        suggested.map(async (title) => {
          try {
            const m = await parseKRMetrics(apiKey, model, title);
            return {
              title,
              originalTitle: title,
              metricName: m.metricName ?? "",
              targetValue: m.targetValue ?? null,
              unit: m.unit ?? "",
              deadline: m.deadline ?? null,
            };
          } catch {
            return { title, originalTitle: title, metricName: "", targetValue: null, unit: "", deadline: null };
          }
        })
      );

      setParsedKrs(parsed);
      setStep("confirm-kr");
    } catch {
      setError("推薦 KR 失敗，請重試");
      setStep("background");
    }
  }

  // Step 4 → 5: generate snapshot + save (no SMART conversion needed — user already set structured fields)
  async function handleConfirmKRs() {
    const filled = parsedKrs.filter((k) => k.title.trim());
    if (filled.length === 0) return;
    setStep("saving");
    setError("");
    try {
      const snapshot = await generateSnapshot(
        apiKey,
        model,
        language,
        refined.title,
        refined.motivation,
        refined.okrType,
        refined.timeframe,
        filled.map((k) => k.title)
      );

      const keyResults: KeyResult[] = filled.map((kr) => ({
        id: uuid(),
        title: kr.title,
        description: "",
        ...(kr.metricName ? { metricName: kr.metricName } : {}),
        ...(kr.targetValue != null ? { targetValue: kr.targetValue } : {}),
        ...(kr.unit ? { unit: kr.unit } : {}),
        ...(kr.deadline ? { deadline: kr.deadline } : {}),
      }));

      const meta: OKRMeta = {
        okrType: refined.okrType,
        timeframe: refined.timeframe,
        motivation: refined.motivation,
        snapshot,
      };

      const objective: Objective = {
        id: uuid(),
        title: refined.title,
        description: "",
        keyResults,
        createdAt: new Date().toISOString(),
        meta,
      };

      await saveObjective(objective);
      setSavedObjective(objective);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗，請重試");
      setStep("confirm-kr");
    }
  }

  function updateParsedKR(index: number, field: keyof ParsedKR, value: string | number | null) {
    setParsedKrs((prev) => prev.map((k, i) => (i === index ? { ...k, [field]: value } : k)));
  }

  function removeParsedKR(index: number) {
    setParsedKrs((prev) => prev.filter((_, i) => i !== index));
  }

  function addParsedKR() {
    setParsedKrs((prev) => [
      ...prev,
      { title: "", originalTitle: "", metricName: "", targetValue: null, unit: "", deadline: null },
    ]);
  }

  async function handleRefineKR(index: number) {
    if (!refineInstruction.trim()) return;
    setRefineLoading(true);
    try {
      const revised = await refineKRTitle(
        apiKey,
        model,
        language,
        refined.title,
        parsedKrs[index].title,
        refineInstruction
      );
      updateParsedKR(index, "title", revised);
      setRefineOpenIdx(null);
      setRefineInstruction("");
    } catch {
      // leave panel open so user can retry
    } finally {
      setRefineLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (step === "done" && savedObjective) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 md:px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white text-xl mb-4">
            ◎
          </div>
          <h1 className="text-xl font-semibold">目標已建立</h1>
          <p className="text-sm text-gray-400 mt-1">{savedObjective.title}</p>
        </div>

        {savedObjective.meta?.snapshot && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6">
            <p className="text-xs font-medium text-indigo-600 mb-1">設定背景</p>
            <Markdown className="text-sm text-indigo-800 leading-relaxed">
              {savedObjective.meta.snapshot}
            </Markdown>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-2">
          <p className="text-xs font-medium text-gray-500 mb-3">已設定的 KR</p>
          {savedObjective.keyResults.map((kr, i) => (
            <div key={kr.id} className="flex gap-2 text-sm">
              <span className="text-gray-400 shrink-0">KR{i + 1}</span>
              <span>{kr.title}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => router.push("/okr")}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            查看所有目標
          </button>
          <button
            onClick={() => {
              setStep("input");
              setRawInput("");
              setParsedKrs([]);
              setError("");
            }}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            再新增一個
          </button>
        </div>
      </div>
    );
  }

  if (step === "saving") {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 md:px-6 text-center">
        <div className="text-4xl mb-4 animate-pulse">◎</div>
        <p className="text-sm text-gray-500">正在生成設定背景快照…</p>
      </div>
    );
  }

  if (step === "kr-loading") {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 md:px-6 text-center">
        <div className="text-4xl mb-4 animate-pulse">◎</div>
        <p className="text-sm text-gray-500">AI 正在推薦 Key Results 並分析指標…</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {(["input", "confirm-o", "background", "confirm-kr"] as const).map((s, i) => {
          const stepOrder = ["input", "confirm-o", "background", "confirm-kr", "saving", "done"];
          const currentIdx = stepOrder.indexOf(step);
          const done = currentIdx > i;
          const active = step === s;
          return (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  active
                    ? "bg-indigo-600 text-white"
                    : done
                    ? "bg-indigo-100 text-indigo-600"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {i + 1}
              </div>
              {i < 3 && <div className="flex-1 h-px bg-gray-200 w-6" />}
            </div>
          );
        })}
        <span className="text-xs text-gray-400 ml-1">
          {step === "input"
            ? "描述目標"
            : step === "confirm-o"
            ? "確認目標"
            : step === "background"
            ? "背景經歷"
            : "設定 KR"}
        </span>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* ── Step 1: Input ── */}
      {step === "input" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold mb-1">新增目標</h1>
            <p className="text-sm text-gray-500">用一句話說出你想達成什麼，AI 幫你整理成清楚的 OKR</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="例：我想在這一季內把英文口說練到能流暢開會"
              rows={4}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-gray-50"
            />
            <button
              onClick={handleRefine}
              disabled={!rawInput.trim()}
              className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              分析目標 →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Confirm O ── */}
      {step === "confirm-o" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold mb-1">確認目標</h1>
            <p className="text-sm text-gray-500">AI 根據你的描述推測了以下內容，確認或修改後繼續</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">目標名稱</label>
              <input
                value={refined.title}
                onChange={(e) => setRefined((r) => ({ ...r, title: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">設定這個目標的動機</label>
              <textarea
                value={refined.motivation}
                onChange={(e) => setRefined((r) => ({ ...r, motivation: e.target.value }))}
                rows={2}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">目標類型</label>
              <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
                {(["committed", "aspirational"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setRefined((r) => ({ ...r, okrType: t }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      refined.okrType === t ? "bg-white shadow-sm text-gray-900" : "text-gray-400"
                    }`}
                  >
                    {t === "committed" ? "承諾型（必達）" : "願景型（挑戰）"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                {refined.okrType === "committed"
                  ? "承諾型：預期得分 1.0，未達成需要檢討"
                  : "願景型：預期得分 0.7，鼓勵挑戰極限"}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">時間範圍</label>
              <div className="flex gap-2 flex-wrap">
                {TIMEFRAME_OPTIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setRefined((r) => ({ ...r, timeframe: t }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      refined.timeframe === t
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "border-gray-200 text-gray-600 hover:border-indigo-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("input")}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ← 修改
            </button>
            <button
              onClick={handleConfirmO}
              disabled={!refined.title.trim()}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              確認，設定 KR →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Background ── */}
      {step === "background" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold mb-1">相關背景經歷</h1>
            <p className="text-sm text-gray-500">
              選擇與這個目標相關的背景，幫助 AI 推薦更符合你能力的 KR
            </p>
          </div>

          {/* Existing backgrounds */}
          {backgrounds.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
              <p className="text-xs font-medium text-gray-500 mb-3">已儲存的背景（勾選相關的）</p>
              {backgrounds.map((bg) => (
                <div key={bg.id} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedBgIds.has(bg.id)}
                    onChange={(e) => {
                      setSelectedBgIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(bg.id);
                        else next.delete(bg.id);
                        return next;
                      });
                    }}
                    className="mt-1 accent-indigo-600 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-indigo-600 font-medium mr-1.5">[{bg.category}]</span>
                    <span className="text-sm text-gray-800">{bg.title}</span>
                    {bg.description && (
                      <p className="text-xs text-gray-400 mt-0.5">{bg.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteBackground(bg.id)}
                    className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-lg leading-none mt-0.5"
                    title="刪除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Inline add */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <p className="text-xs font-medium text-gray-500">快速新增背景</p>
            <div className="flex flex-wrap gap-2">
              {BG_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewBgCategory(c)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    newBgCategory === c
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "border-gray-200 text-gray-600 hover:border-indigo-300"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newBgTitle}
                onChange={(e) => setNewBgTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddBackground();
                  }
                }}
                placeholder="例：3 年 Python 開發經驗"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
              />
              <button
                type="button"
                onClick={handleAddBackground}
                disabled={bgBusy || !newBgTitle.trim()}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {bgBusy ? "…" : "新增"}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("confirm-o")}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ← 修改
            </button>
            <button
              onClick={handleConfirmBackground}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              {selectedBgIds.size > 0
                ? `帶入 ${selectedBgIds.size} 筆背景，推薦 KR →`
                : "跳過，直接推薦 KR →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Confirm KRs (structured table view) ── */}
      {step === "confirm-kr" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold mb-1">設定 Key Results</h1>
            <p className="text-sm text-gray-500">
              AI 已推薦並解析以下 KR，可直接修改各欄位後確認
            </p>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-medium text-indigo-600 px-1">{refined.title}</p>

            {parsedKrs.map((kr, i) => (
              <div
                key={i}
                className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
              >
                {/* KR header */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                    KR {i + 1}
                  </span>
                  <button
                    onClick={() => removeParsedKR(i)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                    title="刪除此 KR"
                  >
                    ×
                  </button>
                </div>

                {/* Full KR title */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400">目標描述</label>
                    <button
                      type="button"
                      onClick={() => {
                        if (refineOpenIdx === i) {
                          setRefineOpenIdx(null);
                          setRefineInstruction("");
                        } else {
                          setRefineOpenIdx(i);
                          setRefineInstruction("");
                        }
                      }}
                      className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                    >
                      {refineOpenIdx === i ? "取消" : "✦ AI 調整"}
                    </button>
                  </div>
                  <input
                    value={kr.title}
                    onChange={(e) => updateParsedKR(i, "title", e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  />
                  {/* Original AI suggestion for reference */}
                  {kr.originalTitle && kr.title !== kr.originalTitle && (
                    <p className="text-xs text-gray-400">
                      AI 原版：
                      <button
                        type="button"
                        onClick={() => updateParsedKR(i, "title", kr.originalTitle)}
                        className="text-indigo-400 hover:text-indigo-600 underline ml-1"
                      >
                        {kr.originalTitle}
                      </button>
                    </p>
                  )}
                </div>

                {/* Inline AI refinement panel */}
                {refineOpenIdx === i && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs text-indigo-600 font-medium">告訴 AI 你想如何調整這條 KR</p>
                    <textarea
                      value={refineInstruction}
                      onChange={(e) => setRefineInstruction(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleRefineKR(i);
                        }
                      }}
                      placeholder="例：把數字改小一點、加上具體截止月份、換成更積極的動詞…"
                      rows={2}
                      className="w-full text-xs border border-indigo-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleRefineKR(i)}
                      disabled={refineLoading || !refineInstruction.trim()}
                      className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                    >
                      {refineLoading ? "AI 修改中…" : "送出（Enter）"}
                    </button>
                  </div>
                )}

                {/* Structured metric fields */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">指標名稱</label>
                    <input
                      value={kr.metricName}
                      onChange={(e) => updateParsedKR(i, "metricName", e.target.value)}
                      placeholder="例：完成篇數"
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">目標值</label>
                    <input
                      type="number"
                      value={kr.targetValue ?? ""}
                      onChange={(e) =>
                        updateParsedKR(i, "targetValue", e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="例：10"
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">單位</label>
                    <input
                      value={kr.unit}
                      onChange={(e) => updateParsedKR(i, "unit", e.target.value)}
                      placeholder="例：篇、小時、%"
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                    />
                  </div>
                </div>

                {/* Deadline */}
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">截止日期（選填）</label>
                  <input
                    type="date"
                    value={kr.deadline ?? ""}
                    onChange={(e) => updateParsedKR(i, "deadline", e.target.value || null)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  />
                </div>
              </div>
            ))}

            <button
              onClick={addParsedKR}
              className="text-xs text-indigo-500 hover:text-indigo-700 font-medium px-1"
            >
              + 新增 KR
            </button>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("confirm-o")}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ← 修改
            </button>
            <button
              onClick={handleConfirmKRs}
              disabled={parsedKrs.filter((k) => k.title.trim()).length === 0}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              確認並完成設定 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
