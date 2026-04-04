"use client";

import { useState, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult } from "@/lib/types";
import { fetchObjectives, saveObjective, removeObjective } from "@/lib/db";
import { suggestKeyResults } from "@/lib/claude";
import { getSettings } from "@/lib/storage";

export default function OKRPage() {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // KR suggestions state: objectiveId -> suggested KR titles
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  // track which suggestions are checked: objectiveId -> Set of indices
  const [checkedSuggestions, setCheckedSuggestions] = useState<Record<string, Set<number>>>({});

  useEffect(() => {
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  function scheduleSave(objective: Objective) {
    if (saveTimers.current[objective.id]) {
      clearTimeout(saveTimers.current[objective.id]);
    }
    saveTimers.current[objective.id] = setTimeout(() => {
      saveObjective(objective).catch(console.error);
    }, 800);
  }

  function updateObjective(id: string, patch: Partial<Objective>) {
    setObjectives((prev) => {
      const next = prev.map((o) => (o.id === id ? { ...o, ...patch } : o));
      const updated = next.find((o) => o.id === id);
      if (updated) scheduleSave(updated);
      return next;
    });
  }

  async function addObjective() {
    const newO: Objective = {
      id: uuid(),
      title: "",
      description: "",
      keyResults: [],
      createdAt: new Date().toISOString(),
    };
    setObjectives((prev) => [...prev, newO]);
    setEditingId(newO.id);
    saveObjective(newO).catch(console.error);
  }

  function deleteObjective(id: string) {
    if (!confirm("確定要刪除這個目標嗎？")) return;
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    if (editingId === id) setEditingId(null);
    removeObjective(id).catch(console.error);
  }

  function addKR(objectiveId: string) {
    const kr: KeyResult = { id: uuid(), title: "", description: "" };
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, { keyResults: [...o.keyResults, kr] });
  }

  function updateKR(objectiveId: string, krId: string, patch: Partial<KeyResult>) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.map((kr) => (kr.id === krId ? { ...kr, ...patch } : kr)),
    });
  }

  function deleteKR(objectiveId: string, krId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.filter((kr) => kr.id !== krId),
    });
  }

  async function handleSuggestKRs(objectiveId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o || !o.title.trim()) return;
    const apiKey = process.env.NEXT_PUBLIC_CLAUDE_API_KEY ?? "";
    if (!apiKey) return;
    setSuggestingId(objectiveId);
    try {
      const { claudeModel } = getSettings();
      const suggested = await suggestKeyResults(apiKey, claudeModel, o.title, o.description);
      setSuggestions((prev) => ({ ...prev, [objectiveId]: suggested }));
      setCheckedSuggestions((prev) => ({
        ...prev,
        [objectiveId]: new Set(suggested.map((_, i) => i)),
      }));
    } catch {
      // silently fail
    } finally {
      setSuggestingId(null);
    }
  }

  function toggleSuggestion(objectiveId: string, index: number) {
    setCheckedSuggestions((prev) => {
      const set = new Set(prev[objectiveId] ?? []);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      return { ...prev, [objectiveId]: set };
    });
  }

  function acceptSuggestions(objectiveId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    const list = suggestions[objectiveId] ?? [];
    const checked = checkedSuggestions[objectiveId] ?? new Set();
    const newKRs: KeyResult[] = list
      .filter((_, i) => checked.has(i))
      .map((title) => ({ id: uuid(), title, description: "" }));
    if (newKRs.length === 0) return;
    updateObjective(objectiveId, { keyResults: [...o.keyResults, ...newKRs] });
    setSuggestions((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
    setCheckedSuggestions((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
  }

  function dismissSuggestions(objectiveId: string) {
    setSuggestions((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
    setCheckedSuggestions((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">OKR 目標管理</h1>
          <p className="text-sm text-gray-500 mt-0.5">定義你的長期目標與量化指標</p>
        </div>
        <button
          onClick={addObjective}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          + 新增目標
        </button>
      </div>

      {objectives.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <div className="text-4xl mb-3">◎</div>
          <p className="text-sm">還沒有目標，點擊「新增目標」開始</p>
        </div>
      )}

      <div className="space-y-4">
        {objectives.map((o, oi) => (
          <div key={o.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <span className="mt-1 text-xs font-bold text-indigo-400 bg-indigo-50 rounded px-1.5 py-0.5 shrink-0">
                  O{oi + 1}
                </span>
                <div className="flex-1 space-y-2">
                  <input
                    value={o.title}
                    onChange={(e) => updateObjective(o.id, { title: e.target.value })}
                    placeholder="目標名稱（例：成為全端開發者）"
                    className="w-full font-medium text-sm bg-transparent border-b border-transparent focus:border-indigo-300 focus:outline-none pb-0.5 placeholder:text-gray-300"
                  />
                  <input
                    value={o.description ?? ""}
                    onChange={(e) => updateObjective(o.id, { description: e.target.value })}
                    placeholder="目標描述（選填）"
                    className="w-full text-xs text-gray-500 bg-transparent border-b border-transparent focus:border-indigo-300 focus:outline-none pb-0.5 placeholder:text-gray-300"
                  />
                </div>
                <button
                  onClick={() => deleteObjective(o.id)}
                  className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none mt-0.5"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="border-t border-gray-100 px-5 pb-4">
              <div className="space-y-2 pt-3">
                {o.keyResults.map((kr, kri) => (
                  <div key={kr.id} className="flex items-start gap-2">
                    <span className="mt-2 text-xs text-gray-400 shrink-0">KR{kri + 1}</span>
                    <div className="flex-1 space-y-1">
                      <input
                        value={kr.title}
                        onChange={(e) => updateKR(o.id, kr.id, { title: e.target.value })}
                        placeholder="量化指標（例：完成 3 個全端專案）"
                        className="w-full text-sm bg-gray-50 rounded-lg px-3 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none placeholder:text-gray-300"
                      />
                      <input
                        value={kr.description ?? ""}
                        onChange={(e) => updateKR(o.id, kr.id, { description: e.target.value })}
                        placeholder="補充說明（選填）"
                        className="w-full text-xs text-gray-400 bg-transparent px-3 focus:outline-none placeholder:text-gray-300"
                      />
                    </div>
                    <button
                      onClick={() => deleteKR(o.id, kr.id)}
                      className="mt-2 text-gray-300 hover:text-red-400 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => addKR(o.id)}
                  className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                >
                  + 新增 Key Result
                </button>
                {o.title.trim() && !suggestions[o.id] && (
                  <button
                    onClick={() => handleSuggestKRs(o.id)}
                    disabled={suggestingId === o.id}
                    className="text-xs text-gray-400 hover:text-indigo-500 font-medium disabled:opacity-50 transition-colors"
                  >
                    {suggestingId === o.id ? "AI 推薦中…" : "✦ AI 推薦 KR"}
                  </button>
                )}
              </div>

              {/* AI suggestions panel */}
              {suggestions[o.id] && (
                <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-medium text-indigo-700 mb-2">AI 推薦的 Key Results（勾選後加入）</p>
                  {suggestions[o.id].map((s, i) => (
                    <label key={i} className="flex items-start gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={checkedSuggestions[o.id]?.has(i) ?? false}
                        onChange={() => toggleSuggestion(o.id, i)}
                        className="mt-0.5 accent-indigo-600 shrink-0"
                      />
                      <span className="text-xs text-indigo-800 group-hover:text-indigo-900">{s}</span>
                    </label>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => acceptSuggestions(o.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium transition-colors"
                    >
                      加入選取的 KR
                    </button>
                    <button
                      onClick={() => dismissSuggestions(o.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
