"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, CheckIn, ObjectiveStatus, Idea } from "@/lib/types";
import { fetchObjectives, saveObjective, removeObjective, fetchIdeas } from "@/lib/db";
import { KRClassification } from "@/lib/claude";
import { callAI } from "@/lib/ai-client";


const STATUS_CONFIG: Record<ObjectiveStatus, { label: string; color: string }> = {
  active: { label: "進行中", color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  completed: { label: "已完成", color: "text-green-700 bg-green-50 border-green-200" },
  shelved: { label: "暫存", color: "text-amber-600 bg-amber-50 border-amber-200" },
  deleted: { label: "已刪除", color: "text-red-500 bg-red-50 border-red-200" },
};

const TIMEFRAME_OPTIONS = ["本月", "本季", "半年", "全年"];

const KR_TYPE_LABEL: Record<string, string> = {
  cumulative: "累積",
  measurement: "量測",
  milestone: "里程碑",
};

function calcKRCompletion(kr: KeyResult): number | undefined {
  if (!kr.targetValue || kr.targetValue <= 0) return undefined;
  return Math.min(100, Math.round(((kr.currentValue ?? 0) / kr.targetValue) * 100));
}

function getProgressColor(completion: number, deadline?: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = deadline ? new Date(deadline) < today : false;
  if (isOverdue && completion < 100) return "bg-red-400";
  if (completion >= 60) return "bg-indigo-300";
  if (completion >= 30) return "bg-indigo-200";
  return "bg-gray-200";
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
  return `${n}天前`;
}

function getLastCheckIn(kr: KeyResult): CheckIn | undefined {
  if (!kr.checkIns?.length) return undefined;
  return kr.checkIns[kr.checkIns.length - 1];
}

function getProgressTextColor(pct: number): string {
  if (pct >= 60) return "text-indigo-600";
  if (pct >= 30) return "text-indigo-400";
  return "text-gray-400";
}

function getLastUpdatedDate(o: Objective): number {
  let latest = 0;
  for (const kr of o.keyResults) {
    for (const ci of kr.checkIns ?? []) {
      const t = new Date(ci.date).getTime();
      if (t > latest) latest = t;
    }
  }
  return latest;
}

const TASK_STATUS_LABEL: Record<string, string> = { todo: "待辦", "in-progress": "進行中", done: "完成" };

interface KRTasksPopup { krId: string; krTitle: string; objTitle: string; objId: string; }

export default function OKRPage() {
  const router = useRouter();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Filters
  const [statusFilter, setStatusFilter] = useState<"active" | "completed" | "shelved" | "deleted">("active");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"default" | "completion_asc" | "completion_desc" | "updated">("default");

  // Edit mode (right drawer)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Objective | null>(null);

  // KR Tasks popup
  const [krTasksPopup, setKrTasksPopup] = useState<KRTasksPopup | null>(null);

  // KR row expansion (for check-in / history in view mode)
  const [expandedKRId, setExpandedKRId] = useState<string | null>(null);

  // AI classifying KRs in edit mode (set of krId)
  const [classifyingKRs, setClassifyingKRs] = useState<Set<string>>(new Set());

  // AI KR rewrite suggestions shown in edit mode
  const [krSuggestions, setKrSuggestions] = useState<Record<string, string>>({});
  const [krSuggestionOpen, setKrSuggestionOpen] = useState<Set<string>>(new Set());

  // Check-in
  const [checkInOpen, setCheckInOpen] = useState<string | null>(null); // krId
  const [checkInVal, setCheckInVal] = useState("");
  const [checkInNote, setCheckInNote] = useState("");

  useEffect(() => {
    fetchObjectives().then(setObjectives).catch(console.error);
    fetchIdeas().then(setIdeas).catch(console.error);
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

  // ── Status ────────────────────────────────────────────────────────────────────

  function cycleStatus(objectiveId: string, current: ObjectiveStatus | undefined) {
    const order: ObjectiveStatus[] = ["active", "completed", "shelved"];
    const idx = order.indexOf((current ?? "active") as ObjectiveStatus);
    const next = order[(idx + 1) % order.length];
    updateObjective(objectiveId, { status: next });
  }

  // ── Edit mode (drawer) ────────────────────────────────────────────────────────

  function startEdit(o: Objective) {
    setEditingId(o.id);
    setEditDraft(JSON.parse(JSON.stringify(o)));
    setKrSuggestions({});
    setKrSuggestionOpen(new Set());
    o.keyResults.forEach((kr) => {
      if (!kr.title.trim()) return;
      callAI<string>("refineKRTitle", {
        objectiveTitle: o.title,
        currentTitle: kr.title,
        userInstruction: "請用「完成後，什麼事情會不一樣？」的角度改寫這個 KR，描述一個可觀察的完成狀態，一句話即可",
      }).then((suggestion) => {
        setKrSuggestions((prev) => ({ ...prev, [kr.id]: suggestion }));
      }).catch(() => {});
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setKrSuggestions({});
    setKrSuggestionOpen(new Set());
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
    setClassifyingKRs((prev) => new Set(prev).add(kr.id));
    try {
      const result = await callAI<KRClassification>("classifyKR", { krTitle: kr.title, objectiveTitle: editDraft!.title });
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
    updateObjective(id, { status: "deleted" });
    if (editingId === id) cancelEdit();
  }

  function restoreObjective(id: string) {
    updateObjective(id, { status: "active" });
  }

  function permanentDeleteObjective(id: string) {
    if (!confirm("永久刪除後無法復原，確定嗎？")) return;
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    removeObjective(id).catch(console.error);
  }

  // ── Filtered + sorted list ────────────────────────────────────────────────────

  const visibleObjectives = objectives
    .filter((o) => {
      const s = (o.status ?? "active") as ObjectiveStatus;
      if (statusFilter === "active" && s !== "active") return false;
      if (statusFilter === "completed" && s !== "completed") return false;
      if (statusFilter === "shelved" && s !== "shelved" && s !== ("archived" as string)) return false;
      if (statusFilter === "deleted" && s !== "deleted") return false;
      if (periodFilter !== "all" && o.meta?.timeframe !== periodFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "completion_asc") return (calcOCompletion(a) ?? 0) - (calcOCompletion(b) ?? 0);
      if (sortBy === "completion_desc") return (calcOCompletion(b) ?? 0) - (calcOCompletion(a) ?? 0);
      if (sortBy === "updated") return getLastUpdatedDate(b) - getLastUpdatedDate(a);
      return 0;
    });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10">
      {/* KR Tasks Popup */}
      {krTasksPopup && (() => {
        const kr = objectives.find((o) => o.id === krTasksPopup.objId)?.keyResults.find((k) => k.id === krTasksPopup.krId);
        const krCompletion = kr ? calcKRCompletion(kr) : undefined;
        const relatedTasks = ideas.filter((i) =>
          (i.ideaStatus ?? "active") === "active" &&
          (i.linkedKRs ?? []).some((l) => l.krId === krTasksPopup.krId)
        );
        const doneCount = relatedTasks.filter((t) => t.taskStatus === "done").length;
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setKrTasksPopup(null); }}>
            <div className="bg-white rounded-xl w-full max-w-sm shadow-lg overflow-hidden border border-gray-200">
              <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-400 mb-0.5">{krTasksPopup.objTitle}</p>
                    <p className="text-sm font-semibold text-gray-800 leading-snug">{krTasksPopup.krTitle}</p>
                  </div>
                  <button onClick={() => setKrTasksPopup(null)} className="text-gray-300 hover:text-gray-500 text-lg leading-none shrink-0 mt-0.5">×</button>
                </div>
                {krCompletion !== undefined && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{doneCount}/{relatedTasks.length} 任務完成</span>
                      <span className={`text-xs font-medium font-mono ${getProgressTextColor(krCompletion)}`}>{krCompletion}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${krCompletion >= 60 ? "bg-indigo-300" : krCompletion >= 30 ? "bg-indigo-200" : "bg-gray-200"}`}
                        style={{ width: `${krCompletion}%`, minWidth: "3px" }} />
                    </div>
                    {kr && kr.targetValue && (
                      <p className="text-[10px] text-gray-400 text-right font-mono">
                        {kr.currentValue ?? 0}{kr.unit ? ` ${kr.unit}` : ""} / {kr.targetValue}{kr.unit ? ` ${kr.unit}` : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
                {relatedTasks.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-gray-400 text-center">尚無相關任務</p>
                ) : relatedTasks.map((task) => (
                  <div key={task.id} className="px-4 py-2.5 flex items-center gap-2.5">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${task.taskStatus === "done" ? "bg-indigo-300" : task.taskStatus === "in-progress" ? "bg-amber-300" : "bg-gray-300"}`} />
                    <p className={`text-xs flex-1 min-w-0 truncate ${task.taskStatus === "done" ? "line-through text-gray-400" : "text-gray-700"}`}>{task.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${task.taskStatus === "done" ? "bg-gray-50 text-gray-400" : task.taskStatus === "in-progress" ? "bg-amber-50 text-amber-500" : "bg-gray-50 text-gray-400"}`}>
                      {task.taskStatus ? TASK_STATUS_LABEL[task.taskStatus] : "待辦"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 border-t border-gray-100">
                <Link href={`/tasks?objectiveId=${krTasksPopup.objId}&krId=${krTasksPopup.krId}`}
                  onClick={() => setKrTasksPopup(null)}
                  className="text-xs text-indigo-500 hover:text-indigo-700">
                  ＋ 新增任務
                </Link>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Drawer */}
      {editingId && editDraft && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/20" onClick={cancelEdit} />
          <div className="w-[440px] bg-white h-full shadow-2xl border-l border-gray-200 flex flex-col overflow-hidden">
            {/* Drawer header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
              <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 text-sm leading-none">‹</button>
              <span className="text-sm font-medium flex-1 truncate text-gray-700">編輯目標</span>
              <button onClick={saveEdit} className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 font-medium transition-colors">儲存</button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Objective title */}
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">目標名稱</label>
                <input
                  value={editDraft.title}
                  onChange={(e) => updateDraft({ title: e.target.value })}
                  placeholder="目標名稱"
                  className="w-full text-sm border border-indigo-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>

              {/* Timeframe */}
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">時程</label>
                <div className="flex gap-1.5 flex-wrap">
                  {TIMEFRAME_OPTIONS.map((t) => (
                    <button key={t}
                      onClick={() => updateDraft({ meta: { ...editDraft.meta, timeframe: t } })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        editDraft.meta?.timeframe === t
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300"
                      }`}>{t}</button>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">狀態</label>
                <div className="flex gap-1.5">
                  {(["active", "completed", "shelved"] as const).map((s) => (
                    <button key={s}
                      onClick={() => updateDraft({ status: s })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        (editDraft.status ?? "active") === s
                          ? STATUS_CONFIG[s].color
                          : "border-gray-200 text-gray-400 hover:border-gray-300"
                      }`}>{STATUS_CONFIG[s].label}</button>
                  ))}
                </div>
              </div>

              <div className="border-t border-gray-100" />

              {/* KRs */}
              <div>
                <p className="text-xs text-gray-400 mb-3">子目標</p>
                <div className="space-y-4">
                  {editDraft.keyResults.map((kr, kri) => (
                    <div key={kr.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-300 shrink-0 w-5">{kri + 1}.</span>
                        <input
                          value={kr.title}
                          onChange={(e) => updateDraftKR(kr.id, { title: e.target.value })}
                          onBlur={() => handleDraftKRTitleBlur(kr)}
                          placeholder="完成後，什麼事情會不一樣？"
                          className="flex-1 text-sm bg-gray-50 rounded-lg px-3 py-1.5 border border-transparent focus:border-indigo-300 focus:outline-none"
                        />
                        {classifyingKRs.has(kr.id) && (
                          <span className="text-indigo-400 shrink-0">
                            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          </span>
                        )}
                        <button onClick={() => removeDraftKR(kr.id)} className="text-gray-300 hover:text-red-400 transition-colors shrink-0">×</button>
                      </div>
                      {kr.krType !== "milestone" && (kr.targetValue !== undefined || kr.unit) && (
                        <div className="ml-5 flex items-center gap-2">
                          <span className="text-xs text-gray-400">目標</span>
                          <input type="number" min={0} value={kr.targetValue ?? ""}
                            onChange={(e) => updateDraftKR(kr.id, { targetValue: e.target.value ? parseFloat(e.target.value) : undefined })}
                            placeholder="數值"
                            className="w-16 text-xs bg-gray-50 rounded-lg px-2 py-1 border border-transparent focus:border-indigo-300 focus:outline-none" />
                          <input value={kr.unit ?? ""}
                            onChange={(e) => updateDraftKR(kr.id, { unit: e.target.value })}
                            placeholder="單位"
                            className="w-14 text-xs bg-gray-50 rounded-lg px-2 py-1 border border-transparent focus:border-indigo-300 focus:outline-none" />
                        </div>
                      )}
                      {krSuggestions[kr.id] && (
                        <div className="ml-5">
                          <button type="button"
                            onClick={() => setKrSuggestionOpen((prev) => {
                              const next = new Set(prev);
                              if (next.has(kr.id)) next.delete(kr.id); else next.add(kr.id);
                              return next;
                            })}
                            className="text-xs text-indigo-400 hover:text-indigo-600 flex items-center gap-1">
                            <span className={`transition-transform inline-block ${krSuggestionOpen.has(kr.id) ? "rotate-90" : ""}`}>›</span>
                            AI 建議改寫
                          </button>
                          {krSuggestionOpen.has(kr.id) && (
                            <div className="mt-1.5 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
                              <p className="text-xs text-indigo-700 flex-1">{krSuggestions[kr.id]}</p>
                              <button type="button"
                                onClick={() => {
                                  updateDraftKR(kr.id, { title: krSuggestions[kr.id] });
                                  setKrSuggestionOpen((prev) => { const next = new Set(prev); next.delete(kr.id); return next; });
                                }}
                                className="text-xs text-indigo-600 font-medium hover:text-indigo-800 shrink-0">套用</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={addDraftKR} className="mt-4 text-xs text-indigo-500 hover:text-indigo-700 font-medium">
                  + 新增子目標
                </button>
              </div>
            </div>

            {/* Drawer footer */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={() => deleteObjective(editingId)}
                className="text-xs text-gray-300 hover:text-red-400 transition-colors"
              >
                刪除目標
              </button>
              <div className="flex gap-2">
                <button onClick={cancelEdit} className="px-4 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors">取消</button>
                <button onClick={saveEdit} className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors">儲存</button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Filters + sort */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
        {/* Status filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 shrink-0">狀態</span>
          <div className="flex gap-1">
            {(["active", "completed", "shelved", "deleted"] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                  statusFilter === f ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "border-transparent text-gray-400 hover:text-gray-600"
                }`}>
                {f === "active" ? "進行中" : f === "completed" ? "已完成" : f === "shelved" ? "暫存" : "垃圾桶"}
              </button>
            ))}
          </div>
        </div>
        <div className="w-px h-4 bg-gray-200 shrink-0" />
        {/* Period filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 shrink-0">期間</span>
          <div className="flex gap-1">
            {(["all", ...TIMEFRAME_OPTIONS] as const).map((p) => (
              <button key={p} onClick={() => setPeriodFilter(p)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                  periodFilter === p ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "border-transparent text-gray-400 hover:text-gray-600"
                }`}>
                {p === "all" ? "全部" : p}
              </button>
            ))}
          </div>
        </div>
        <div className="w-px h-4 bg-gray-200 shrink-0" />
        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 shrink-0">排序</span>
          <div className="flex gap-1">
            {([
              { key: "default", label: "預設" },
              { key: "completion_desc", label: "完成↑" },
              { key: "completion_asc", label: "完成↓" },
              { key: "updated", label: "最近更新" },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => setSortBy(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                  sortBy === key ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "border-transparent text-gray-400 hover:text-gray-600"
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visibleObjectives.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <div className="text-4xl mb-3">◎</div>
          <p className="text-sm">
            {statusFilter === "deleted" ? "垃圾桶是空的"
              : statusFilter === "shelved" ? "沒有暫存的目標"
              : statusFilter === "completed" ? "還沒有完成的目標"
              : "還沒有目標，點擊「新增目標」開始"}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {visibleObjectives.map((o, oi) => {
          const oCompletion = calcOCompletion(o);
          const currentStatus = o.status ?? "active";
          const isActiveEdit = editingId === o.id;

          return (
            <div
              key={o.id}
              className={`bg-white rounded-xl border overflow-hidden transition-all ${
                isActiveEdit ? "border-indigo-200 ring-1 ring-indigo-100" :
                currentStatus === "shelved" || currentStatus === "deleted" ? "opacity-60 border-gray-200" : "border-gray-200"
              }`}
            >
              {/* ── Objective header ── */}
              <div className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-xs font-bold text-indigo-400 bg-indigo-50 rounded px-1.5 py-0.5 shrink-0">
                    O{oi + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="font-medium text-sm leading-snug">
                        {o.title || <span className="text-gray-300">未命名目標</span>}
                      </span>
                      {o.meta?.timeframe && (
                        <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5 shrink-0">{o.meta.timeframe}</span>
                      )}
                      <button
                        onClick={() => cycleStatus(o.id, currentStatus)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors shrink-0 ${STATUS_CONFIG[currentStatus].color}`}
                        title="點擊切換狀態"
                      >
                        {STATUS_CONFIG[currentStatus].label}
                      </button>
                      {oCompletion !== undefined && (
                        <span className={`text-xs font-medium font-mono shrink-0 ${getProgressTextColor(oCompletion)}`}>
                          {oCompletion}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  {currentStatus !== "deleted" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(o)}
                        className={`transition-colors text-base leading-none px-1 ${isActiveEdit ? "text-indigo-400" : "text-gray-300 hover:text-gray-600"}`}
                        title="編輯"
                      >
                        ···
                      </button>
                      <button
                        onClick={() => deleteObjective(o.id)}
                        className="text-gray-200 hover:text-red-400 transition-colors text-lg leading-none"
                      >
                        ×
                      </button>
                    </div>
                  )}
                  {currentStatus === "deleted" && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => restoreObjective(o.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                      >
                        還原
                      </button>
                      <button
                        onClick={() => permanentDeleteObjective(o.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 transition-colors"
                      >
                        永久刪除
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ── KR table rows ── */}
              {o.keyResults.length > 0 && (
                <div className="border-t border-gray-100">
                  {o.keyResults.map((kr, kri) => {
                    const completion = calcKRCompletion(kr);
                    const lastCI = getLastCheckIn(kr);
                    const isExpanded = expandedKRId === kr.id;

                    return (
                      <div key={kr.id} className="border-b border-gray-50 last:border-0">
                        {/* Compact row */}
                        <div
                          className="flex items-center gap-2 px-5 py-2.5 hover:bg-gray-50/50 cursor-pointer group"
                          onClick={() => setExpandedKRId(isExpanded ? null : kr.id)}
                        >
                          <span className="text-[10px] text-gray-300 shrink-0 w-5 font-mono">{kri + 1}</span>
                          <p className="text-sm text-gray-700 flex-1 min-w-0 truncate leading-snug">{kr.title || <span className="text-gray-300">未命名子目標</span>}</p>

                          {/* Type badge */}
                          {kr.krType && (
                            <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-200 rounded px-1.5 shrink-0 hidden sm:block">
                              {KR_TYPE_LABEL[kr.krType] ?? kr.krType}
                            </span>
                          )}

                          {/* Value */}
                          {kr.krType !== "milestone" && kr.targetValue !== undefined && kr.targetValue > 0 && (
                            <span className="text-xs font-mono text-gray-500 shrink-0 hidden md:block">
                              {kr.currentValue ?? 0}/{kr.targetValue}{kr.unit ? ` ${kr.unit}` : ""}
                            </span>
                          )}

                          {/* % or milestone status */}
                          {kr.krType === "milestone" ? (
                            <span className={`text-xs font-medium shrink-0 w-12 text-right ${kr.currentValue && kr.currentValue >= 1 ? "text-indigo-500" : "text-gray-400"}`}>
                              {kr.currentValue && kr.currentValue >= 1 ? "達成" : "未達成"}
                            </span>
                          ) : completion !== undefined ? (
                            <span className={`text-xs font-mono font-medium shrink-0 w-9 text-right ${getProgressTextColor(completion)}`}>
                              {completion}%
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300 shrink-0 w-9 text-right">—</span>
                          )}

                          {/* Last update */}
                          <span className="text-[10px] text-gray-300 shrink-0 w-12 text-right hidden lg:block">
                            {lastCI ? formatDaysAgo(daysAgo(lastCI.date)) : "—"}
                          </span>

                          {/* Tasks badge */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setKrTasksPopup({ krId: kr.id, krTitle: kr.title, objTitle: o.title, objId: o.id });
                            }}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 shrink-0"
                          >
                            Tasks
                          </button>

                          {/* Expand chevron */}
                          <span className={`text-gray-300 text-sm shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""} group-hover:text-gray-400`}>›</span>
                        </div>

                        {/* Expanded panel */}
                        {isExpanded && (
                          <div className="px-5 pb-4 pt-1 bg-gray-50/30 space-y-3">
                            {/* Progress bar (non-milestone) */}
                            {kr.krType !== "milestone" && kr.targetValue !== undefined && kr.targetValue > 0 && (
                              <div className="space-y-1.5">
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${getProgressColor(completion ?? 0, kr.deadline)}`}
                                    style={{ width: `${completion ?? 0}%`, minWidth: "3px" }}
                                  />
                                </div>
                                <div className="flex items-center gap-3 text-xs text-gray-400">
                                  <span className={`font-mono font-medium ${getProgressTextColor(completion ?? 0)}`}>{completion ?? 0}%</span>
                                  <span>{kr.currentValue ?? 0} / {kr.targetValue} {kr.unit}</span>
                                  {kr.deadline && <span className="ml-auto">{kr.deadline}</span>}
                                </div>
                              </div>
                            )}

                            {/* Actions row */}
                            <div className="flex items-center gap-3">
                              {kr.krType === "milestone" ? (
                                <button
                                  onClick={() => {
                                    const newVal = (kr.currentValue && kr.currentValue >= 1) ? 0 : 1;
                                    const updated = objectives.find((obj) => obj.id === o.id);
                                    if (!updated) return;
                                    updateObjective(o.id, {
                                      keyResults: updated.keyResults.map((k) => k.id === kr.id ? { ...k, currentValue: newVal } : k),
                                    });
                                  }}
                                  className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                                    kr.currentValue && kr.currentValue >= 1
                                      ? "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-white"
                                      : "border-gray-200 text-gray-500 hover:border-indigo-200 hover:text-indigo-600"
                                  }`}
                                >
                                  {kr.currentValue && kr.currentValue >= 1 ? "✓ 已達成" : "標記達成"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => checkInOpen === kr.id ? setCheckInOpen(null) : openCheckIn(kr.id)}
                                  className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                                >
                                  {checkInOpen === kr.id ? "取消" : "更新進度"}
                                </button>
                              )}
                              {(kr.checkIns?.length ?? 0) > 0 && (
                                <span className="text-xs text-gray-400">{kr.checkIns!.length} 筆紀錄</span>
                              )}
                            </div>

                            {/* Check-in form */}
                            {checkInOpen === kr.id && (
                              <div className="bg-white border border-indigo-200 rounded-lg p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-indigo-600 shrink-0">今日進度值</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={checkInVal}
                                    onChange={(e) => setCheckInVal(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") submitCheckIn(o.id, kr.id); }}
                                    placeholder={String(kr.currentValue ?? 0)}
                                    className="w-20 text-xs text-center border border-indigo-300 rounded px-2 py-1 focus:outline-none focus:border-indigo-500 bg-white"
                                    autoFocus
                                  />
                                  {kr.unit && <span className="text-xs text-indigo-400">{kr.unit}</span>}
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
                                    儲存
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
                            {(kr.checkIns?.length ?? 0) > 0 && (
                              <div className="border border-gray-100 rounded-lg overflow-hidden">
                                {[...kr.checkIns!].reverse().map((ci) => (
                                  <div key={ci.id} className="flex items-start gap-3 px-3 py-2 border-b border-gray-50 last:border-0 text-xs">
                                    <span className="text-gray-400 shrink-0 w-20">{new Date(ci.date).toLocaleDateString("zh-TW")}</span>
                                    <span className="font-medium text-gray-700">{ci.value} {kr.unit}</span>
                                    {ci.note && <span className="text-gray-400 flex-1">{ci.note}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
