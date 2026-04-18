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
  classifying?: boolean; // AI in progress
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
  const [title, setTitle] = useState("");
  const [okrType, setOkrType] = useState<"committed" | "aspirational">("committed");
  const [timeframe, setTimeframe] = useState("本季");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [krs, setKrs] = useState<KRDraft[]>([newKRDraft()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-xl font-semibold mb-1">新增目標</h1>
      <p className="text-sm text-gray-500 mb-8">設定你的目標與量化指標</p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Objective */}
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
              <button
                key={t}
                onClick={() => setOkrType(t)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  okrType === t ? "bg-white shadow-sm text-gray-900" : "text-gray-400"
                }`}
              >
                {t === "committed" ? "承諾型（必達）" : "願景型（挑戰）"}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            {okrType === "committed"
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
                onClick={() => setTimeframe(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  timeframe === t
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-200 text-gray-600 hover:border-indigo-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">優先級</label>
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  priority === p
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-200 text-gray-600 hover:border-indigo-300"
                }`}
              >
                P{p}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">影響 Dashboard Idea 排序的加權係數（P1 最高）</p>
        </div>
      </div>

      {/* KRs */}
      <div className="space-y-3 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 px-1">量化指標（Key Results）</h2>
        {krs.map((kr, i) => (
          <div key={kr.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                KR {i + 1}
              </span>
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
                  <button
                    onClick={() => removeKR(kr.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400">描述</label>
              <input
                value={kr.title}
                onChange={(e) => updateKR(kr.id, "title", e.target.value)}
                onBlur={() => handleKRTitleBlur(kr)}
                placeholder="例：每週完成 2 次英語練習課程"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
              />
              {!kr.classifying && !kr.krType && kr.title.trim() && title.trim() && (
                <p className="text-xs text-gray-400">離開欄位後 AI 將自動設定類型與測量方式</p>
              )}
            </div>

            {/* KR Type — shown after AI fills or user edits */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">KR 類型</label>
                {kr.classifying && <span className="text-xs text-indigo-300">偵測中…</span>}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {KR_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateKR(kr.id, "krType", opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      kr.krType === opt.value
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "border-gray-200 text-gray-600 hover:border-indigo-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                {KR_TYPE_OPTIONS.find((o) => o.value === kr.krType)?.desc}
              </p>
            </div>

            {kr.krType !== "milestone" && (
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">指標名稱</label>
                  <input
                    value={kr.metricName}
                    onChange={(e) => updateKR(kr.id, "metricName", e.target.value)}
                    placeholder="練習次數"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">目標值</label>
                  <input
                    type="number"
                    min={0}
                    value={kr.targetValue}
                    onChange={(e) => updateKR(kr.id, "targetValue", e.target.value)}
                    placeholder="24"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">單位</label>
                  <input
                    value={kr.unit}
                    onChange={(e) => updateKR(kr.id, "unit", e.target.value)}
                    placeholder="次"
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  />
                </div>
              </div>
            )}

            {kr.krType === "cumulative" && (
              <div className="space-y-1">
                <label className="text-xs text-gray-400">每個 Task 完成貢獻值</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={kr.incrementPerTask}
                    onChange={(e) => updateKR(kr.id, "incrementPerTask", e.target.value)}
                    placeholder="1"
                    className="w-24 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                  />
                  <span className="text-xs text-gray-400">{kr.unit || "單位"} / Task</span>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-gray-400">截止日期（選填）</label>
              <input
                type="date"
                value={kr.deadline}
                onChange={(e) => updateKR(kr.id, "deadline", e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
              />
            </div>
          </div>
        ))}
        <button
          onClick={addKR}
          className="text-xs text-indigo-500 hover:text-indigo-700 font-medium px-1"
        >
          + 新增 KR
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => router.push("/okr")}
          className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          取消
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
