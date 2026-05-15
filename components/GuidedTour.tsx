"use client";

import { useEffect } from "react";

interface TourStepDef {
  title: string;
  body: string;
  targetId: string;
}

const STEPS_ZH: TourStepDef[] = [
  {
    title: "週記錄 → 對齊報告",
    body: "每週在這裡自由輸入做了什麼，AI 整理成行動清單後，一鍵產出和目標的對齊報告。",
    targetId: "tour-weekly-log",
  },
  {
    title: "驗證新想法",
    body: "有新想法嗎？輸入進想法驗證，AI 評估它對你目標的幫助程度，再決定要不要做。",
    targetId: "tour-idea-validator",
  },
  {
    title: "先設定你的目標",
    body: "目標是所有分析的基準。點底部「目標」，設定 OKR，AI 才知道拿什麼來對照你的行動。",
    targetId: "tour-okr-nav",
  },
];

const STEPS_EN: TourStepDef[] = [
  {
    title: "Weekly Log → Alignment Report",
    body: "Each week, type what you did here in free-form. AI organizes it into action items and generates a report on how well you aligned with your goals.",
    targetId: "tour-weekly-log",
  },
  {
    title: "Validate New Ideas",
    body: "Have a new idea? Enter it in the Idea Validator. AI scores how much it helps your goals so you can decide whether to pursue it.",
    targetId: "tour-idea-validator",
  },
  {
    title: "Set Your Goals First",
    body: "Goals are the baseline for all AI analysis. Tap \"Goals\" to set your OKRs so AI knows what to compare your actions against.",
    targetId: "tour-okr-nav",
  },
];

interface Props {
  step: number;
  language: "zh-TW" | "en";
  onAdvance: () => void;
  onComplete: () => void;
}

export default function GuidedTour({ step, language, onAdvance, onComplete }: Props) {
  const steps = language === "zh-TW" ? STEPS_ZH : STEPS_EN;
  const zh = language === "zh-TW";
  const current = steps[step];
  const total = steps.length;

  useEffect(() => {
    const el = document.getElementById(current.targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("tour-highlight");
    return () => el.classList.remove("tour-highlight");
  }, [step, current.targetId]);

  return (
    <div className="fixed bottom-20 md:bottom-6 inset-x-4 md:inset-x-auto md:right-6 md:w-72 bg-white rounded-2xl shadow-xl border border-indigo-100 z-50 overflow-hidden">
      {/* Progress bar */}
      <div className="h-0.5 bg-gray-100">
        <div
          className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${((step + 1) / total) * 100}%` }}
        />
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5 flex-1">
            <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">
              {zh ? `步驟 ${step + 1} / ${total}` : `Step ${step + 1} of ${total}`}
            </p>
            <h3 className="text-sm font-semibold text-gray-900">{current.title}</h3>
          </div>
          <button
            onClick={onComplete}
            className="text-xs text-gray-300 hover:text-gray-500 transition-colors shrink-0 mt-0.5"
          >
            {zh ? "跳過" : "Skip"}
          </button>
        </div>

        <p className="text-xs text-gray-600 leading-relaxed">{current.body}</p>

        {/* Step dots */}
        <div className="flex gap-1 justify-center">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === step ? "w-4 bg-indigo-500" : i < step ? "w-1 bg-indigo-300" : "w-1 bg-gray-200"
              }`}
            />
          ))}
        </div>

        <button
          onClick={step === total - 1 ? onComplete : onAdvance}
          className="w-full py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
        >
          {step === total - 1
            ? (zh ? "開始使用 ✓" : "Let's go ✓")
            : (zh ? "明白了 →" : "Got it →")}
        </button>
      </div>
    </div>
  );
}
