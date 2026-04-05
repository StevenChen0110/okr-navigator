"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, OKRMeta } from "@/lib/types";
import { getSettings } from "@/lib/storage";
import { saveObjective } from "@/lib/db";
import {
  refineObjective,
  suggestKeyResults,
  convertAllToSMART,
  generateSnapshot,
  parseKRMetrics,
} from "@/lib/claude";
import Markdown from "@/components/Markdown";

type Step = "input" | "confirm-o" | "kr-loading" | "confirm-kr" | "saving" | "done";

interface RefinedO {
  title: string;
  motivation: string;
  okrType: "committed" | "aspirational";
  timeframe: string;
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
  const [krs, setKrs] = useState<string[]>([]);
  const [savedObjective, setSavedObjective] = useState<Objective | null>(null);
  const [error, setError] = useState("");

  const apiKey = process.env.NEXT_PUBLIC_CLAUDE_API_KEY ?? "";
  const { claudeModel: model, language } = getSettings();

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

  // Step 2 → 3: propose KRs
  async function handleConfirmO() {
    setStep("kr-loading");
    try {
      const suggested = await suggestKeyResults(apiKey, model, language, refined.title, refined.motivation);
      setKrs(suggested);
      setStep("confirm-kr");
    } catch {
      setError("推薦 KR 失敗，請重試");
      setStep("confirm-o");
    }
  }

  // Step 4 → 5: convert to SMART + generate snapshot + save
  async function handleConfirmKRs() {
    const filledKRs = krs.filter((k) => k.trim());
    if (filledKRs.length === 0) return;
    setStep("saving");
    setError("");
    try {
      const [smartKRs, snapshot] = await Promise.all([
        convertAllToSMART(apiKey, model, language, filledKRs, refined.title, refined.timeframe),
        generateSnapshot(apiKey, model, language, refined.title, refined.motivation, refined.okrType, refined.timeframe, filledKRs),
      ]);

      const metrics = await Promise.all(
        smartKRs.map((kr) => parseKRMetrics(apiKey, model, kr).catch(() => null))
      );

      const keyResults: KeyResult[] = smartKRs.map((title, i) => ({
        id: uuid(),
        title,
        description: "",
        ...(metrics[i] ?? {}),
        deadline: metrics[i]?.deadline ?? undefined,
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

  function updateKR(index: number, value: string) {
    setKrs((prev) => prev.map((k, i) => (i === index ? value : k)));
  }

  function removeKR(index: number) {
    setKrs((prev) => prev.filter((_, i) => i !== index));
  }

  function addKR() {
    setKrs((prev) => [...prev, ""]);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (step === "done" && savedObjective) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 md:px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white text-xl mb-4">◎</div>
          <h1 className="text-xl font-semibold">目標已建立</h1>
          <p className="text-sm text-gray-400 mt-1">{savedObjective.title}</p>
        </div>

        {savedObjective.meta?.snapshot && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6">
            <p className="text-xs font-medium text-indigo-600 mb-1">設定背景</p>
            <Markdown className="text-sm text-indigo-800 leading-relaxed">{savedObjective.meta.snapshot}</Markdown>
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
              setKrs([]);
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
        <p className="text-sm text-gray-500">正在轉換 SMART 格式並生成快照…</p>
      </div>
    );
  }

  if (step === "kr-loading") {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 md:px-6 text-center">
        <div className="text-4xl mb-4 animate-pulse">◎</div>
        <p className="text-sm text-gray-500">AI 正在推薦 Key Results…</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {(["input", "confirm-o", "confirm-kr"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              step === s ? "bg-indigo-600 text-white"
              : (step === "confirm-o" && i === 0) || (step === "confirm-kr" && i <= 1) || (step as string) === "saving" || step === "done"
              ? "bg-indigo-100 text-indigo-600"
              : "bg-gray-100 text-gray-400"
            }`}>{i + 1}</div>
            {i < 2 && <div className="flex-1 h-px bg-gray-200 w-8" />}
          </div>
        ))}
        <span className="text-xs text-gray-400 ml-1">
          {step === "input" ? "描述目標" : step === "confirm-o" ? "確認目標" : "設定 KR"}
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

      {/* ── Step 4: Confirm KRs ── */}
      {step === "confirm-kr" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold mb-1">設定 Key Results</h1>
            <p className="text-sm text-gray-500">
              AI 推薦了以下 KR，可以直接編輯、刪除或新增。確認後 AI 會轉成 SMART 格式
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <p className="text-xs font-medium text-indigo-600">{refined.title}</p>
            {krs.map((kr, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-xs text-gray-400 mt-2.5 shrink-0 w-8">KR{i + 1}</span>
                <input
                  value={kr}
                  onChange={(e) => updateKR(i, e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                />
                <button
                  onClick={() => removeKR(i)}
                  className="mt-2 text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={addKR}
              className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
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
              disabled={krs.filter((k) => k.trim()).length === 0}
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
