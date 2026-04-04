"use client";

import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/lib/storage";
import { AppSettings } from "@/lib/types";

const MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    claudeApiKey: "",
    claudeModel: "claude-haiku-4-5-20251001",
  });
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-xl font-semibold mb-1">設定</h1>
      <p className="text-sm text-gray-500 mb-8">管理 Claude API 連線設定</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Claude API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={settings.claudeApiKey}
              onChange={(e) =>
                setSettings((s) => ({ ...s, claudeApiKey: e.target.value }))
              }
              placeholder="sk-ant-..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
            >
              {showKey ? "隱藏" : "顯示"}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Key 只儲存在瀏覽器本地，不會傳送至任何伺服器。
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            模型選擇
          </label>
          <select
            value={settings.claudeModel}
            onChange={(e) =>
              setSettings((s) => ({ ...s, claudeModel: e.target.value }))
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSave}
          className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          {saved ? "已儲存 ✓" : "儲存設定"}
        </button>
      </div>
    </div>
  );
}
