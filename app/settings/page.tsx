"use client";

import { useState, useEffect } from "react";
import { getSettings, saveSettings, getEvaluationProfile, saveEvaluationProfile } from "@/lib/storage";
import { AppSettings, EvaluationProfile, EvalMode, EvalPriority } from "@/lib/types";
import {
  MODE_LABELS, MODE_DESCRIPTIONS,
  PRIORITY_LABELS, DEFAULT_EVALUATION_PROFILE,
} from "@/lib/evaluation-prompt";

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "快速模式（Haiku）" },
  { id: "claude-sonnet-4-6", label: "均衡模式（Sonnet）" },
  { id: "claude-opus-4-6", label: "深度分析模式（Opus）" },
];

const ALL_PRIORITIES: EvalPriority[] = ["alignment", "effort", "speed", "growth"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    claudeModel: "claude-haiku-4-5-20251001",
    language: "zh-TW",
  });
  const [profile, setProfile] = useState<EvaluationProfile>(DEFAULT_EVALUATION_PROFILE);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(getSettings());
    setProfile(getEvaluationProfile());
  }, []);

  function handleSave() {
    saveSettings(settings);
    saveEvaluationProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function movePriority(index: number, dir: -1 | 1) {
    const next = [...profile.priorities];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setProfile((p) => ({ ...p, priorities: next }));
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-0.5">設定</h1>
        <p className="text-sm text-gray-500">AI 模型與評估方式</p>
      </div>

      {/* AI Model */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <p className="text-sm font-medium text-gray-700">AI 模型</p>
        <div className="space-y-2">
          <select
            value={settings.claudeModel}
            onChange={(e) => setSettings((s) => ({ ...s, claudeModel: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400">建議一般使用均衡模式</p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">AI 回應語言</label>
          <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
            {(["zh-TW", "en"] as const).map((lang) => (
              <button key={lang}
                onClick={() => setSettings((s) => ({ ...s, language: lang }))}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${settings.language === lang ? "bg-white shadow-sm text-gray-900" : "text-gray-400"}`}>
                {lang === "zh-TW" ? "繁體中文" : "English"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Evaluation Profile */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <div>
          <p className="text-sm font-medium text-gray-700">AI 評估標準</p>
          <p className="text-xs text-gray-400 mt-0.5">工具會根據你的設定，自動產生 AI 的判斷指令</p>
        </div>

        {/* Mode */}
        <div className="space-y-2">
          <label className="text-xs text-gray-500 font-medium block">本季模式</label>
          <div className="grid grid-cols-3 gap-2">
            {(["explore", "execute", "sustain"] as EvalMode[]).map((m) => (
              <button key={m}
                onClick={() => setProfile((p) => ({ ...p, mode: m }))}
                className={`rounded-xl border px-3 py-3 text-left transition-all ${
                  profile.mode === m
                    ? "border-indigo-300 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}>
                <p className={`text-xs font-semibold ${profile.mode === m ? "text-indigo-700" : "text-gray-700"}`}>
                  {MODE_LABELS[m]}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{MODE_DESCRIPTIONS[m]}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Priority order */}
        <div className="space-y-2">
          <label className="text-xs text-gray-500 font-medium block">評估優先順序（從高到低）</label>
          <div className="space-y-1.5">
            {profile.priorities.map((p, i) => (
              <div key={p}
                className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
                <span className="text-xs font-mono text-gray-300 w-4 shrink-0">{i + 1}</span>
                <span className="text-sm text-gray-700 flex-1">{PRIORITY_LABELS[p]}</span>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => movePriority(i, -1)} disabled={i === 0}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors text-xs">
                    ↑
                  </button>
                  <button onClick={() => movePriority(i, 1)} disabled={i === profile.priorities.length - 1}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors text-xs">
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400">順序影響 AI 在多個因素衝突時的取捨方式</p>
        </div>

        {/* Preview */}
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">›</span>
            預覽 AI 收到的指令
          </summary>
          <pre className="mt-2 text-[10px] text-gray-400 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-gray-100">
            {`模式：${MODE_LABELS[profile.mode]}\n優先順序：${profile.priorities.map((p, i) => `${i + 1}. ${PRIORITY_LABELS[p]}`).join("、")}`}
          </pre>
        </details>
      </div>

      <button onClick={handleSave}
        className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
        {saved ? "已儲存 ✓" : "儲存設定"}
      </button>
    </div>
  );
}
