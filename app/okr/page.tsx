"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, KRConfidence, CheckIn, ObjectiveStatus } from "@/lib/types";
import { fetchObjectives, saveObjective, removeObjective } from "@/lib/db";
import { classifyKR } from "@/lib/claude";
import { getSettings } from "@/lib/storage";
import Markdown from "@/components/Markdown";

const CONFIDENCE_CONFIG: Record<KRConfidence, { label: string; color: string }> = {
  "on-track": { label: "順利", color: "text-green-600 bg-green-50 border-green-200" },
  "at-risk": { label: "卡關", color: "text-amber-600 bg-amber-50 border-amber-200" },
  "needs-rethink": { label: "需重新思考", color: "text-red-600 bg-red-50 border-red-200" },
};

const STATUS_CONFIG: Record<ObjectiveStatus, { label: string; color: string }> = {
  active: { label: "進行中", color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  completed: { label: "已完成", color: "text-green-700 bg-green-50 border-green-200" },
  archived: { label: "已封存", color: "text-gray-500 bg-gray-50 border-gray-200" },
};

const TIMEFRAME_OPTIONS = ["本月", "本季", "半年", "全年"];

function calcKRCompletion(kr: KeyResult): number | undefined {
  if (!kr.targetValue || kr.targetValue <= 0) return undefined;
  return Math.min(100, Math.round(((kr.currentValue ?? 0) / kr.targetValue) * 100));
}

function getProgressColor(completion: number, deadline?: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = deadline ? new Date(deadline) < today : false;
  if (isOverdue && completion < 100) return "bg-red-400";
  if (completion >= 60) return "bg-green-400";
  if (completion >= 30) return "bg-amber-400";
  return "bg-gray-400";
}

function calcOCompletion(o: Objective): number | undefined {
  const krs = o.keyResults.filter((kr) => kr.targetValue && kr.targetValue > 0);
  if (krs.length === 0) return undefined;
  const avg =
    krs.reduce((sum, kr) => sum + Math.min(1, (kr.currentValue ?? 0) / kr.targetValue!), 0) /
    krs.length;
  return Math.round(avg * 100);
}

function daysAgo(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDaysAgo(n: number): string {
  if (n === 0) return "今天";
  if (n === 1) return "昨天";
  return `${n} 天前`;
}

function getLastCheckIn(kr: KeyResult): CheckIn | undefined {
  if (!kr.checkIns?.length) return undefined;
  return kr.checkIns[kr.checkIns.length - 1];
}

export default function OKRPage() {
  const router = useRouter();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Status filter
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Objective | null>(null);

  // Quarter scoring
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [krScores, setKrScores] = useState<Record<string, number>>({});

  // Snapshot expand
  const [expandedSnapshot, setExpandedSnapshot] = useState<string | null>(null);

  // AI classifying KRs in edit mode (set of krId)
  const [classifyingKRs, setClassifyingKRs] = useState<Set<string>>(new Set());

  // Check-in
  const [checkInOpen, setCheckInOpen] = useState<string | null>(null); // krId
  const [checkInVal, setCheckInVal] = useState("");
  const [checkInNote, setCheckInNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());

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

  // ── Check-in ──────────────────────────────────────────────────────────────────

  function openCheckIn(krId: string) {
    setCheckInOpen(krId);
    setCheckInVal("");
    setCheckInNote("");
  }

  function submitCheckIn(objectiveId: string, krId: string) {
    const val = parseFloat(checkInVal);
    if (isNaN(val)) return;
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    const checkIn: CheckIn = {
      id: uuid(),
      date: new Date().toISOString(),
      value: val,
      note: checkInNote.trim() || undefined,
    };
    updateObjective(objectiveId, {
      keyResults: o.keyResults.map((kr) =>
        kr.id === krId
          ? { ...kr, currentValue: val, checkIns: [...(kr.checkIns ?? []), checkIn] }
          : kr
      ),
    });
    setCheckInOpen(null);
    setCheckInVal("");
    setCheckInNote("");
  }

  function toggleHistory(krId: string) {
    setHistoryOpen((prev) => {
      const next = new Set(prev);
      if (next.has(krId)) next.delete(krId);
      else next.add(krId);
      return next;
    });
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  function cycleStatus(objectiveId: string, current: ObjectiveStatus | undefined) {
    const order: ObjectiveStatus[] = ["active", "completed", "archived"];
    const idx = order.indexOf(current ?? "active");
    const next = order[(idx + 1) % order.length];
    updateObjective(objectiveId, { status: next });
  }

  // ── Confidence ────────────────────────────────────────────────────────────────

  function updateConfidence(objectiveId: string, krId: string, confidence: KRConfidence) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.map((kr) => (kr.id === krId ? { ...kr, confidence } : kr)),
    });
  }

  // ── Progress (direct input) ───────────────────────────────────────────────────

  function updateKRProgress(objectiveId: string, krId: string, currentValue: number) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.map((kr) => (kr.id === krId ? { ...kr, currentValue } : kr)),
    });
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────────

  function startEdit(o: Objective) {
    setEditingId(o.id);
    setEditDraft(JSON.parse(JSON.stringify(o)));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  function saveEdit() {
    if (!editDraft) return;
    updateObjective(editDraft.id, editDraft);
    setEditingId(null);
    setEditDraft(null);
  }

  function updateDraft(patch: Partial<Objective>) {
    setEditDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function updateDraftKR(krId: string, patch: Partial<KeyResult>) {
    setEditDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        keyResults: d.keyResults.map((kr) => (kr.id === krId ? { ...kr, ...patch } : kr)),
      };
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

  async function handleDraftKRTitleBlur(kr: KeyResult) {
    if (!kr.title.trim() || !editDraft?.title.trim()) return;
    const apiKey = process.env.NEXT_PUBLIC_CLAUDE_API_KEY ?? "";
    if (!apiKey) return;
    setClassifyingKRs((prev) => new Set(prev).add(kr.id));
    try {
      const settings = getSettings();
      const result = await classifyKR(apiKey, settings.claudeModel, settings.language, kr.title, editDraft!.title);
      updateDraftKR(kr.id, {
        krType: result.krType,
        metricName: result.metricName ?? "",
        targetValue: result.targetValue ?? undefined,
        unit: result.unit ?? "",
        deadline: result.deadline ?? undefined,
        incrementPerTask: result.incrementPerTask ?? 1,
      });
    } catch {
      // silently ignore
    } finally {
      setClassifyingKRs((prev) => { const next = new Set(prev); next.delete(kr.id); return next; });
    }
  }

  function deleteObjective(id: string) {
    if (!confirm("確定要刪除這個目標嗎？")) return;
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    removeObjective(id).catch(console.error);
    if (editingId === id) cancelEdit();
  }

  // ── Quarter Scoring ───────────────────────────────────────────────────────────

  function openScoring(objectiveId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    const initial: Record<string, number> = {};
    o.keyResults.forEach((kr) => {
      initial[kr.id] = kr.quarterScore ?? 0.5;
    });
    setKrScores(initial);
    setScoringId(objectiveId);
  }

  function saveQuarterScores(objectiveId: string) {
    const o = objectives.find((o) => o.id === objectiveId);
    if (!o) return;
    updateObjective(objectiveId, {
      keyResults: o.keyResults.map((kr) => ({
        ...kr,
        quarterScore: krScores[kr.id] ?? kr.quarterScore,
      })),
    });
    setScoringId(null);
  }

  // ── Filtered list ─────────────────────────────────────────────────────────────

  const visibleObjectives = objectives.filter((o) => {
    const s = o.status ?? "active";
    if (statusFilter === "active") return s === "active" || s === "completed";
    if (statusFilter === "archived") return s === "archived";
    return true;
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-center justify-between mb-6">
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

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
        {(["active", "archived", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === f ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
            }`}
          >
            {f === "active" ? "進行中" : f === "archived" ? "已封存" : "全部"}
          </button>
        ))}
      </div>

      {visibleObjectives.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <div className="text-4xl mb-3">◎</div>
          <p className="text-sm">
            {statusFilter === "archived"
              ? "還沒有封存的目標"
              : "還沒有目標，點擊「新增目標」開始"}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {visibleObjectives.map((o, oi) => {
          const isEditing = editingId === o.id;
          const draft = isEditing ? editDraft! : null;
          const oCompletion = calcOCompletion(o);
          const currentStatus = o.status ?? "active";

          return (
            <div
              key={o.id}
              className={`bg-white rounded-xl border overflow-hidden ${
                currentStatus === "archived" ? "opacity-60" : "border-gray-200"
              }`}
            >
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
                        <span className="font-medium text-sm">
                          {o.title || <span className="text-gray-300">未命名目標</span>}
                        </span>
                        {o.meta?.okrType && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full border ${
                              o.meta.okrType === "committed"
                                ? "text-indigo-600 bg-indigo-50 border-indigo-200"
                                : "text-purple-600 bg-purple-50 border-purple-200"
                            }`}
                          >
                            {o.meta.okrType === "committed" ? "承諾" : "願景"}
                          </span>
                        )}
                        {o.meta?.timeframe && (
                          <span className="text-xs text-gray-400">{o.meta.timeframe}</span>
                        )}
                        {oCompletion !== undefined && (
                          <span
                            className={`text-xs font-bold ${
                              oCompletion >= 70
                                ? "text-green-600"
                                : oCompletion >= 40
                                ? "text-amber-500"
                                : "text-red-500"
                            }`}
                          >
                            {oCompletion}%
                          </span>
                        )}
                        {/* Status badge — click to cycle */}
                        <button
                          onClick={() => cycleStatus(o.id, currentStatus)}
                          className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${STATUS_CONFIG[currentStatus].color}`}
                          title="點擊切換狀態"
                        >
                          {STATUS_CONFIG[currentStatus].label}
                        </button>
                      </div>
                    )}

                    {/* Edit mode: type + timeframe + status */}
                    {isEditing && (
                      <div className="space-y-2 mb-2">
                        <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
                          {(["committed", "aspirational"] as const).map((t) => (
                            <button
                              key={t}
                              onClick={() =>
                                updateDraft({ meta: { ...draft!.meta, okrType: t } })
                              }
                              className={`flex-1 py-1 rounded-lg text-xs font-medium transition-colors ${
                                draft!.meta?.okrType === t
                                  ? "bg-white shadow-sm text-gray-900"
                                  : "text-gray-400"
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
                              onClick={() =>
                                updateDraft({ meta: { ...draft!.meta, timeframe: t } })
                              }
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
                        {/* Status in edit mode */}
                        <div className="flex gap-2">
                          {(["active", "completed", "archived"] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => updateDraft({ status: s })}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                (draft!.status ?? "active") === s
                                  ? STATUS_CONFIG[s].color
                                  : "border-gray-200 text-gray-400"
                              }`}
                            >
                              {STATUS_CONFIG[s].label}
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

                {/* Snapshot */}
                {!isEditing && o.meta?.snapshot && (
                  <div className="mt-3 ml-8">
                    <button
                      onClick={() =>
                        setExpandedSnapshot(expandedSnapshot === o.id ? null : o.id)
                      }
                      className="text-xs text-indigo-400 hover:text-indigo-600 font-medium"
                    >
                      {expandedSnapshot === o.id ? "▲ 收起設定背景" : "▼ 查看設定背景"}
                    </button>
                    {expandedSnapshot === o.id && (
                      <div className="mt-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                        <Markdown className="text-xs text-indigo-700 leading-relaxed">
                          {o.meta.snapshot}
                        </Markdown>
                        {o.meta.motivation && (
                          <p className="text-xs text-indigo-400 mt-1">
                            動機：{o.meta.motivation}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── KRs ── */}
              <div className="border-t border-gray-100 px-5 pb-4">
                <div className="space-y-4 pt-3">
                  {(isEditing ? draft!.keyResults : o.keyResults).map((kr, kri) => (
                    <div key={kr.id}>
                      {isEditing ? (
                        /* Edit mode KR row */
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 shrink-0 w-8">
                              KR{kri + 1}
                            </span>
                            <input
                              value={kr.title}
                              onChange={(e) => updateDraftKR(kr.id, { title: e.target.value })}
                              onBlur={() => handleDraftKRTitleBlur(kr)}
                              placeholder="量化指標描述"
                              className="flex-1 text-sm bg-gray-50 rounded-lg px-3 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none"
                            />
                            {classifyingKRs.has(kr.id) && (
                              <span className="text-xs text-indigo-400 flex items-center gap-1 shrink-0 whitespace-nowrap">
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                                AI
                              </span>
                            )}
                            <button
                              onClick={() => removeDraftKR(kr.id)}
                              className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                            >
                              ×
                            </button>
                          </div>
                          {/* KR Type */}
                          <div className="ml-8 flex gap-1.5 flex-wrap">
                            {(["cumulative", "measurement", "milestone"] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => updateDraftKR(kr.id, { krType: t })}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                  (kr.krType ?? "cumulative") === t
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : "border-gray-200 text-gray-500 hover:border-indigo-300"
                                }`}
                              >
                                {t === "cumulative" ? "累積型" : t === "measurement" ? "測量型" : "里程碑型"}
                              </button>
                            ))}
                          </div>

                          {/* Edit metric fields */}
                          {(kr.krType ?? "cumulative") !== "milestone" && (
                            <div className="ml-8 grid grid-cols-3 gap-2">
                              <div className="space-y-0.5">
                                <label className="text-xs text-gray-400">指標名稱</label>
                                <input
                                  value={kr.metricName ?? ""}
                                  onChange={(e) =>
                                    updateDraftKR(kr.id, { metricName: e.target.value })
                                  }
                                  className="w-full text-xs bg-gray-50 rounded-lg px-2 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-xs text-gray-400">目標值</label>
                                <input
                                  type="number"
                                  value={kr.targetValue ?? ""}
                                  onChange={(e) =>
                                    updateDraftKR(kr.id, {
                                      targetValue: e.target.value ? parseFloat(e.target.value) : undefined,
                                    })
                                  }
                                  className="w-full text-xs bg-gray-50 rounded-lg px-2 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-xs text-gray-400">單位</label>
                                <input
                                  value={kr.unit ?? ""}
                                  onChange={(e) => updateDraftKR(kr.id, { unit: e.target.value })}
                                  className="w-full text-xs bg-gray-50 rounded-lg px-2 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none"
                                />
                              </div>
                            </div>
                          )}

                          {(kr.krType ?? "cumulative") === "cumulative" && (
                            <div className="ml-8 flex items-center gap-2">
                              <label className="text-xs text-gray-400 shrink-0">每 Task 貢獻</label>
                              <input
                                type="number"
                                min={0.1}
                                step={0.1}
                                value={kr.incrementPerTask ?? 1}
                                onChange={(e) =>
                                  updateDraftKR(kr.id, {
                                    incrementPerTask: e.target.value ? parseFloat(e.target.value) : undefined,
                                  })
                                }
                                className="w-16 text-xs bg-gray-50 rounded-lg px-2 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none"
                              />
                              <span className="text-xs text-gray-400">{kr.unit || "單位"} / Task</span>
                            </div>
                          )}

                          <div className="ml-8 space-y-0.5">
                            <label className="text-xs text-gray-400">截止日期</label>
                            <input
                              type="date"
                              value={kr.deadline ?? ""}
                              onChange={(e) =>
                                updateDraftKR(kr.id, { deadline: e.target.value || undefined })
                              }
                              className="text-xs bg-gray-50 rounded-lg px-2 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none"
                            />
                          </div>
                        </div>
                      ) : (
                        /* View mode KR row */
                        <div className="space-y-1.5">
                          <div className="flex items-start gap-2">
                            <span className="text-xs text-gray-400 shrink-0 w-8 mt-0.5">
                              KR{kri + 1}
                            </span>
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
                                        onChange={(e) =>
                                          updateKRProgress(
                                            o.id,
                                            kr.id,
                                            parseFloat(e.target.value) || 0
                                          )
                                        }
                                        className="w-14 text-xs text-center border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-400"
                                      />
                                      <span className="text-xs text-gray-400">
                                        / {kr.targetValue} {kr.unit}
                                      </span>
                                    </div>
                                    {kr.deadline && (
                                      <span className="text-xs text-gray-400 ml-auto">
                                        {kr.deadline}
                                      </span>
                                    )}
                                  </div>
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${getProgressColor(
                                        calcKRCompletion(kr) ?? 0,
                                        kr.deadline
                                      )}`}
                                      style={{ width: `${calcKRCompletion(kr) ?? 0}%` }}
                                    />
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs font-medium text-gray-500">
                                      {calcKRCompletion(kr) ?? 0}%
                                    </span>
                                    {/* Last check-in info */}
                                    {(() => {
                                      const last = getLastCheckIn(kr);
                                      return last ? (
                                        <span className="text-xs text-gray-400">
                                          上次更新：{formatDaysAgo(daysAgo(last.date))}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-gray-300">尚未更新</span>
                                      );
                                    })()}
                                    {/* Check-in button */}
                                    <button
                                      onClick={() =>
                                        checkInOpen === kr.id
                                          ? setCheckInOpen(null)
                                          : openCheckIn(kr.id)
                                      }
                                      className="text-xs text-indigo-500 hover:text-indigo-700 font-medium ml-auto"
                                    >
                                      {checkInOpen === kr.id ? "取消" : "更新進度"}
                                    </button>
                                    {/* History toggle */}
                                    {(kr.checkIns?.length ?? 0) > 0 && (
                                      <button
                                        onClick={() => toggleHistory(kr.id)}
                                        className="text-xs text-gray-400 hover:text-gray-600"
                                      >
                                        {historyOpen.has(kr.id)
                                          ? "▲ 收起"
                                          : `▼ 紀錄(${kr.checkIns!.length})`}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Check-in form */}
                              {checkInOpen === kr.id && (
                                <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <label className="text-xs text-indigo-600 shrink-0">
                                      今日進度值
                                    </label>
                                    <input
                                      type="number"
                                      min={0}
                                      value={checkInVal}
                                      onChange={(e) => setCheckInVal(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          submitCheckIn(o.id, kr.id);
                                      }}
                                      placeholder={String(kr.currentValue ?? 0)}
                                      className="w-20 text-xs text-center border border-indigo-300 rounded px-2 py-1 focus:outline-none focus:border-indigo-500 bg-white"
                                      autoFocus
                                    />
                                    {kr.unit && (
                                      <span className="text-xs text-indigo-400">{kr.unit}</span>
                                    )}
                                  </div>
                                  <textarea
                                    value={checkInNote}
                                    onChange={(e) => setCheckInNote(e.target.value)}
                                    placeholder="備註（選填）"
                                    rows={2}
                                    className="w-full text-xs border border-indigo-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => submitCheckIn(o.id, kr.id)}
                                      disabled={!checkInVal.trim()}
                                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                                    >
                                      儲存（Enter）
                                    </button>
                                    <button
                                      onClick={() => setCheckInOpen(null)}
                                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
                                    >
                                      取消
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Check-in history */}
                              {historyOpen.has(kr.id) && kr.checkIns && kr.checkIns.length > 0 && (
                                <div className="mt-2 border border-gray-100 rounded-lg overflow-hidden">
                                  {[...kr.checkIns].reverse().map((ci) => (
                                    <div
                                      key={ci.id}
                                      className="flex items-start gap-3 px-3 py-2 border-b border-gray-50 last:border-0 text-xs"
                                    >
                                      <span className="text-gray-400 shrink-0 w-20">
                                        {new Date(ci.date).toLocaleDateString("zh-TW")}
                                      </span>
                                      <span className="font-medium text-gray-700">
                                        {ci.value} {kr.unit}
                                      </span>
                                      {ci.note && (
                                        <span className="text-gray-400 flex-1">{ci.note}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Confidence selector */}
                            <div className="flex gap-1 shrink-0">
                              {(["on-track", "at-risk", "needs-rethink"] as const).map((conf) => (
                                <button
                                  key={conf}
                                  onClick={() => updateConfidence(o.id, kr.id, conf)}
                                  className={`text-xs px-2 py-1 rounded-lg border cursor-pointer transition-colors ${
                                    kr.confidence === conf
                                      ? `${CONFIDENCE_CONFIG[conf].color} border-current`
                                      : "text-gray-400 bg-gray-50 border-gray-200 hover:border-gray-300"
                                  }`}
                                  title={CONFIDENCE_CONFIG[conf].label}
                                >
                                  {CONFIDENCE_CONFIG[conf].label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Edit mode: add KR */}
                {isEditing && (
                  <div className="mt-3">
                    <button
                      onClick={addDraftKR}
                      className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                    >
                      + 新增 KR
                    </button>
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

                {/* Quarter scoring panel (no AI) */}
                {scoringId === o.id && (
                  <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-medium text-gray-700">季度評分（0.0 – 1.0）</p>
                    {o.keyResults.map((kr) => (
                      <div key={kr.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-600 flex-1 truncate">
                            {kr.title || "KR"}
                          </span>
                          <span
                            className={`text-xs font-bold w-8 text-right ${
                              (krScores[kr.id] ?? 0.5) >= 0.7
                                ? "text-green-600"
                                : (krScores[kr.id] ?? 0.5) >= 0.4
                                ? "text-amber-500"
                                : "text-red-500"
                            }`}
                          >
                            {(krScores[kr.id] ?? 0.5).toFixed(1)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.1}
                          value={krScores[kr.id] ?? 0.5}
                          onChange={(e) =>
                            setKrScores((prev) => ({
                              ...prev,
                              [kr.id]: parseFloat(e.target.value),
                            }))
                          }
                          className="w-full accent-indigo-600"
                        />
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => saveQuarterScores(o.id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium transition-colors"
                      >
                        儲存評分
                      </button>
                      <button
                        onClick={() => setScoringId(null)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
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
