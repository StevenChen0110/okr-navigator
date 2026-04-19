"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, OKRMeta, KRType } from "@/lib/types";
import { saveObjective } from "@/lib/db";
import { KRClassification } from "@/lib/claude";
import { callAI } from "@/lib/ai-client";

interface KRDraft {
  id: string;
  title: string;
  krType: KRType;
  metricName: string;
  targetValue: string;
  unit: string;
  deadline: string;
  incrementPerTask: string;
  classifying?: boolean;
}

const TIMEFRAME_OPTIONS = ["本月", "本季", "半年", "全年"];

function newKRDraft(): KRDraft {
  return { id: uuid(), title: "", krType: "cumulative", metricName: "", targetValue: "", unit: "", deadline: "", incrementPerTask: "1" };
}

const KR_TYPE_OPTIONS: { value: KRType; label: string; desc: string }[] = [
  { value: "cumulative", label: "累積型", desc: "每完成一個 Task 自動累加（次、本、小時）" },
  { value: "measurement", label: "測量型", desc: "追蹤變動數值，完成 Task 時手動填入（營收、分數）" },
  { value: "milestone", label: "里程碑型", desc: "只有完成/未完成，無需數值（取得證照、完成上線）" },
];

export default function NewOKRPage() {
  const router = useRouter();

  // ── Manual form state ──────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [okrType, setOkrType] = useState<"committed" | "aspirational">("committed");
  const [timeframe, setTimeframe] = useState("本季");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [krs, setKrs] = useState<KRDraft[]>([newKRDraft()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── AI guided mode state ───────────────────────────────────────────────────
  const [aiMode, setAiMode] = useState(false);
  const [aiStep, setAiStep] = useState<0 | 1 | 2 | 3>(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [rawGoal, setRawGoal] = useState("");
  const [suggestedKRs, setSuggestedKRs] = useState<string[]>([]);
  const [checkedKRs, setCheckedKRs] = useState<Set<number>>(new Set());

  // ── Manual form helpers ────────────────────────────────────────────────────

  function addKR() {
    setKrs((prev) => [...prev, newKRDraft()]);
  }

  function removeKR(id: string) {
    setKrs((prev) => prev.filter((k) => k.id !== id));
  }

  function updateKR(id: string, field: keyof KRDraft, value: string | boolean) {
    setKrs((prev) => prev.map((k) => (k.id === id ? { ...k, [field]: value } : k)));
  }

  async function handleKRTitleBlur(kr: KRDraft) {
    if (!kr.title.trim() || !title.trim()) return;
    updateKR(kr.id, "classifying", true);
    try {
      const result = await callAI<KRClassification>("classifyKR", { krTitle: kr.title, objectiveTitle: title });
      setKrs((prev) =>
        prev.map((k) =>
          k.id === kr.id
            ? {
                ...k,
                classifying: false,
                krType: result.krType,
                metricName: result.metricName ?? "",
                targetValue: result.targetValue != null ? String(result.targetValue) : "",
                unit: result.unit ?? "",
                deadline: result.deadline ?? "",
                incrementPerTask: result.incrementPerTask != null ? String(result.incrementPerTask) : "1",
              }
            : k
        )
      );
    } catch {
      updateKR(kr.id, "classifying", false);
    }
  }

  async function handleSave() {
    if (!title.trim()) return;
    const filledKRs = krs.filter((k) => k.title.trim());
    if (filledKRs.length === 0) {
      setError("請至少填寫一條 KR");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const keyResults: KeyResult[] = filledKRs.map((k) => ({
        id: k.id,
        title: k.title.trim(),
        krType: k.krType,
        ...(k.metricName.trim() ? { metricName: k.metricName.trim() } : {}),
        ...(k.krType !== "milestone" && k.targetValue ? { targetValue: parseFloat(k.targetValue) } : {}),
        ...(k.unit.trim() ? { unit: k.unit.trim() } : {}),
        ...(k.deadline ? { deadline: k.deadline } : {}),
        ...(k.krType === "cumulative" && k.incrementPerTask ? { incrementPerTask: parseFloat(k.incrementPerTask) || 1 } : {}),
      }));

      const meta: OKRMeta = { okrType, timeframe, priority };

      const objective: Objective = {
        id: uuid(),
        title: title.trim(),
        description: "",
        keyResults,
        createdAt: new Date().toISOString(),
        status: "active",
        meta,
      };

      await saveObjective(objective);
      router.push("/okr");
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
      setSaving(false);
    }
  }

  // ── AI guided flow handlers ────────────────────────────────────────────────

  async function handleAiStep1() {
    if (!rawGoal.trim()) return;
    setAiLoading(true);
    try {
      const result = await callAI<{ title: string; motivation: string; okrType: "committed" | "aspirational"; timeframe: string }>(
        "refineObjective", { rawInput: rawGoal }
      );
      setTitle(result.title);
      setOkrType(result.okrType);
      setTimeframe(result.timeframe);
      setAiStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 分析失敗");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiStep2() {
    setAiLoading(true);
    try {
      const results = await callAI<string[]>("suggestKeyResults", { objectiveTitle: title });
      setSuggestedKRs(results);
      setCheckedKRs(new Set(results.map((_, i) => i)));
      setAiStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 建議 KR 失敗");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiStep3() {
    const selected = suggestedKRs.filter((_, i) => checkedKRs.has(i));
    if (selected.length === 0) { setError("請至少選擇一條 KR"); return; }
    setError("");

    const drafts: KRDraft[] = selected.map((t) => ({ ...newKRDraft(), title: t }));
    setKrs(drafts);
    setAiStep(3);

    // Auto-classify each KR
    for (const draft of drafts) {
      try {
        updateKR(draft.id, "classifying", true);
        const result = await callAI<KRClassification>("classifyKR", { krTitle: draft.title, objectiveTitle: title });
        setKrs((prev) =>
          prev.map((k) =>
            k.id === draft.id
              ? {
                  ...k,
                  classifying: false,
                  krType: result.krType,
                  metricName: result.metricName ?? "",
                  targetValue: result.targetValue != null ? String(result.targetValue) : "",
                  unit: result.unit ?? "",
                  deadline: result.deadline ?? "",
                  incrementPerTask: result.incrementPerTask != null ? String(result.incrementPerTask) : "1",
                }
              : k
          )
        );
      } catch {
        updateKR(draft.id, "classifying", false);
      }
    }
  }

  // ── AI Step 0: goal input ──────────────────────────────────────────────────

  if (aiMode && aiStep === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-10">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">AI 幫我想目標</h1>
          <button onClick={() => setAiMode(false)} className="text-xs text-gray-400 hover:text-gray-600">手動填寫</button>
        </div>
        <p className="text-sm text-gray-500 mb-8">用一句話描述你想達成的事，AI 幫你結構化</p>

        {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <textarea
            value={rawGoal}
            onChange={(e) => setRawGoal(e.target.value)}
            placeholder="例：我想在今年內提升英語口說，能流暢地用英文開會和簡報"
            rows={4}
            autoFocus
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          <div className="flex gap-3">
            <button onClick={() => router.push("/okr")} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={handleAiStep1}
              disabled={aiLoading || !rawGoal.trim()}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              {aiLoading ? "AI 分析中…" : "繼續 →"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── AI Step 1: review refined objective ────────────────────────────────────

  if (aiMode && aiStep === 1) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-10">
        <h1 className="text-xl font-semibold mb-1">確認目標</h1>
        <p className="text-sm text-gray-500 mb-8">AI 已整理你的目標，可以直接修改</p>

        {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 mb-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">目標名稱</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">目標類型</label>
            <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
              {(["committed", "aspirational"] as const).map((t) => (
                <button key={t} onClick={() => setOkrType(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${okrType === t ? "bg-white shadow-sm text-gray-900" : "text-gray-400"}`}>
                  {t === "committed" ? "承諾型（必達）" : "願景型（挑戰）"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">時間範圍</label>
            <div className="flex gap-2 flex-wrap">
              {TIMEFRAME_OPTIONS.map((t) => (
                <button key={t} onClick={() => setTimeframe(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${timeframe === t ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-600 hover:border-indigo-300"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">優先級</label>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((p) => (
                <button key={p} onClick={() => setPriority(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${priority === p ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-600 hover:border-indigo-300"}`}>
                  P{p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => setAiStep(0)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">← 返回</button>
          <button onClick={handleAiStep2} disabled={aiLoading || !title.trim()}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">
            {aiLoading ? "AI 建議 KR 中…" : "建議 Key Results →"}
          </button>
        </div>
      </div>
    );
  }

  // ── AI Step 2: pick KRs ────────────────────────────────────────────────────

  if (aiMode && aiStep === 2) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-10">
        <h1 className="text-xl font-semibold mb-1">選擇 Key Results</h1>
        <p className="text-sm text-gray-500 mb-2">AI 建議以下 KR，勾選你想採用的</p>
        <p className="text-xs text-gray-400 mb-6">目標：{title}</p>

        {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50 mb-4">
          {suggestedKRs.map((kr, i) => (
            <label key={i} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={checkedKRs.has(i)}
                onChange={() => setCheckedKRs((prev) => {
                  const s = new Set(prev);
                  if (s.has(i)) s.delete(i); else s.add(i);
                  return s;
                })}
                className="mt-0.5 accent-indigo-600 shrink-0"
              />
              <span className="text-sm text-gray-700">{kr}</span>
            </label>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={() => setAiStep(1)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">← 返回</button>
          <button onClick={handleAiStep3} disabled={checkedKRs.size === 0}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">
            確認並分類 KR →
          </button>
        </div>
      </div>
    );
  }

  // ── Manual form + AI Step 3 (same KR review form) ─────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">{aiMode ? "確認 Key Results" : "新增目標"}</h1>
        {!aiMode && (
          <button onClick={() => { setAiMode(true); setAiStep(0); }} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
            AI 幫我想
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-8">{aiMode ? `目標：${title}` : "設定你的目標與量化指標"}</p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{error}</div>
      )}

      {/* Objective (manual mode only) */}
      {!aiMode && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-700">目標（Objective）</h2>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">目標名稱</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：提升英語口說能力到能流暢開會的程度"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">目標類型</label>
            <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
              {(["committed", "aspirational"] as const).map((t) => (
                <button key={t} onClick={() => setOkrType(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${okrType === t ? "bg-white shadow-sm text-gray-900" : "text-gray-400"}`}>
                  {t === "committed" ? "承諾型（必達）" : "願景型（挑戰）"}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              {okrType === "committed" ? "承諾型：預期得分 1.0，未達成需要檢討" : "願景型：預期得分 0.7，鼓勵挑戰極限"}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">時間範圍</label>
            <div className="flex gap-2 flex-wrap">
              {TIMEFRAME_OPTIONS.map((t) => (
                <button key={t} onClick={() => setTimeframe(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${timeframe === t ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-600 hover:border-indigo-300"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">優先級</label>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((p) => (
                <button key={p} type="button" onClick={() => setPriority(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${priority === p ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-600 hover:border-indigo-300"}`}>
                  P{p}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400">影響 Dashboard Idea 排序的加權係數（P1 最高）</p>
          </div>
        </div>
      )}

      {/* KRs */}
      <div className="space-y-3 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 px-1">完成標準（Key Results）</h2>
        {krs.map((kr, i) => (
          <div key={kr.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">KR {i + 1}</span>
              <div className="flex items-center gap-2">
                {kr.classifying && (
                  <span className="text-xs text-indigo-400 flex items-center gap-1 whitespace-nowrap">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    AI 分析中…
                  </span>
                )}
                {krs.length > 1 && (
                  <button onClick={() => removeKR(kr.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                )}
              </div>
            </div>

            <input
              value={kr.title}
              onChange={(e) => updateKR(kr.id, "title", e.target.value)}
              onBlur={() => handleKRTitleBlur(kr)}
              placeholder="完成後，什麼事情會不一樣？"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
            />

            {/* Show metric target only when AI has determined a non-milestone type */}
            {kr.krType !== "milestone" && (kr.targetValue || kr.unit) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">目標</span>
                <input
                  type="number"
                  min={0}
                  value={kr.targetValue}
                  onChange={(e) => updateKR(kr.id, "targetValue", e.target.value)}
                  placeholder="數值"
                  className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                />
                <input
                  value={kr.unit}
                  onChange={(e) => updateKR(kr.id, "unit", e.target.value)}
                  placeholder="單位"
                  className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                />
              </div>
            )}
          </div>
        ))}
        {!aiMode && (
          <button onClick={addKR} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium px-1">+ 新增 KR</button>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => aiMode ? setAiStep(2) : router.push("/okr")}
          className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          {aiMode ? "← 返回" : "取消"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          {saving ? "儲存中…" : "建立目標"}
        </button>
      </div>
    </div>
  );
}
