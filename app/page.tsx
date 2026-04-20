"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Idea, Objective, KeyResult, CheckIn, TaskStatus, IdeaStatus, IdeaKRLink, IdeaAnalysis, TodoItem } from "@/lib/types";
import { fetchIdeas, fetchObjectives, removeIdea, saveIdea, saveObjective, updateIdeaTaskStatus, updateIdeaStatus } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import ScoreBar from "@/components/ScoreBar";

// Pending measurement inputs: ideaId → { krId → value string }
type MeasurementInputs = Record<string, Record<string, string>>;

function calcKRCompletion(kr: KeyResult): number | undefined {
  if (kr.krType === "milestone") {
    return kr.currentValue && kr.currentValue >= 1 ? 100 : 0;
  }
  if (!kr.targetValue || kr.targetValue <= 0) return undefined;
  return Math.min(100, Math.round(((kr.currentValue ?? 0) / kr.targetValue) * 100));
}

function calcOCompletion(o: Objective): number | undefined {
  const krs = o.keyResults.filter((kr) => {
    if (kr.krType === "milestone") return true;
    return kr.targetValue && kr.targetValue > 0;
  });
  if (krs.length === 0) return undefined;
  const avg = krs.reduce((sum, kr) => {
    if (kr.krType === "milestone") return sum + (kr.currentValue && kr.currentValue >= 1 ? 1 : 0);
    return sum + Math.min(1, (kr.currentValue ?? 0) / kr.targetValue!);
  }, 0) / krs.length;
  return Math.round(avg * 100);
}

function calcScore(idea: Idea): number | null {
  return idea.analysis?.finalScore ?? null;
}

function getLastCheckIn(kr: KeyResult): CheckIn | undefined {
  if (!kr.checkIns?.length) return undefined;
  return kr.checkIns[kr.checkIns.length - 1];
}

function getProgressColor(completion: number): string {
  if (completion >= 60) return "bg-green-400";
  if (completion >= 30) return "bg-amber-400";
  return "bg-gray-400";
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待辦",
  "in-progress": "進行中",
  done: "完成",
};

/** Renders linked objectives/KRs with remove (×) buttons. */
function LinkedObjsEditable({
  links,
  objectives,
  onRemove,
}: {
  links: IdeaKRLink[];
  objectives: Objective[];
  onRemove: (index: number) => void;
}) {
  if (links.length === 0) return null;
  // Build grouped display, preserving original index for removal
  const grouped: { obj: Objective; items: { kr: KeyResult | null; linkIndex: number }[] }[] = [];
  links.forEach((link, idx) => {
    const obj = objectives.find((o) => o.id === link.objectiveId);
    if (!obj) return;
    let entry = grouped.find((g) => g.obj.id === obj.id);
    if (!entry) { entry = { obj, items: [] }; grouped.push(entry); }
    const kr = link.krId ? obj.keyResults.find((k) => k.id === link.krId) ?? null : null;
    entry.items.push({ kr, linkIndex: idx });
  });
  return (
    <div className="space-y-1.5">
      {grouped.map(({ obj, items }) => (
        <div key={obj.id}>
          <p className="text-xs text-gray-500 font-medium leading-snug">{obj.title}</p>
          {items.map(({ kr, linkIndex }) => (
            <div key={linkIndex} className="flex items-center gap-1 pl-3">
              <p className="text-xs text-gray-400 flex-1 leading-snug">└ {kr ? kr.title : "（整體目標）"}</p>
              <button
                onClick={() => onRemove(linkIndex)}
                className="text-gray-300 hover:text-red-400 text-sm leading-none shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const TASK_STATUS_STYLE: Record<TaskStatus, string> = {
  todo: "bg-gray-100 text-gray-500",
  "in-progress": "bg-amber-50 text-amber-600",
  done: "bg-green-50 text-green-600",
};

export default function DashboardPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [expandedObjId, setExpandedObjId] = useState<string | null>(null);
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null);
  const [showObjPickerId, setShowObjPickerId] = useState<string | null>(null);
  // measurement: taskId that is awaiting measurement input before marking done
  const [pendingMeasure, setPendingMeasure] = useState<string | null>(null);
  const [measureInputs, setMeasureInputs] = useState<MeasurementInputs>({});
  const [expandedAnalysisIds, setExpandedAnalysisIds] = useState<Set<string>>(new Set());
  const [taskFilter, setTaskFilter] = useState<"active" | "shelved" | "deleted">("active");

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  // ── Ideas helpers ───────────────────────────────────────────────────────────

  function setIdeaStatus(id: string, status: IdeaStatus) {
    updateIdeaStatus(id, status).catch(console.error);
    setIdeas((prev) => prev.map((i) => i.id === id ? { ...i, ideaStatus: status } : i));
  }

  function handleSoftDelete(id: string) { setIdeaStatus(id, "deleted"); }
  function handleShelve(id: string) { setIdeaStatus(id, "shelved"); }
  function handleRestore(id: string) { setIdeaStatus(id, "active"); }
  function handlePermanentDelete(id: string) {
    if (!confirm("永久刪除後無法復原，確定嗎？")) return;
    removeIdea(id).catch(console.error);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  const [reanalyzingIds, setReanalyzingIds] = useState<Set<string>>(new Set());
  const todoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleReanalyze(idea: Idea) {
    if (reanalyzingIds.has(idea.id)) return;
    setReanalyzingIds((prev) => new Set(prev).add(idea.id));
    try {
      const result = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle: idea.title,
        ideaWhy: "",
        ideaOutcome: "",
        ideaNotes: idea.description ?? "",
        objectives,
        progressContext: objectives.map((o) => {
          const krs = o.keyResults.map((kr) => {
            if (!kr.targetValue) return `  - ${kr.title}`;
            const pct = Math.min(100, Math.round(((kr.currentValue ?? 0) / kr.targetValue) * 100));
            return `  - ${kr.title} (${pct}% complete)`;
          }).join("\n");
          return `${o.title}:\n${krs}`;
        }).join("\n\n"),
      });
      const updated: Idea = { ...idea, analysis: result, needsReanalysis: false };
      setIdeas((prev) => prev.map((i) => i.id === idea.id ? updated : i));
      saveIdea(updated).catch(console.error);
    } catch {
      // silently fail
    } finally {
      setReanalyzingIds((prev) => { const s = new Set(prev); s.delete(idea.id); return s; });
    }
  }

  function handleToggleTodo(ideaId: string, todoId: string) {
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const todos = (i.todos ?? []).map((t) =>
        t.id === todoId ? { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : undefined } : t
      );
      const updated = { ...i, todos };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
  }

  function handleAddTodoAfter(ideaId: string, afterTodoId?: string) {
    const todo: TodoItem = { id: crypto.randomUUID(), title: "", done: false };
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const todos = i.todos ?? [];
      let newTodos: TodoItem[];
      if (afterTodoId) {
        const idx = todos.findIndex((t) => t.id === afterTodoId);
        newTodos = [...todos.slice(0, idx + 1), todo, ...todos.slice(idx + 1)];
      } else {
        newTodos = [...todos, todo];
      }
      const updated = { ...i, todos: newTodos };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
    setTimeout(() => todoInputRefs.current[todo.id]?.focus(), 30);
  }

  function handleUpdateTodoTitle(ideaId: string, todoId: string, title: string) {
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const todos = (i.todos ?? []).map((t) => t.id === todoId ? { ...t, title } : t);
      const updated = { ...i, todos };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
  }

  function handleDeleteTodo(ideaId: string, todoId: string) {
    const idea = ideas.find((i) => i.id === ideaId);
    const todos = idea?.todos ?? [];
    const idx = todos.findIndex((t) => t.id === todoId);
    const prevId = idx > 0 ? todos[idx - 1].id : null;
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const updated = { ...i, todos: (i.todos ?? []).filter((t) => t.id !== todoId) };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
    if (prevId) setTimeout(() => todoInputRefs.current[prevId]?.focus(), 30);
  }

  function handleUpdateLinkedKRs(ideaId: string, links: IdeaKRLink[]) {
    setIdeas((prev) => {
      const updated = prev.map((i) => (i.id === ideaId ? { ...i, linkedKRs: links } : i));
      const idea = updated.find((i) => i.id === ideaId);
      if (idea) saveIdea(idea).catch(console.error);
      return updated;
    });
  }

  // ── Task status + KR progress update ───────────────────────────────────────

  function collectLinkedKRs(task: Idea) {
    return (task.linkedKRs ?? []).flatMap((link) => {
      const obj = objectives.find((o) => o.id === link.objectiveId);
      if (!obj) return [];
      const kr = link.krId ? obj.keyResults.find((k) => k.id === link.krId) : null;
      if (!kr) return [];
      return [{ obj, kr, link }];
    });
  }

  function handleSetTaskStatus(taskId: string, status: TaskStatus) {
    const task = ideas.find((i) => i.id === taskId);
    if (!task || task.taskStatus === status) return; // no-op if same

    const wasDown = task.taskStatus === "done";

    if (status !== "done") {
      // If reverting from done → undo KR contributions
      if (wasDown) {
        applyTaskUndo(task);
      }
      updateIdeaTaskStatus(taskId, status).catch(console.error);
      setIdeas((prev) => prev.map((i) => i.id === taskId ? { ...i, taskStatus: status } : i));
      return;
    }

    const linkedKRs = collectLinkedKRs(task);
    const hasMeasurement = linkedKRs.some((r) => (r.kr.krType ?? "cumulative") === "measurement");

    if (hasMeasurement) {
      const initInputs: Record<string, string> = {};
      linkedKRs.filter((r) => (r.kr.krType ?? "cumulative") === "measurement").forEach((r) => {
        initInputs[r.kr.id] = String(r.kr.currentValue ?? "");
      });
      setMeasureInputs((prev) => ({ ...prev, [taskId]: initInputs }));
      setPendingMeasure(taskId);
      return;
    }

    applyTaskDone(taskId, task, linkedKRs, {});
  }

  function applyTaskUndo(task: Idea) {
    const linkedKRLinks = (task.linkedKRs ?? []).filter((l) => l.krId);
    if (linkedKRLinks.length === 0) return;

    setObjectives((prevObjs) => {
      const updatedMap = new Map<string, Objective>();

      for (const link of linkedKRLinks) {
        const obj = prevObjs.find((o) => o.id === link.objectiveId);
        if (!obj || !link.krId) continue;
        const current = updatedMap.get(obj.id) ?? obj;
        const kr = current.keyResults.find((k) => k.id === link.krId);
        if (!kr) continue;
        const krType = kr.krType ?? "cumulative";
        let newValue: number | undefined;

        if (krType === "cumulative") {
          const linksInObj = linkedKRLinks.filter((l) => l.objectiveId === obj.id);
          const getScore = (krId: string) =>
            task.analysis?.objectiveScores.find((os) => os.objectiveId === obj.id)
              ?.keyResultScores.find((ks) => ks.keyResultId === krId)?.score ?? 1;
          const totalScore = linksInObj.reduce((sum, l) => sum + getScore(l.krId!), 0) || 1;
          const weight = getScore(kr.id) / totalScore;
          newValue = Math.max(0, (kr.currentValue ?? 0) - (kr.incrementPerTask ?? 1) * weight);
        } else {
          newValue = 0; // milestone and measurement: reset to 0
        }

        const updatedKRs = current.keyResults.map((k) =>
          k.id === link.krId ? { ...k, currentValue: newValue } : k
        );
        updatedMap.set(obj.id, { ...current, keyResults: updatedKRs });
      }

      updatedMap.forEach((o) => saveObjective(o).catch(console.error));
      return prevObjs.map((o) => updatedMap.get(o.id) ?? o);
    });
  }

  function confirmMeasurement(taskId: string) {
    const task = ideas.find((i) => i.id === taskId);
    if (!task) return;
    applyTaskDone(taskId, task, collectLinkedKRs(task), measureInputs[taskId] ?? {});
    setPendingMeasure(null);
  }

  function applyTaskDone(
    taskId: string,
    task: Idea,
    linkedKRs: Array<{ obj: Objective; kr: KeyResult; link: IdeaKRLink }>,
    measurements: Record<string, string>
  ) {
    // Compute AI score weights for cumulative KRs across the same objective
    // For each objective, get score weights from task.analysis
    const updatedObjectives = new Map<string, Objective>();

    for (const { obj, kr } of linkedKRs) {
      const current = updatedObjectives.get(obj.id) ?? obj;
      const krType = kr.krType ?? "cumulative";

      let newValue: number | undefined;

      if (krType === "cumulative") {
        // Weight = this KR's AI score / sum of all linked KR scores in same obj
        const linkedKRsInObj = linkedKRs.filter((r) => r.obj.id === obj.id);
        const scores = linkedKRsInObj.map((r) => {
          const objScore = task.analysis?.objectiveScores.find((os) => os.objectiveId === obj.id);
          return objScore?.keyResultScores.find((ks) => ks.keyResultId === r.kr.id)?.score ?? 1;
        });
        const thisScore = (() => {
          const objScore = task.analysis?.objectiveScores.find((os) => os.objectiveId === obj.id);
          return objScore?.keyResultScores.find((ks) => ks.keyResultId === kr.id)?.score ?? 1;
        })();
        const totalScore = scores.reduce((a, b) => a + b, 0) || 1;
        const weight = thisScore / totalScore;
        const increment = (kr.incrementPerTask ?? 1) * weight;
        newValue = Math.min(kr.targetValue ?? Infinity, (kr.currentValue ?? 0) + increment);

      } else if (krType === "measurement") {
        const raw = measurements[kr.id];
        if (raw !== undefined && raw !== "") {
          newValue = parseFloat(raw);
        }

      } else if (krType === "milestone") {
        newValue = 1; // 100% complete
      }

      if (newValue !== undefined) {
        const updatedKRs = current.keyResults.map((k) =>
          k.id === kr.id ? { ...k, currentValue: newValue } : k
        );
        updatedObjectives.set(obj.id, { ...current, keyResults: updatedKRs });
      }
    }

    // Save updated objectives
    updatedObjectives.forEach((updatedObj) => {
      saveObjective(updatedObj).catch(console.error);
    });
    setObjectives((prev) =>
      prev.map((o) => updatedObjectives.get(o.id) ?? o)
    );

    // Mark task done
    updateIdeaTaskStatus(taskId, "done").catch(console.error);
    setIdeas((prev) => {
      const updatedKRIds = new Set(linkedKRs.map((r) => r.kr.id));
      return prev.map((i) => {
        if (i.id === taskId) return { ...i, taskStatus: "done" };
        if (i.taskStatus === "done" || !i.analysis) return i;
        const linked = i.linkedKRs ?? [];
        if (!linked.some((l) => l.krId && updatedKRIds.has(l.krId))) return i;
        const updated = { ...i, needsReanalysis: true };
        saveIdea(updated).catch(console.error);
        return updated;
      });
    });
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const allKRs = objectives.flatMap((o) =>
    o.keyResults.map((kr) => ({ ...kr, objectiveTitle: o.title, objectiveId: o.id }))
  );

  const oCompletions = objectives.map(calcOCompletion).filter((v): v is number => v !== undefined);
  const avgOCompletion = oCompletions.length > 0
    ? Math.round(oCompletions.reduce((a, b) => a + b, 0) / oCompletions.length)
    : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const staleKRs = allKRs.filter((kr) => {
    if (kr.krType === "milestone") return false;
    if (!kr.targetValue || kr.targetValue <= 0) return false;
    const completion = calcKRCompletion(kr);
    if (completion !== undefined && completion >= 100) return false;
    const last = getLastCheckIn(kr);
    if (last) {
      const diff = Math.round((today.getTime() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24));
      return diff >= 7;
    }
    const obj = objectives.find((o) => o.keyResults.some((k) => k.id === kr.id));
    if (!obj) return false;
    const ageDays = Math.round((today.getTime() - new Date(obj.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    return ageDays >= 3;
  });

  const tasks = ideas.filter((i) => i.taskStatus != null);

  // warehouse filters — all ideas are tasks now
  const activeTasks = ideas.filter((i) => (i.ideaStatus ?? "active") === "active");
  const shelvedTasks = ideas.filter((i) => i.ideaStatus === "shelved");
  const deletedTasks = ideas.filter((i) => i.ideaStatus === "deleted");

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-end gap-1.5">
            <span className="text-2xl font-bold text-indigo-600">{objectives.length}</span>
            {avgOCompletion !== null && (
              <span className="text-sm font-medium text-gray-400 mb-0.5">{avgOCompletion}%</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1">目標 (O)</div>
          {avgOCompletion !== null && (
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${avgOCompletion}%` }} />
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-indigo-600">{activeTasks.length}</div>
          <div className="text-xs text-gray-500 mt-1">Tasks</div>
          <div className="mt-1 text-xs space-x-1">
            {activeTasks.filter(t => t.taskStatus === "in-progress").length > 0 && <span className="text-amber-500">{activeTasks.filter(t => t.taskStatus === "in-progress").length} 進行中</span>}
            {activeTasks.filter(t => t.taskStatus === "done").length > 0 && <span className="text-green-500">{activeTasks.filter(t => t.taskStatus === "done").length} 完成</span>}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-indigo-600">{tasks.filter(t => t.taskStatus === "done").length}</div>
          <div className="text-xs text-gray-500 mt-1">已完成</div>
          {staleKRs.length > 0 && <div className="mt-1 text-xs text-amber-500">{staleKRs.length} 子目標待更新</div>}
        </div>
      </div>

      {/* ── Stale KRs ───────────────────────────────────────────────────────── */}
      {staleKRs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-700">尚未更新進度</h2>
            <span className="text-xs text-gray-400">{staleKRs.length} 個子目標超過 7 天未記錄</span>
          </div>
          <div className="space-y-2">
            {staleKRs.slice(0, 5).map((kr) => {
              const last = getLastCheckIn(kr);
              const daysOld = last
                ? Math.round((today.getTime() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24))
                : null;
              return (
                <div key={kr.id} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{kr.title}</p>
                    <p className="text-xs text-gray-400 truncate">{kr.objectiveTitle}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {daysOld !== null ? `${daysOld}天前` : "從未更新"}
                  </span>
                </div>
              );
            })}
            {staleKRs.length > 5 && (
              <Link href="/okr" className="text-xs text-indigo-500 hover:text-indigo-700 block mt-1">
                查看全部 {staleKRs.length} 條 →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ── OKR Progress (expandable) ────────────────────────────────────────── */}
      {objectives.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">目標進度</h2>
            <Link href="/okr" className="text-xs text-indigo-500 hover:text-indigo-700">管理 →</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {objectives.map((o) => {
              const completion = calcOCompletion(o);
              const isExpanded = expandedObjId === o.id;
              const linkedTaskCount = ideas.filter(
                (t) => t.linkedKRs?.some((l) => l.objectiveId === o.id)
              ).length;
              return (
                <div key={o.id}>
                  <button
                    onClick={() => setExpandedObjId(isExpanded ? null : o.id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-gray-800 truncate flex-1 mr-3 font-medium">{o.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {linkedTaskCount > 0 && (
                          <span className="text-xs text-indigo-400">{linkedTaskCount} task</span>
                        )}
                        {completion !== undefined && (
                          <span className={`text-xs font-bold ${
                            completion >= 70 ? "text-green-600" : completion >= 40 ? "text-amber-500" : "text-red-500"
                          }`}>{completion}%</span>
                        )}
                        <span className="text-gray-300 text-xs">{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {completion !== undefined && (
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${getProgressColor(completion)}`}
                          style={{ width: `${completion}%` }}
                        />
                      </div>
                    )}
                    {completion === undefined && (
                      <p className="text-xs text-gray-400">尚無可追蹤的子目標</p>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-3 space-y-2">
                      {o.keyResults.map((kr) => {
                        const krCompletion = calcKRCompletion(kr);
                        const krType = kr.krType ?? "cumulative";
                        const typeIcon = krType === "measurement" ? "📊" : krType === "milestone" ? "✅" : "📈";
                        return (
                          <div key={kr.id} className="flex items-start gap-2 pl-2">
                            <div className="w-1 h-1 rounded-full bg-gray-300 shrink-0 mt-2" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-[11px] shrink-0">{typeIcon}</span>
                                <p className="text-xs text-gray-600 truncate flex-1">{kr.title}</p>
                              </div>
                              {krType === "milestone" ? (
                                <div className="flex items-center gap-1.5 ml-4">
                                  <div className={`w-3 h-3 rounded border flex items-center justify-center ${kr.currentValue && kr.currentValue >= 1 ? "bg-green-500 border-green-500" : "border-gray-300"}`}>
                                    {kr.currentValue && kr.currentValue >= 1 && <span className="text-white text-[8px]">✓</span>}
                                  </div>
                                  <span className={`text-xs ${kr.currentValue && kr.currentValue >= 1 ? "text-green-600 font-medium" : "text-gray-400"}`}>
                                    {kr.currentValue && kr.currentValue >= 1 ? "已達成" : "未達成"}
                                  </span>
                                </div>
                              ) : krCompletion !== undefined ? (
                                <div className="flex items-center gap-2 ml-4">
                                  <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${getProgressColor(krCompletion)}`} style={{ width: `${krCompletion}%` }} />
                                  </div>
                                  <span className="text-xs text-gray-400 shrink-0">
                                    {kr.currentValue ?? 0}{kr.unit ? ` ${kr.unit}` : ""} / {kr.targetValue}{kr.unit ? ` ${kr.unit}` : ""}
                                  </span>
                                </div>
                              ) : null}
                            </div>
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
      )}

      {/* ── Tasks 倉庫 ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-700">Tasks{activeTasks.length > 0 ? ` ${activeTasks.length}` : ""}</span>
          <Link href="/idea/new" className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">+ 新增</Link>
        </div>

        {/* Sub-filter */}
        <div className="flex gap-1 px-4 py-2 border-b border-gray-100">
          {(["active", "shelved", "deleted"] as const).map((f) => {
            const count = f === "active" ? activeTasks.length : f === "shelved" ? shelvedTasks.length : deletedTasks.length;
            return (
              <button key={f} onClick={() => setTaskFilter(f)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${taskFilter === f ? "bg-indigo-50 text-indigo-600 font-medium" : "text-gray-400 hover:text-gray-600"}`}>
                {f === "active" ? "進行中" : f === "shelved" ? "暫存" : "垃圾桶"}{count > 0 ? ` ${count}` : ""}
              </button>
            );
          })}
        </div>

        {/* Shelved */}
        {taskFilter === "shelved" && (
          shelvedTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">沒有暫存的 Task</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {shelvedTasks.map((idea) => (
                <div key={idea.id} className="px-4 py-3 flex items-center gap-2">
                  <p className="text-sm text-gray-700 flex-1 truncate">{idea.title}</p>
                  {idea.taskStatus && <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${TASK_STATUS_STYLE[idea.taskStatus]}`}>{TASK_STATUS_LABEL[idea.taskStatus]}</span>}
                  <button onClick={() => handleRestore(idea.id)} className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 whitespace-nowrap shrink-0">還原</button>
                  <button onClick={() => handleSoftDelete(idea.id)} className="text-gray-300 hover:text-red-400 text-base leading-none px-1 shrink-0">×</button>
                </div>
              ))}
            </div>
          )
        )}

        {/* Deleted */}
        {taskFilter === "deleted" && (
          deletedTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">垃圾桶是空的</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {deletedTasks.map((idea) => (
                <div key={idea.id} className="px-4 py-3 flex items-center gap-2 opacity-60">
                  <p className="text-sm text-gray-500 flex-1 truncate line-through">{idea.title}</p>
                  <button onClick={() => handleRestore(idea.id)} className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 whitespace-nowrap shrink-0">還原</button>
                  <button onClick={() => handlePermanentDelete(idea.id)} className="text-xs text-red-400 hover:text-red-600 whitespace-nowrap shrink-0">永久刪除</button>
                </div>
              ))}
            </div>
          )
        )}

        {/* Active */}
        {taskFilter === "active" && (
          activeTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">還沒有 Task，點擊「+ 新增」開始</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {[...activeTasks]
                .sort((a, b) => {
                  const aDone = a.taskStatus === "done" ? 1 : 0;
                  const bDone = b.taskStatus === "done" ? 1 : 0;
                  if (aDone !== bDone) return aDone - bDone;
                  return (calcScore(b) ?? -1) - (calcScore(a) ?? -1);
                })
                .map((idea) => {
                  const isExpanded = expandedIdeaId === idea.id;
                  const isDone = idea.taskStatus === "done";
                  const isMeasurePending = pendingMeasure === idea.id;
                  const links = idea.linkedKRs ?? [];
                  const isPicking = showObjPickerId === idea.id;
                  const measureKRs = links.flatMap((link) => {
                    if (!link.krId) return [];
                    const obj = objectives.find((o) => o.id === link.objectiveId);
                    const kr = obj?.keyResults.find((k) => k.id === link.krId);
                    if (!kr || (kr.krType ?? "cumulative") !== "measurement") return [];
                    return [{ obj: obj!, kr }];
                  });

                  return (
                    <div key={idea.id} className={isDone ? "opacity-60" : ""}>
                      {/* Row */}
                      <div className="px-4 py-3 flex items-center gap-2">
                        <button onClick={() => setExpandedIdeaId(isExpanded ? null : idea.id)}
                          className="flex-1 text-left flex items-center gap-2 min-w-0">
                          <p className={`text-sm text-gray-800 flex-1 truncate ${isDone ? "line-through text-gray-400" : ""}`}>{idea.title}</p>
                          <span className="text-gray-300 text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
                        </button>
                        <div className="flex gap-1 shrink-0">
                          {(["todo", "in-progress", "done"] as TaskStatus[]).map((s) => (
                            <button key={s}
                              onClick={(e) => { e.stopPropagation(); handleSetTaskStatus(idea.id, s); }}
                              className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap transition-colors ${idea.taskStatus === s ? TASK_STATUS_STYLE[s] + " font-medium" : "text-gray-300 hover:text-gray-500"}`}
                            >{TASK_STATUS_LABEL[s]}</button>
                          ))}
                        </div>
                        {idea.needsReanalysis && (
                          <button onClick={() => handleReanalyze(idea)} disabled={reanalyzingIds.has(idea.id)}
                            className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-300 hover:bg-amber-100 transition-colors whitespace-nowrap disabled:opacity-50">
                            {reanalyzingIds.has(idea.id) ? "評估中…" : "重新評估"}
                          </button>
                        )}
                        <button onClick={() => handleShelve(idea.id)} className="shrink-0 text-gray-300 hover:text-amber-500 transition-colors text-xs px-1" title="暫存">⊸</button>
                        <button onClick={() => handleSoftDelete(idea.id)} className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-base leading-none px-1">×</button>
                      </div>

                      {/* Expanded */}
                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 bg-gray-50 border-t border-gray-100">

                          {/* Todos */}
                          {(() => {
                            const todos = idea.todos ?? [];
                            const doneCount = todos.filter((t) => t.done).length;
                            const allDone = todos.length > 0 && doneCount === todos.length;
                            const pct = todos.length > 0 ? Math.round((doneCount / todos.length) * 100) : 0;
                            return (
                              <div className="pt-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-medium text-gray-600">子任務</span>
                                  {todos.length > 0 && (
                                    <>
                                      <span className="text-xs text-gray-400">{doneCount}/{todos.length}</span>
                                      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                        <div className={`h-full rounded-full transition-all ${getProgressColor(pct)}`} style={{ width: `${pct}%` }} />
                                      </div>
                                      {allDone && idea.taskStatus !== "done" && (
                                        <button onClick={() => handleSetTaskStatus(idea.id, "done")}
                                          className="text-xs px-2 py-0.5 bg-green-600 text-white rounded-lg hover:bg-green-700 shrink-0 whitespace-nowrap">
                                          標記完成
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                                <div className="space-y-0.5">
                                  {todos.map((todo) => (
                                    <div key={todo.id} className="flex items-center gap-2 group rounded-md px-1 py-0.5 hover:bg-white">
                                      <button onClick={() => handleToggleTodo(idea.id, todo.id)}
                                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${todo.done ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-indigo-400"}`}>
                                        {todo.done && <span className="text-white text-[9px] leading-none">✓</span>}
                                      </button>
                                      <input ref={(el) => { todoInputRefs.current[todo.id] = el; }} type="text"
                                        defaultValue={todo.title}
                                        onBlur={(e) => handleUpdateTodoTitle(idea.id, todo.id, e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") { e.preventDefault(); handleAddTodoAfter(idea.id, todo.id); }
                                          if (e.key === "Backspace" && e.currentTarget.value === "") { e.preventDefault(); handleDeleteTodo(idea.id, todo.id); }
                                        }}
                                        className={`flex-1 text-xs bg-transparent border-none outline-none py-0.5 ${todo.done ? "line-through text-gray-400" : "text-gray-700"}`}
                                        placeholder="待辦事項" />
                                    </div>
                                  ))}
                                  <button onClick={() => handleAddTodoAfter(idea.id)}
                                    className="flex items-center gap-2 w-full px-1 py-0.5 text-xs text-gray-400 hover:text-gray-600 rounded-md hover:bg-white transition-colors">
                                    <span className="w-4 h-4 shrink-0 flex items-center justify-center text-gray-300 text-base leading-none">+</span>
                                    新增待辦
                                  </button>
                                </div>
                              </div>
                            );
                          })()}

                          {/* 任務分析（可折疊）*/}
                          {idea.analysis && (() => {
                            const isAnalysisOpen = expandedAnalysisIds.has(idea.id);
                            return (
                              <div className="border-t border-gray-100 pt-3">
                                <button onClick={() => setExpandedAnalysisIds((prev) => { const s = new Set(prev); isAnalysisOpen ? s.delete(idea.id) : s.add(idea.id); return s; })}
                                  className="flex items-center gap-1.5 w-full text-left">
                                  <span className="text-xs font-medium text-gray-600">任務分析</span>
                                  <span className="text-gray-300 text-[10px]">{isAnalysisOpen ? "▲" : "▼"}</span>
                                </button>
                                {isAnalysisOpen && (
                                  <div className="space-y-2 mt-2">
                                    {idea.analysis.objectiveScores.map((os) => (
                                      <div key={os.objectiveId}>
                                        <div className="flex justify-between items-center mb-0.5">
                                          <span className="text-xs text-gray-600 truncate flex-1 mr-2">{os.objectiveTitle}</span>
                                          <span className={`text-xs font-bold shrink-0 ${os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-500"}`}>{os.overallScore.toFixed(1)}</span>
                                        </div>
                                        <p className="text-xs text-gray-500">{os.reasoning}</p>
                                        <div className="space-y-0.5 pl-2 mt-1">
                                          {os.keyResultScores.map((krs) => (
                                            <ScoreBar key={krs.keyResultId} score={krs.score} label={krs.keyResultTitle} />
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                    {idea.analysis.risks.length > 0 && (
                                      <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
                                        <span className="font-medium">風險：</span>{idea.analysis.risks.join("；")}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* 指定子目標 */}
                          <div className="border-t border-gray-100 pt-3 space-y-1.5">
                            <LinkedObjsEditable links={links} objectives={objectives}
                              onRemove={(idx) => handleUpdateLinkedKRs(idea.id, links.filter((_, i) => i !== idx))} />
                            <button onClick={() => setShowObjPickerId(isPicking ? null : idea.id)} className="text-xs text-indigo-500 hover:text-indigo-700">
                              {isPicking ? "完成指定" : "＋ 指定子目標"}
                            </button>
                            {isPicking && (
                              <div className="border border-gray-200 rounded-lg overflow-hidden">
                                {objectives.map((obj) => (
                                  <div key={obj.id}>
                                    <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-100">{obj.title}</div>
                                    {obj.keyResults.map((kr) => {
                                      const alreadyLinked = links.some((l) => l.krId === kr.id);
                                      const typeIcon = (kr.krType ?? "cumulative") === "measurement" ? "📊" : kr.krType === "milestone" ? "✅" : "📈";
                                      return (
                                        <button key={kr.id}
                                          onClick={() => alreadyLinked
                                            ? handleUpdateLinkedKRs(idea.id, links.filter((l) => l.krId !== kr.id))
                                            : handleUpdateLinkedKRs(idea.id, [...links, { objectiveId: obj.id, krId: kr.id }])}
                                          className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 transition-colors border-b border-gray-50 ${alreadyLinked ? "text-indigo-600 bg-indigo-50" : "text-gray-700"}`}>
                                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[10px] ${alreadyLinked ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300"}`}>
                                            {alreadyLinked && "✓"}
                                          </span>
                                          <span className="flex-1 truncate">{kr.title}</span>
                                          <span className="text-gray-400 shrink-0">{typeIcon}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Measurement input */}
                          {isMeasurePending && measureKRs.length > 0 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 space-y-2">
                              <p className="text-xs font-medium text-amber-700">完成前，請填入目前的數值：</p>
                              {measureKRs.map(({ kr }) => (
                                <div key={kr.id} className="flex items-center gap-2">
                                  <label className="text-xs text-gray-600 flex-1 truncate">{kr.title}</label>
                                  <input type="number"
                                    value={measureInputs[idea.id]?.[kr.id] ?? ""}
                                    onChange={(e) => setMeasureInputs((prev) => ({ ...prev, [idea.id]: { ...(prev[idea.id] ?? {}), [kr.id]: e.target.value } }))}
                                    placeholder={`目前 ${kr.metricName ?? "數值"}（${kr.unit ?? ""}）`}
                                    className="w-32 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                                </div>
                              ))}
                              <div className="flex gap-2 pt-1">
                                <button onClick={() => confirmMeasurement(idea.id)} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">確認完成</button>
                                <button onClick={() => setPendingMeasure(null)} className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50">取消</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
