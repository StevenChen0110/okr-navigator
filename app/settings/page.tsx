"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSettings, saveSettings, getEvaluationProfile, saveEvaluationProfile } from "@/lib/storage";
import { AppSettings, EvaluationProfile, EvalMode, AIProvider } from "@/lib/types";
import { MODE_LABELS, MODE_DESCRIPTIONS, DEFAULT_EVALUATION_PROFILE } from "@/lib/evaluation-prompt";
import { PROVIDER_LABEL, PROVIDER_MODELS, DEFAULT_MODEL } from "@/lib/llm";
import { useAuth } from "@/components/AuthProvider";

const PROVIDERS: AIProvider[] = ["anthropic", "openai", "gemini", "grok"];

export default function SettingsPage() {
  const { user, requireAuth } = useAuth();
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings>({
    language: "zh-TW",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    apiKeys: {},
  });
  const [profile, setProfile] = useState<EvaluationProfile>(DEFAULT_EVALUATION_PROFILE);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) { requireAuth(); router.replace("/"); return; }
    setSettings(getSettings());
    setProfile(getEvaluationProfile());
  }, [user]);

  function handleSave() {
    saveSettings(settings);
    saveEvaluationProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const activeProvider = settings.provider ?? "anthropic";
  const models = PROVIDER_MODELS[activeProvider] ?? [];

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-0.5">設定</h1>
        <p className="text-sm text-gray-500">AI 模型與評估方式</p>
      </div>

      {/* AI Provider + Model */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <p className="text-sm font-medium text-gray-700">AI 模型</p>

        {/* Provider tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {PROVIDERS.map((p) => (
            <button key={p}
              onClick={() => setSettings((s) => ({
                ...s,
                provider: p,
                model: DEFAULT_MODEL[p],
              }))}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                activeProvider === p
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}>
              {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>

        {/* API Key */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-600">
            {PROVIDER_LABEL[activeProvider]} API Key
          </label>
          <input
            type="password"
            placeholder="sk-..."
            value={settings.apiKeys?.[activeProvider] ?? ""}
            onChange={(e) => setSettings((s) => ({
              ...s,
              apiKeys: { ...s.apiKeys, [activeProvider]: e.target.value },
            }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-[10px] text-gray-400">API Key 僅儲存在本機，不會上傳伺服器</p>
        </div>

        {/* Model dropdown */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-600">模型</label>
          <select
            value={settings.model ?? DEFAULT_MODEL[activeProvider]}
            onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Language */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-600">AI 回應語言</label>
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
          <label className="text-xs text-gray-500 font-medium block">模式</label>
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

        {/* Consideration toggles */}
        <div className="space-y-2">
          <label className="text-xs text-gray-500 font-medium block">評分參考</label>
          <div className="space-y-2">
            {([
              { key: "considerPriority" as const, label: "重要度", desc: "P1 目標權重 3×，P2 為 2×，P3 為 1×" },
              { key: "considerDeadline" as const, label: "截止時間", desc: "30 天內到期的目標優先度提升" },
            ] as const).map(({ key, label, desc }) => (
              <button key={key}
                onClick={() => setProfile((p) => ({ ...p, [key]: !p[key] }))}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left ${
                  profile[key] ? "border-indigo-200 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                  profile[key] ? "bg-indigo-500 border-indigo-500" : "border-gray-300"
                }`}>
                  {profile[key] && <span className="text-white text-[10px] font-bold">✓</span>}
                </span>
                <span>
                  <span className={`text-xs font-medium block ${profile[key] ? "text-indigo-700" : "text-gray-700"}`}>{label}</span>
                  <span className="text-[10px] text-gray-400">{desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={handleSave}
        className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
        {saved ? "已儲存 ✓" : "儲存設定"}
      </button>
    </div>
  );
}
