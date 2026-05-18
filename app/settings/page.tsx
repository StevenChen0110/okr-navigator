"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSettings, saveSettings, getEvaluationProfile, saveEvaluationProfile } from "@/lib/storage";
import { AppSettings, EvaluationProfile, EvalMode, AIProvider } from "@/lib/types";
import { DEFAULT_EVALUATION_PROFILE } from "@/lib/evaluation-prompt";
import { PROVIDER_LABEL, PROVIDER_MODELS, DEFAULT_MODEL } from "@/lib/llm";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";

const PROVIDERS: AIProvider[] = ["anthropic", "openai", "gemini", "grok"];

export default function SettingsPage() {
  const { user, requireAuth, signOut } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings>({
    language: "zh-TW",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    apiKeys: {},
  });
  const [profile, setProfile] = useState<EvaluationProfile>(DEFAULT_EVALUATION_PROFILE);
  const [saved, setSaved] = useState(false);
  const [showAIModel, setShowAIModel] = useState(true);
  const [showEvalProfile, setShowEvalProfile] = useState(true);

  useEffect(() => {
    if (!user) { requireAuth(); router.replace("/"); return; }
    setSettings(getSettings());
    setProfile(getEvaluationProfile());
  }, [user]);

  function handleSave() {
    saveSettings({ ...settings, language });
    saveEvaluationProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const activeProvider = settings.provider ?? "anthropic";
  const models = PROVIDER_MODELS[activeProvider] ?? [];

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-0.5">{t("settings.title")}</h1>
        <p className="text-sm text-gray-500">{t("settings.subtitle")}</p>
      </div>

      {/* Language toggle */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
        <p className="text-sm font-medium text-gray-700 mb-3">{t("settings.language")}</p>
        <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
          {(["zh-TW", "en"] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                language === lang ? "bg-white shadow-sm text-gray-900" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {lang === "zh-TW" ? "繁體中文" : "English"}
            </button>
          ))}
        </div>
      </div>

      {/* AI Provider + Model */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setShowAIModel((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <p className="text-sm font-medium text-gray-700">{t("settings.aiModel.title")}</p>
          <span className={`text-gray-400 transition-transform ${showAIModel ? "rotate-180" : ""}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
        </button>

        {showAIModel && (
          <div className="px-5 pb-5 space-y-5 border-t border-gray-100">
            {/* Provider tabs */}
            <div className="flex gap-1.5 flex-wrap pt-4">
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

            {/* Model dropdown */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600">{t("settings.model.label")}</label>
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
          </div>
        )}
      </div>

      {/* Evaluation Profile */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setShowEvalProfile((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-gray-700">{t("settings.evalCriteria.title")}</p>
            {!showEvalProfile && (
              <p className="text-xs text-gray-400 mt-0.5">{t(`mode.${profile.mode}`)}</p>
            )}
          </div>
          <span className={`text-gray-400 transition-transform ${showEvalProfile ? "rotate-180" : ""}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
        </button>

        {showEvalProfile && (
          <div className="px-5 pb-5 space-y-5 border-t border-gray-100">
            {/* Mode */}
            <div className="space-y-2 pt-4">
              <label className="text-xs text-gray-500 font-medium block">{t("settings.mode.label")}</label>
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
                      {t(`mode.${m}`)}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{t(`mode.${m}.desc`)}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Consideration toggles */}
            <div className="space-y-2">
              <label className="text-xs text-gray-500 font-medium block">{t("settings.considerations.label")}</label>
              <div className="space-y-2">
                {([
                  { key: "considerPriority" as const, labelKey: "settings.priority.label", descKey: "settings.priority.desc" },
                  { key: "considerDeadline" as const, labelKey: "settings.deadline.label", descKey: "settings.deadline.desc" },
                ] as const).map(({ key, labelKey, descKey }) => (
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
                      <span className={`text-xs font-medium block ${profile[key] ? "text-indigo-700" : "text-gray-700"}`}>{t(labelKey)}</span>
                      <span className="text-[10px] text-gray-400">{t(descKey)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <button onClick={handleSave}
        className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
        {saved ? t("settings.saved") : t("settings.save")}
      </button>

      {/* Knowledge Base link */}
      <button
        onClick={() => router.push("/profile")}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <div>
          <p className="text-sm font-medium text-gray-700">{language === "zh-TW" ? "個人知識庫" : "Personal Knowledge Base"}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {language === "zh-TW" ? "匯入筆記、文件，讓 AI 更了解你" : "Import notes and docs so AI understands you better"}
          </p>
        </div>
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <div className="border-t border-gray-100 pt-4 flex items-center justify-between">
        <p className="text-xs text-gray-400 truncate">{user?.email}</p>
        <button
          onClick={signOut}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0 ml-4"
        >
          {t("settings.signOut")}
        </button>
      </div>
    </div>
  );
}
