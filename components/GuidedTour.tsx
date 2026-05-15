"use client";

import { useState, useEffect } from "react";

interface TourStepDef {
  title: string;
  body: string;
  targetId: string;
}

const STEPS_ZH: TourStepDef[] = [
  {
    title: "驗證一個想法",
    body: "輸入任何你最近在考慮的事，按「分析」，AI 會對照你的目標打分數。試著分析一個再繼續——這是這個工具最核心的功能。",
    targetId: "tour-idea-validator",
  },
  {
    title: "加入行動計畫",
    body: "驗證值得做的想法，可以在這裡排進待辦清單追蹤進度。先加一條任務，週末就能產出對齊報告。",
    targetId: "tour-todo-planner",
  },
  {
    title: "產出本週報告",
    body: "一週結束後，點這裡讓 AI 根據你的任務完成狀況和目標產出對齊報告，清楚看到這週的行動和目標差多遠。",
    targetId: "tour-generate-report",
  },
  {
    title: "設定你的目標",
    body: "目標是所有 AI 分析的基準。前往「目標」頁設定 OKR，AI 才能對照你的行動給出有意義的分析。",
    targetId: "tour-okr-nav",
  },
];

const STEPS_EN: TourStepDef[] = [
  {
    title: "Validate an Idea",
    body: "Enter anything you've been thinking about and hit \"Analyze\". AI scores it against your goals. Try one before moving on — this is the core feature.",
    targetId: "tour-idea-validator",
  },
  {
    title: "Plan Your Actions",
    body: "Verified ideas worth pursuing can go here as tasks. Add one task to start tracking your week and unlock the weekly report.",
    targetId: "tour-todo-planner",
  },
  {
    title: "Generate Weekly Report",
    body: "At the end of the week, click here to get an AI report on how well your completed actions aligned with your goals.",
    targetId: "tour-generate-report",
  },
  {
    title: "Set Your Goals",
    body: "Goals are the baseline for all AI analysis. Go to the \"Goals\" page to set your OKRs so AI can give you meaningful insights.",
    targetId: "tour-okr-nav",
  },
];

const PAD = 14;

interface ElemRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function calcTooltipStyle(r: ElemRect): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(300, vw - 32);
  const estimatedH = 210;
  const left = Math.max(16, Math.min(r.left, vw - w - 16));
  const spaceBelow = vh - (r.top + r.height + PAD);
  const spaceAbove = r.top - PAD;

  if (spaceBelow >= estimatedH + 8) {
    return { top: r.top + r.height + PAD + 8, left, width: w };
  }
  if (spaceAbove >= estimatedH + 8) {
    return { bottom: vh - r.top + PAD + 8, left, width: w };
  }
  // fallback: stick to bottom above nav
  return { bottom: 72, left: 16, right: 16, width: "auto" };
}

interface Props {
  step: number;
  language: "zh-TW" | "en";
  onAdvance: () => void;
  onComplete: () => void;
  canAdvance?: boolean;
  canAdvanceHint?: string;
}

export default function GuidedTour({
  step,
  language,
  onAdvance,
  onComplete,
  canAdvance = true,
  canAdvanceHint,
}: Props) {
  const zh = language === "zh-TW";
  const steps = zh ? STEPS_ZH : STEPS_EN;
  const current = steps[step];
  const total = steps.length;
  const [rect, setRect] = useState<ElemRect | null>(null);

  // Track element position on scroll/resize
  useEffect(() => {
    function update() {
      const el = document.getElementById(current.targetId);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
      } else {
        setRect(null);
      }
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [step, current.targetId]);

  // Scroll target into view
  useEffect(() => {
    const el = document.getElementById(current.targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [step, current.targetId]);

  const tooltipStyle = rect ? calcTooltipStyle(rect) : { bottom: 72, left: 16, right: 16 };
  const isLast = step === total - 1;

  return (
    <>
      {/* Dimmed overlay with SVG spotlight hole — pointer-events: none so user can still interact */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 50 }}>
        <svg xmlns="http://www.w3.org/2000/svg" className="absolute inset-0" width="100%" height="100%">
          <defs>
            <mask id="tour-spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              {rect && (
                <rect
                  x={rect.left - PAD}
                  y={rect.top - PAD}
                  width={rect.width + PAD * 2}
                  height={rect.height + PAD * 2}
                  rx="14"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.62)"
            mask="url(#tour-spotlight-mask)"
          />
        </svg>
      </div>

      {/* Tooltip card — positioned near the highlighted element */}
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
        style={{ ...tooltipStyle, position: "fixed", zIndex: 52 }}
      >
        {/* Progress bar */}
        <div className="h-0.5 bg-gray-100">
          <div
            className="h-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>

        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">
                {zh ? `步驟 ${step + 1} / ${total}` : `Step ${step + 1} of ${total}`}
              </p>
              <h3 className="text-sm font-semibold text-gray-900 mt-0.5">{current.title}</h3>
            </div>
            <button
              onClick={isLast ? onComplete : onAdvance}
              className="text-xs text-gray-300 hover:text-gray-500 transition-colors shrink-0"
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
                  i === step
                    ? "w-4 bg-indigo-500"
                    : i < step
                    ? "w-1 bg-indigo-300"
                    : "w-1 bg-gray-200"
                }`}
              />
            ))}
          </div>

          {/* Advance button */}
          <div className="space-y-1.5">
            {!canAdvance && canAdvanceHint && (
              <p className="text-[11px] text-amber-600 text-center">{canAdvanceHint}</p>
            )}
            <button
              onClick={isLast ? onComplete : onAdvance}
              disabled={!canAdvance}
              className="w-full py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isLast
                ? zh
                  ? "開始使用 ✓"
                  : "Let's go ✓"
                : zh
                ? "明白了 →"
                : "Got it →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
