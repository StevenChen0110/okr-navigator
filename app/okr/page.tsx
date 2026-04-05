"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, KRConfidence } from "@/lib/types";
import { fetchObjectives, saveObjective, removeObjective } from "@/lib/db";
import { suggestKeyResults, analyzeConfidenceDrop, getQuarterRecommendation } from "@/lib/claude";
import { getSettings } from "@/lib/storage";
import Markdown from "@/components/Markdown";

const CONFIDENCE_CONFIG: Record<KRConfidence, { label: string; color: string }> = {
  "on-track": { label: "順利", color: "text-green-600 bg-green-50 border-green-200" },
  "at-risk": { label: "卡關", color: "text-amber-600 bg-amber-50 border-amber-200" },
  "needs-rethink": { label: "需重新思考", color: "text-red-600 bg-red-50 border-red-200" },
};

const TIMEFRAME_OPTIONS = ["本月", "本季", "半年", "全年"];

function calcKRCompletion(kr: KeyResult): number | undefined {
  if (!kr.targetValue || kr.targetValue <= 0) return undefined;
  return Math.min(100, Math.round(((kr.currentValue ?? 0) / kr.targetValue) * 100));
}

function calcOCompletion(o: Objective): number | undefined {
  const krs = o.keyResults.filter((kr) => kr.targetValue && kr.targetValue > 0);
  if (krs.length === 0) return undefined;
  const avg = krs.reduce((sum, kr) => sum + Math.min(1, (kr.currentValue ?? 0) / kr.targetValue!), 0) / krs.length;
  return Math.round(avg * 100);
}

export default function OKRPage() {
  const router = useRouter();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Objective | null>(null);

  // KR suggestions
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [checkedSuggestions, setCheckedSuggestions] = useState<Record<string, Set<number>>>({});

  // Confidence advice
  const [confidenceAdvice, setConfidenceAdvice] = useState<Record<string, string>>({});
  const [loadingAdvice, setLoadingAdvice] = useState<string | null>(null);

  // Quarter scoring
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [krScores, setKrScores] = useState<Record<string, number>>({});
  const [quarterResult, setQuarterResult] = useState<Record<string, { verdict: string; reasoning: string }>>({});
  const [loadingScore, setLoadingScore] = useState(false);

  // Snapshot
  const [expandedSnapshot, setExpandedSnapshot] = useState<string | null>(null);

  useEffect(() => {
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  function scheduleSave(objective: Objective) {
    if (saveTimers.current[objective.id]) clearTimeout(saveTimers.current[objective.id]);
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

  function updateKRProgress(objectiveId: string, krId: string, currentValue: number) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.map((kr) => (kr.id === krId ? { ...kr, currentValue } : kr)),
    });
  }

  // ── Edit mode ────────────────────────────────────────────────────────────────

  function startEdit(o: Objective) {
    setEditingId(o.id);
    setEditDraft(JSON.parse(JSON.stringify(o)));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setSuggestions({});
    setCheckedSuggestions({});
  }

  function saveEdit() {
    if (!editDraft) return;
    updateObjective(editDraft.id, editDraft);
    setEditingId(null);
    setEditDraft(null);
    setSuggestions({});
    setCheckedSuggestions({});
  }

  function updateDraft(patch: Partial<Objective>) {
    setEditDraft((d) => d ? { ...d, ...patch } : d);
  }

  function updateDraftKR(krId: string, patch: Partial<KeyResult>) {
    setEditDraft((d) => {
      if (!d) return d;
      return { ...d, keyResults: d.keyResults.map((kr) => kr.id === krId ? { ...kr, ...patch } : kr) };
    });
  }

  function addDraftKR() {
    setEditDraft((d) => {
      if (!d) return d;
      return { ...d, keyResults: [...d.keyResults, { id: uuid(), title: "", description: "" }] };
    });
  }

  function removeDraftKR(krId: string) {
    setEditDraft((d) => {
      if (!d) return d;
      return { ...d, keyResults: d.keyResults.filter((kr) => kr.id !== krId) };
    });
  }

  function deleteObjective(id: string) {
    if (!confirm("確定要刪除這個目標嗎？")) return;
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    removeObjective(id).catch(console.error);
    if (editingId === id) cancelEdit();
  }

  // ── KR Suggestions (used in edit mode) ──────────────────────────────────────

  async function handleSuggestKRs(objectiveId: string) {
    const draft = editDraft?.id === objectiveId ? editDraft : objectives.find((o) => o.id === objectiveId);
    if (!draft || !draft.title.trim()) return;
    const apiKey = process.env.NEXT_PUBLIC_CLAUDE_API_KEY ?? "";
    if (!apiKey) return;
    setSuggestingId(objectiveId);
    try {
      const { claudeModel, language } = getSettings();
      const existingKRs = draft.keyResults.map((kr) => kr.title).filter(Boolean);
      const suggested = await suggestKeyResults(apiKey, claudeModel, language, draft.title, draft.description, existingKRs);
      setSuggestions((prev) => ({ ...prev, [objectiveId]: suggested }));
      setCheckedSuggestions((prev) => ({ ...prev, [objectiveId]: new Set(suggested.map((_, i) => i)) }));
    } catch { /* silently fail */ }
    finally { setSuggestingId(null); }
  }

  function toggleSuggestion(objectiveId: string, index: number) {
    setCheckedSuggestions((prev) => {
      const set = new Set(prev[objectiveId] ?? []);
      if (set.has(index)) set.delete(index); else set.add(index);
      return { ...prev, [objectiveId]: set };
    });
  }

  function acceptSuggestions(objectiveId: string) {
    const list = suggestions[objectiveId] ?? [];
    const checked = checkedSuggestions[objectiveId] ?? new Set();
    const newKRs: KeyResult[] = list
      .filter((_, i) => checked.has(i))
      .map((title) => ({ id: uuid(), title, description: "" }));
    if (newKRs.length === 0) return;
    setEditDraft((d) => d ? { ...d, keyResults: [...d.keyResults, ...newKRs] } : d);
    setSuggestions((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
    setCheckedSuggestions((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
  }

  function dismissSuggestions(objectiveId: string) {
    setSuggestions((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
    setCheckedSuggestions((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
  }

  // ── Confidence ───────────────────────────────────────────────────────────────

  async function handleConfidenceChange(objectiveId: string, krId: string, confidence: KRConfidence) {
    updateObjective(objectiveId, {
      keyResults: objectives.find((o) => o.id === objectiveId)?.keyResults.map((kr) =>
        kr.id === krId ? { ...kr, confidence } : kr
      ) ?? [],
    });
    if (confidence === "on-track") {
      setConfidenceAdvice((prev) => { const n = { ...prev }; delete n[krId]; return n; });
      return;
    }
    const o = objectives.find((o) => o.id === objectiveId);
    const kr = o?.keyResults.find((k) => k.id === krId);
    if (!o || !kr) return;
    const apiKey = process.env.NEXT_PUBLIC_CLAUDE_API_KEY ?? "";
    if (!apiKey) return;
    setLoadingAdvice(krId);
    try {
      const { claudeModel, language } = getSettings();
      const advice = await analyzeConfidenceDrop(apiKey, claudeModel, language, kr.title, o.title, confidence);
      setConfidenceAdvice((prev) => ({ ...prev, [krId]: advice }));
    } catch { /* silently fail */ }
    finally { setLoadingAdvice(null); }
  }

  // ── Quarter Scoring ──────────────────────────────────────────────────────────

  function openScoring(objectiveId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    const initial: Record<string, number> = {};
    o.keyResults.forEach((kr) => { initial[kr.id] = kr.quarterScore ?? 0.5; });
    setKrScores(initial);
    setScoringId(objectiveId);
    setQuarterResult((prev) => { const n = { ...prev }; delete n[objectiveId]; return n; });
  }

  async function handleGetRecommendation(objectiveId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    const apiKey = process.env.NEXT_PUBLIC_CLAUDE_API_KEY ?? "";
    if (!apiKey) return;
    setLoadingScore(true);
    try {
      const { claudeModel, language } = getSettings();
      const scores = o.keyResults.map((kr) => ({ title: kr.title, score: krScores[kr.id] ?? 0.5 }));
      const result = await getQuarterRecommendation(apiKey, claudeModel, language, o.title, o.meta?.okrType ?? "committed", scores);
      setQuarterResult((prev) => ({ ...prev, [objectiveId]: result }));
    } catch { /* silently fail */ }
    finally { setLoadingScore(false); }
  }

  function saveQuarterScores(objectiveId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.map((kr) => ({ ...kr, quarterScore: krScores[kr.id] ?? kr.quarterScore })),
    });
    setScoringId(null);
  }

  const verdictConfig = {
    complete: { label: "結案", color: "text-green-700 bg-green-50 border-green-200" },
    continue: { label: "繼續推進", color: "text-amber-700 bg-amber-50 border-amber-200" },
    reset: { label: "重設 KR", color: "text-red-700 bg-red-50 border-red-200" },
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">OKR 目標管理</h1>
          <p className="text-sm text-gray-500 mt-0.5">定義你的長期目標與量化指標</p>
        </div>
        <button
          onClick={() => router.push("/okr/new")}
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
        {objectives.map((o, oi) => {
          const isEditing = editingId === o.id;
          const draft = isEditing ? editDraft! : null;
          const oCompletion = calcOCompletion(o);

          return (
            <div key={o.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">

              {/* ── Objective header ── */}
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-1 text-xs font-bold text-indigo-400 bg-indigo-50 rounded px-1.5 py-0.5 shrink-0">
                    O{oi + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        value={draft!.title}
                        onChange={(e) => updateDraft({ title: e.target.value })}
                        placeholder="目標名稱"
                        className="w-full font-medium text-sm border border-indigo-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                        autoFocus
                      />
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{o.title || <span className="text-gray-300">未命名目標</span>}</span>
                        {o.meta?.okrType && (
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            o.meta.okrType === "committed"
                              ? "text-indigo-600 bg-indigo-50 border-indigo-200"
                              : "text-purple-600 bg-purple-50 border-purple-200"
                          }`}>
                            {o.meta.okrType === "committed" ? "承諾" : "願景"}
                          </span>
                        )}
                        {o.meta?.timeframe && (
                          <span className="text-xs text-gray-400">{o.meta.timeframe}</span>
                        )}
                        {oCompletion !== undefined && (
                          <span className={`text-xs font-bold ${
                            oCompletion >= 70 ? "text-green-600" : oCompletion >= 40 ? "text-amber-500" : "text-red-500"
                          }`}>{oCompletion}%</span>
                        )}
                      </div>
                    )}

                    {/* Edit mode: type + timeframe */}
                    {isEditing && (
                      <div className="space-y-2 mb-2">
                        <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
                          {(["committed", "aspirational"] as const).map((t) => (
                            <button
                              key={t}
                              onClick={() => updateDraft({ meta: { ...draft!.meta, okrType: t } })}
                              className={`flex-1 py-1 rounded-lg text-xs font-medium transition-colors ${
                                draft!.meta?.okrType === t ? "bg-white shadow-sm text-gray-900" : "text-gray-400"
                              }`}
                            >
                              {t === "committed" ? "承諾型（必達）" : "願景型（挑戰）"}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {TIMEFRAME_OPTIONS.map((t) => (
                            <button
                              key={t}
                              onClick={() => updateDraft({ meta: { ...draft!.meta, timeframe: t } })}
                              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                draft!.meta?.timeframe === t
                                  ? "bg-indigo-600 text-white border-indigo-600"
                                  : "border-gray-200 text-gray-600 hover:border-indigo-300"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  {isEditing ? (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={saveEdit}
                        className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium transition-colors"
                      >
                        儲存
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => startEdit(o)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => deleteObjective(o.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                {/* Snapshot (view mode only) */}
                {!isEditing && o.meta?.snapshot && (
                  <div className="mt-3 ml-8">
                    <button
                      onClick={() => setExpandedSnapshot(expandedSnapshot === o.id ? null : o.id)}
                      className="text-xs text-indigo-400 hover:text-indigo-600 font-medium"
                    >
                      {expandedSnapshot === o.id ? "▲ 收起設定背景" : "▼ 查看設定背景"}
                    </button>
                    {expandedSnapshot === o.id && (
                      <div className="mt-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                        <Markdown className="text-xs text-indigo-700 leading-relaxed">{o.meta.snapshot}</Markdown>
                        {o.meta.motivation && (
                          <p className="text-xs text-indigo-400 mt-1">動機：{o.meta.motivation}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── KRs ── */}
              <div className="border-t border-gray-100 px-5 pb-4">
                <div className="space-y-3 pt-3">
                  {(isEditing ? draft!.keyResults : o.keyResults).map((kr, kri) => (
                    <div key={kr.id}>
                      {isEditing ? (
                        /* Edit mode KR row */
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 shrink-0 w-8">KR{kri + 1}</span>
                          <input
                            value={kr.title}
                            onChange={(e) => updateDraftKR(kr.id, { title: e.target.value })}
                            placeholder="量化指標"
                            className="flex-1 text-sm bg-gray-50 rounded-lg px-3 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none"
                          />
                          <button
                            onClick={() => removeDraftKR(kr.id)}
                            className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        /* View mode KR row */
                        <div className="space-y-1.5">
                          <div className="flex items-start gap-2">
                            <span className="text-xs text-gray-400 shrink-0 w-8 mt-0.5">KR{kri + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 leading-snug">{kr.title}</p>

                              {/* Progress row */}
                              {kr.metricName && kr.targetValue !== undefined && (
                                <div className="mt-1.5 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">{kr.metricName}</span>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min={0}
                                        max={kr.targetValue * 2}
                                        value={kr.currentValue ?? 0}
                                        onChange={(e) => updateKRProgress(o.id, kr.id, parseFloat(e.target.value) || 0)}
                                        className="w-14 text-xs text-center border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-400"
                                      />
                                      <span className="text-xs text-gray-400">/ {kr.targetValue} {kr.unit}</span>
                                    </div>
                                    {kr.deadline && (
                                      <span className="text-xs text-gray-400 ml-auto">{kr.deadline}</span>
                                    )}
                                  </div>
                                  {/* Progress bar */}
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        (calcKRCompletion(kr) ?? 0) >= 70 ? "bg-green-400" :
                                        (calcKRCompletion(kr) ?? 0) >= 40 ? "bg-amber-400" : "bg-red-400"
                                      }`}
                                      style={{ width: `${calcKRCompletion(kr) ?? 0}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-medium text-gray-500">{calcKRCompletion(kr) ?? 0}%</span>
                                </div>
                              )}
                            </div>

                            {/* Confidence selector */}
                            <select
                              value={kr.confidence ?? ""}
                              onChange={(e) => handleConfidenceChange(o.id, kr.id, e.target.value as KRConfidence)}
                              className={`text-xs rounded-lg px-2 py-1 border cursor-pointer focus:outline-none shrink-0 ${
                                kr.confidence
                                  ? CONFIDENCE_CONFIG[kr.confidence].color
                                  : "text-gray-400 bg-gray-50 border-gray-200"
                              }`}
                            >
                              <option value="" disabled>信心度</option>
                              <option value="on-track">順利</option>
                              <option value="at-risk">卡關</option>
                              <option value="needs-rethink">需重新思考</option>
                            </select>
                          </div>

                          {/* Confidence advice */}
                          {loadingAdvice === kr.id && (
                            <p className="text-xs text-gray-400 ml-10 animate-pulse">AI 分析中…</p>
                          )}
                          {confidenceAdvice[kr.id] && (
                            <div className={`ml-10 rounded-lg px-3 py-2 text-xs border ${
                              kr.confidence === "needs-rethink"
                                ? "bg-red-50 border-red-100 text-red-700"
                                : "bg-amber-50 border-amber-100 text-amber-700"
                            }`}>
                              <Markdown>{confidenceAdvice[kr.id]}</Markdown>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Edit mode actions */}
                {isEditing && (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={addDraftKR}
                        className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                      >
                        + 新增 KR
                      </button>
                      {draft!.title.trim() && !suggestions[o.id] && (
                        <button
                          onClick={() => handleSuggestKRs(o.id)}
                          disabled={suggestingId === o.id}
                          className="text-xs text-gray-400 hover:text-indigo-500 font-medium disabled:opacity-50 transition-colors"
                        >
                          {suggestingId === o.id ? "AI 推薦中…" : "✦ AI 推薦 KR"}
                        </button>
                      )}
                    </div>

                    {/* Suggestions panel */}
                    {suggestions[o.id] && (
                      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 space-y-2">
                        <p className="text-xs font-medium text-indigo-700 mb-2">AI 推薦（勾選後加入）</p>
                        {suggestions[o.id].map((s, i) => (
                          <label key={i} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checkedSuggestions[o.id]?.has(i) ?? false}
                              onChange={() => toggleSuggestion(o.id, i)}
                              className="mt-0.5 accent-indigo-600 shrink-0"
                            />
                            <span className="text-xs text-indigo-800">{s}</span>
                          </label>
                        ))}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => acceptSuggestions(o.id)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium transition-colors"
                          >
                            加入選取
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
                )}

                {/* View mode bottom actions */}
                {!isEditing && (
                  <div className="mt-3 flex items-center justify-end">
                    <button
                      onClick={() => openScoring(o.id)}
                      className="text-xs text-gray-400 hover:text-indigo-500 font-medium transition-colors"
                    >
                      季度評分
                    </button>
                  </div>
                )}

                {/* Quarter scoring panel */}
                {scoringId === o.id && (
                  <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-medium text-gray-700">季度評分（0.0 – 1.0）</p>
                    {o.keyResults.map((kr) => (
                      <div key={kr.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-600 flex-1 truncate">{kr.title || "KR"}</span>
                          <span className={`text-xs font-bold w-8 text-right ${
                            (krScores[kr.id] ?? 0.5) >= 0.7 ? "text-green-600" :
                            (krScores[kr.id] ?? 0.5) >= 0.4 ? "text-amber-500" : "text-red-500"
                          }`}>{(krScores[kr.id] ?? 0.5).toFixed(1)}</span>
                        </div>
                        <input
                          type="range" min={0} max={1} step={0.1}
                          value={krScores[kr.id] ?? 0.5}
                          onChange={(e) => setKrScores((prev) => ({ ...prev, [kr.id]: parseFloat(e.target.value) }))}
                          className="w-full accent-indigo-600"
                        />
                      </div>
                    ))}

                    {quarterResult[o.id] && (
                      <div className={`rounded-xl p-3 border text-xs ${
                        verdictConfig[quarterResult[o.id].verdict as keyof typeof verdictConfig]?.color ?? ""
                      }`}>
                        <span className="font-bold block mb-1">
                          建議：{verdictConfig[quarterResult[o.id].verdict as keyof typeof verdictConfig]?.label}
                        </span>
                        <Markdown>{quarterResult[o.id].reasoning}</Markdown>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleGetRecommendation(o.id)}
                        disabled={loadingScore}
                        className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium disabled:opacity-50 transition-colors"
                      >
                        {loadingScore ? "分析中…" : "取得 AI 建議"}
                      </button>
                      <button
                        onClick={() => saveQuarterScores(o.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        儲存評分
                      </button>
                      <button
                        onClick={() => setScoringId(null)}
                        className="text-xs px-3 py-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
