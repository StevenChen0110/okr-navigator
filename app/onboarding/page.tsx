"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, Role } from "@/lib/types";
import { saveObjective, saveRole } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useLanguage } from "@/components/LanguageProvider";
import { getSettings, saveSettings, saveUserProfile } from "@/lib/storage";

type Step = 1 | 2 | 3 | 4 | 5;

const PREDEFINED_ROLES = [
  { emoji: "💼", nameZh: "職業工作者", nameEn: "Professional", descZh: "職涯成長與工作成就", descEn: "Career growth" },
  { emoji: "🎓", nameZh: "學習成長", nameEn: "Learner", descZh: "技能學習與知識積累", descEn: "Skills & knowledge" },
  { emoji: "🚀", nameZh: "創業者", nameEn: "Entrepreneur", descZh: "產品打造與商業發展", descEn: "Building a venture" },
  { emoji: "👨‍👩‍👧", nameZh: "家庭角色", nameEn: "Family", descZh: "家庭關係與親子陪伴", descEn: "Family & relationships" },
  { emoji: "💪", nameZh: "健康生活", nameEn: "Health", descZh: "身心健康與生活品質", descEn: "Health & wellness" },
  { emoji: "🌟", nameZh: "個人成就", nameEn: "Personal", descZh: "個人目標與自我實現", descEn: "Personal growth" },
];


export default function OnboardingPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const zh = language === "zh-TW";

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 2: Role selection
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());

  // Step 3: Intent input
  const [intentInput, setIntentInput] = useState("");
  const [draftObjective, setDraftObjective] = useState<{ title: string; timeframe: string } | null>(null);

  // Step 4: OKR confirmation
  const [confirmedTitle, setConfirmedTitle] = useState("");
  const [krInputs, setKrInputs] = useState(["", "", ""]);
  const [savedObjective, setSavedObjective] = useState<Objective | null>(null);

  // Step 5: Profile
  const [profileStatement, setProfileStatement] = useState("");

  function toggleRole(i: number) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(i)) { next.delete(i); }
      else if (next.size < 3) { next.add(i); }
      return next;
    });
  }

  async function handleRolesConfirm() {
    if (selectedRoles.size > 0) {
      try {
        for (const i of selectedRoles) {
          const r = PREDEFINED_ROLES[i];
          const role: Role = {
            id: uuid(),
            name: zh ? r.nameZh : r.nameEn,
            emoji: r.emoji,
            layer: 0,
            inferred: false,
            userConfirmed: true,
            weight: 1.0,
            description: zh ? r.descZh : r.descEn,
            createdAt: new Date().toISOString(),
          };
          await saveRole(role);
        }
      } catch {
        // silently continue if not yet logged in
      }
    }
    setStep(3);
  }

  async function handleIntentSubmit() {
    if (!intentInput.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await callAI<{ title: string; timeframe: string }>("refineObjective", { rawInput: intentInput });
      setDraftObjective(result);
      setConfirmedTitle(result.title);
      try {
        const suggested = await callAI<string[]>("suggestKeyResults", { objectiveTitle: result.title, existingKRs: [] });
        setKrInputs([...suggested.slice(0, 3), "", "", ""].slice(0, 3));
      } catch {
        setKrInputs(["", "", ""]);
      }
      setStep(4);
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
        const suggested = await callAI<string[]>("suggestKeyResults", { objectiveTitle: confirmedTitle, existingKRs: [] });
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
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleComplete() {
    if (profileStatement.trim()) {
      saveUserProfile({ statement: profileStatement.trim(), createdAt: new Date().toISOString() });
    }
    saveSettings({ ...getSettings(), onboardingCompleted: true });
    router.push("/tasks");
  }

  // Steps 2-5 shown in progress bar
  const progressPercent = step <= 1 ? 0 : Math.round(((step - 1) / 4) * 100);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-8">

        {/* Progress bar */}
        {step > 1 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>{zh ? `步驟 ${step - 1} / 4` : `Step ${step - 1} of 4`}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
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
              {zh ? "開始，只要 4 步驟 →" : "Get started, just 4 steps →"}
            </button>
          </div>
        )}

        {/* Step 2: Role selection */}
        {step === 2 && (
          <div className="step-enter space-y-5">
            <div className="flex items-start gap-3 bg-purple-50 border border-purple-100 rounded-xl px-4 py-3">
              <span className="text-xl mt-0.5">🎭</span>
              <div>
                <p className="text-xs font-semibold text-purple-700">{zh ? "選 1–3 個角色" : "Pick 1–3 roles"}</p>
                <p className="text-[11px] text-purple-500 mt-0.5 leading-snug">
                  {zh ? "AI 會根據你的角色給出更個人化的分析" : "AI uses your roles to personalize analysis"}
                </p>
              </div>
            </div>
            <h2 className="text-xl font-semibold text-gray-900">
              {zh ? "你目前在扮演什麼角色？" : "What roles are you playing right now?"}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {PREDEFINED_ROLES.map((r, i) => {
                const selected = selectedRoles.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => toggleRole(i)}
                    className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                      selected ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <span className="text-2xl">{r.emoji}</span>
                    <div>
                      <p className={`text-xs font-semibold ${selected ? "text-indigo-700" : "text-gray-700"}`}>
                        {zh ? r.nameZh : r.nameEn}
                      </p>
                      <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{zh ? r.descZh : r.descEn}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={handleRolesConfirm}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {selectedRoles.size === 0
                ? (zh ? "跳過 →" : "Skip →")
                : (zh ? `確認 ${selectedRoles.size} 個角色 →` : `Confirm ${selectedRoles.size} role${selectedRoles.size > 1 ? "s" : ""} →`)}
            </button>
          </div>
        )}

        {/* Step 3: Intent input */}
        {step === 3 && (
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

        {/* Step 4: OKR confirmation */}
        {step === 4 && (
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

        {/* Step 5: Profile + Done */}
        {step === 5 && (
          <div className="step-enter space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">
                {zh ? "最後一步：告訴 AI 你是誰" : "Last step: tell AI who you are"}
              </h2>
              <p className="text-sm text-gray-400">
                {zh ? "讓 AI 給你更個人化的分析（選填，之後可修改）" : "Help AI give you more personalized analysis (optional)"}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">
                {zh ? "用一句話形容你現在的狀態" : "Describe your current situation in one sentence"}
              </label>
              <textarea
                value={profileStatement}
                onChange={(e) => setProfileStatement(e.target.value)}
                placeholder={zh
                  ? "例如：在科技業工作 3 年，想轉型做自己的產品"
                  : "e.g. 3 years in tech, trying to build my own product on the side"}
                rows={2}
                autoFocus
                className="w-full rounded-xl border border-indigo-200 bg-indigo-50/20 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white resize-none transition-colors"
              />
              <p className="text-[11px] text-gray-400">
                {zh ? "這句話會讓 AI 分析時帶入你的背景脈絡" : "AI will use this as context when analyzing your ideas"}
              </p>
            </div>

            {savedObjective && (
              <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 space-y-1">
                <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest">
                  {zh ? "已建立的目標" : "Goal created"}
                </p>
                <p className="text-sm font-medium text-indigo-800">{savedObjective.title}</p>
                <p className="text-xs text-indigo-500">
                  {savedObjective.keyResults.length} {zh ? "個關鍵結果" : "key results"}
                </p>
              </div>
            )}

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
