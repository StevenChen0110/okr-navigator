"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, OKRMeta } from "@/lib/types";
import { saveObjective } from "@/lib/db";

interface KRDraft {
  id: string;
  title: string;
  metricName: string;
  targetValue: string;
  unit: string;
  deadline: string;
}

const TIMEFRAME_OPTIONS = ["本月", "本季", "半年", "全年"];

function newKRDraft(): KRDraft {
  return { id: uuid(), title: "", metricName: "", targetValue: "", unit: "", deadline: "" };
}

export default function NewOKRPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [okrType, setOkrType] = useState<"committed" | "aspirational">("committed");
  const [timeframe, setTimeframe] = useState("本季");
  const [krs, setKrs] = useState<KRDraft[]>([newKRDraft()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addKR() {
    setKrs((prev) => [...prev, newKRDraft()]);
  }

  function removeKR(id: string) {
    setKrs((prev) => prev.filter((k) => k.id !== id));
  }

  function updateKR(id: string, field: keyof KRDraft, value: string) {
    setKrs((prev) => prev.map((k) => (k.id === id ? { ...k, [field]: value } : k)));
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
        ...(k.metricName.trim() ? { metricName: k.metricName.trim() } : {}),
        ...(k.targetValue ? { targetValue: parseFloat(k.targetValue) } : {}),
        ...(k.unit.trim() ? { unit: k.unit.trim() } : {}),
        ...(k.deadline ? { deadline: k.deadline } : {}),
      }));

      const meta: OKRMeta = { okrType, timeframe };

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
              {krs.length > 1 && (
                <button
                  onClick={() => removeKR(kr.id)}
                  className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                >
                  ×
                </button>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400">描述</label>
              <input
                value={kr.title}
                onChange={(e) => updateKR(kr.id, "title", e.target.value)}
                placeholder="例：每週完成 2 次英語練習課程"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
              />
            </div>

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
