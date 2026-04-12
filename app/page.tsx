"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Idea, Objective, KeyResult, CheckIn, TaskStatus, IdeaKRLink } from "@/lib/types";
import { fetchIdeas, fetchObjectives, removeIdea, saveIdea, saveObjective, updateIdeaTaskStatus } from "@/lib/db";
import ScoreBar from "@/components/ScoreBar";

type TaskTab = "priority" | "assign" | "progress";

// Pending measurement inputs: taskId → { krId → value string }
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

const TASK_STATUS_STYLE: Record<TaskStatus, string> = {
  todo: "bg-gray-100 text-gray-500",
  "in-progress": "bg-amber-50 text-amber-600",
  done: "bg-green-50 text-green-600",
};

export default function DashboardPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [expandedObjId, setExpandedObjId] = useState<string | null>(null);
  const [taskTab, setTaskTab] = useState<TaskTab>("priority");
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null);
  const [showObjPickerId, setShowObjPickerId] = useState<string | null>(null);
  // measurement: taskId that is awaiting measurement input before marking done
  const [pendingMeasure, setPendingMeasure] = useState<string | null>(null);
  const [measureInputs, setMeasureInputs] = useState<MeasurementInputs>({});

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  // ── Ideas helpers ───────────────────────────────────────────────────────────

  function handleDelete(id: string) {
    if (!confirm("確定要刪除這個 Idea？")) return;
    removeIdea(id).catch(console.error);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  function handlePromoteToTask(id: string) {
    updateIdeaTaskStatus(id, "todo").catch(console.error);
    setIdeas((prev) => prev.map((i) => i.id === id ? { ...i, taskStatus: "todo" } : i));
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

  function handleSetTaskStatus(taskId: string, status: TaskStatus) {
    if (status !== "done") {
      updateIdeaTaskStatus(taskId, status).catch(console.error);
      setIdeas((prev) => prev.map((i) => i.id === taskId ? { ...i, taskStatus: status } : i));
      return;
    }

    const task = ideas.find((i) => i.id === taskId);
    if (!task) return;
    const links = task.linkedKRs ?? [];

    // Collect all linked KRs with their type
    const linkedKRs = links.flatMap((link) => {
      const obj = objectives.find((o) => o.id === link.objectiveId);
      if (!obj) return [];
      const kr = link.krId ? obj.keyResults.find((k) => k.id === link.krId) : null;
      if (!kr) return [];
      return [{ obj, kr, link }];
    });

    const hasMeasurement = linkedKRs.some((r) => (r.kr.krType ?? "cumulative") === "measurement");

    if (hasMeasurement) {
      // Show inline measurement inputs before confirming done
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

  function confirmMeasurement(taskId: string) {
    const task = ideas.find((i) => i.id === taskId);
    if (!task) return;
    const links = task.linkedKRs ?? [];
    const linkedKRs = links.flatMap((link) => {
      const obj = objectives.find((o) => o.id === link.objectiveId);
      if (!obj) return [];
      const kr = link.krId ? obj.keyResults.find((k) => k.id === link.krId) : null;
      if (!kr) return [];
      return [{ obj, kr, link }];
    });
    applyTaskDone(taskId, task, linkedKRs, measureInputs[taskId] ?? {});
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
    setIdeas((prev) => prev.map((i) => i.id === taskId ? { ...i, taskStatus: "done" } : i));
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
  const nonTasks = ideas.filter((i) => i.taskStatus == null);
  const tasksSortedByScore = [...tasks].sort(
    (a, b) => (b.analysis?.finalScore ?? -1) - (a.analysis?.finalScore ?? -1)
  );
  const taskStatusCounts = {
    todo: tasks.filter((t) => t.taskStatus === "todo").length,
    "in-progress": tasks.filter((t) => t.taskStatus === "in-progress").length,
    done: tasks.filter((t) => t.taskStatus === "done").length,
  };

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
          <div className="text-2xl font-bold text-indigo-600">{tasks.length}</div>
          <div className="text-xs text-gray-500 mt-1">Tasks</div>
          <div className="mt-1 text-xs space-x-1">
            {taskStatusCounts["in-progress"] > 0 && <span className="text-amber-500">{taskStatusCounts["in-progress"]} 進行中</span>}
            {taskStatusCounts.done > 0 && <span className="text-green-500">{taskStatusCounts.done} 完成</span>}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-indigo-600">{ideas.length}</div>
          <div className="text-xs text-gray-500 mt-1">Ideas</div>
          {nonTasks.length > 0 && <div className="mt-1 text-xs text-gray-400">{nonTasks.length} 待評估</div>}
        </div>
      </div>

      {/* ── Stale KRs ───────────────────────────────────────────────────────── */}
      {staleKRs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-700">尚未更新進度</h2>
            <span className="text-xs text-gray-400">{staleKRs.length} 條 KR 超過 7 天未記錄</span>
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
              const linkedTaskCount = tasks.filter(
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
                      <p className="text-xs text-gray-400">尚無可追蹤的 KR</p>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-3 space-y-2">
                      {o.keyResults.map((kr) => {
                        const krCompletion = calcKRCompletion(kr);
                        const krTypeLabel = kr.krType === "measurement" ? "測量" : kr.krType === "milestone" ? "里程碑" : "累積";
                        return (
                          <div key={kr.id} className="flex items-center gap-3 pl-2">
                            <div className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs text-gray-600 truncate">{kr.title}</p>
                                <span className="text-[10px] text-gray-400 shrink-0">{krTypeLabel}</span>
                              </div>
                              {krCompletion !== undefined && (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${getProgressColor(krCompletion)}`}
                                      style={{ width: `${krCompletion}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-400 w-8 text-right shrink-0">
                                    {kr.krType === "milestone"
                                      ? (krCompletion === 100 ? "完成" : "未完成")
                                      : `${kr.currentValue ?? 0}${kr.unit ? ` ${kr.unit}` : ""} / ${kr.targetValue}${kr.unit ? ` ${kr.unit}` : ""}`
                                    }
                                  </span>
                                </div>
                              )}
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

      {/* ── Task 管理 ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Task 管理</h2>
          <Link href="/idea/new" className="text-xs text-indigo-500 hover:text-indigo-700">+ 新增 Idea</Link>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-100">
          {([["priority", "優先級"], ["assign", "分配目標"], ["progress", "追蹤進度"]] as [TaskTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTaskTab(key)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                taskTab === key
                  ? "text-indigo-600 border-b-2 border-indigo-500 -mb-px"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Promote Ideas */}
        {nonTasks.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-500 mb-2">Ideas 待轉為 Task</p>
            <div className="space-y-1.5">
              {nonTasks.slice(0, 3).map((idea) => (
                <div key={idea.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{idea.title}</p>
                    {idea.analysis && (
                      <span className={`text-xs font-bold ${
                        idea.analysis.finalScore >= 7 ? "text-indigo-600"
                        : idea.analysis.finalScore >= 4 ? "text-amber-500"
                        : "text-red-500"
                      }`}>{idea.analysis.finalScore.toFixed(1)}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handlePromoteToTask(idea.id)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0"
                  >
                    轉為 Task
                  </button>
                </div>
              ))}
              {nonTasks.length > 3 && (
                <p className="text-xs text-gray-400">還有 {nonTasks.length - 3} 個 Ideas…</p>
              )}
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            還沒有 Task，從上方 Ideas 轉入
          </div>
        ) : (
          <div>
            {/* ── 優先級 tab ── */}
            {taskTab === "priority" && (
              <div className="divide-y divide-gray-50">
                {tasksSortedByScore.map((task, idx) => {
                  const isExpanded = expandedIdeaId === task.id;
                  const score = task.analysis?.finalScore;
                  return (
                    <div key={task.id}>
                      <button
                        onClick={() => setExpandedIdeaId(isExpanded ? null : task.id)}
                        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                      >
                        <span className="text-xs font-bold text-gray-300 w-4 shrink-0">#{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{task.title}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${TASK_STATUS_STYLE[task.taskStatus!]}`}>
                            {TASK_STATUS_LABEL[task.taskStatus!]}
                          </span>
                        </div>
                        {score !== undefined && (
                          <span className={`text-lg font-bold shrink-0 ${
                            score >= 7 ? "text-indigo-600" : score >= 4 ? "text-amber-500" : "text-red-500"
                          }`}>{score.toFixed(1)}</span>
                        )}
                        <span className="text-gray-300 text-xs">{isExpanded ? "▲" : "▼"}</span>
                      </button>
                      {isExpanded && task.analysis && (
                        <div className="px-4 pb-3 space-y-2 bg-gray-50">
                          {task.analysis.objectiveScores.map((os) => (
                            <div key={os.objectiveId}>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs font-medium text-gray-600">{os.objectiveTitle}</span>
                                <span className={`text-xs font-bold ${
                                  os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-500"
                                }`}>{os.overallScore.toFixed(1)}</span>
                              </div>
                              <div className="space-y-0.5 pl-2">
                                {os.keyResultScores.map((krs) => (
                                  <ScoreBar key={krs.keyResultId} score={krs.score} label={krs.keyResultTitle} />
                                ))}
                              </div>
                            </div>
                          ))}
                          {task.analysis.risks.length > 0 && (
                            <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
                              <span className="font-medium">風險：</span>{task.analysis.risks.join("；")}
                            </div>
                          )}
                          {task.analysis.executionSuggestions.length > 0 && (
                            <div className="text-xs text-gray-600 bg-white rounded-lg px-3 py-2 border border-gray-100">
                              <span className="font-medium text-gray-700">執行建議：</span>
                              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                                {task.analysis.executionSuggestions.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── 分配目標 tab ── */}
            {taskTab === "assign" && (
              <div className="divide-y divide-gray-50">
                {tasksSortedByScore.map((task) => {
                  const links = task.linkedKRs ?? [];
                  const isPicking = showObjPickerId === task.id;

                  return (
                    <div key={task.id} className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{task.title}</p>
                          {task.analysis?.finalScore !== undefined && (
                            <span className={`text-xs font-bold ${
                              task.analysis.finalScore >= 7 ? "text-indigo-600"
                              : task.analysis.finalScore >= 4 ? "text-amber-500"
                              : "text-red-500"
                            }`}>{task.analysis.finalScore.toFixed(1)}</span>
                          )}
                        </div>
                        <button
                          onClick={() => setShowObjPickerId(isPicking ? null : task.id)}
                          className="text-xs text-indigo-500 hover:text-indigo-700 shrink-0"
                        >
                          {isPicking ? "完成" : "指定 KR"}
                        </button>
                      </div>

                      {/* Current links */}
                      {links.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {links.map((link, li) => {
                            const obj = objectives.find((o) => o.id === link.objectiveId);
                            const kr = link.krId ? obj?.keyResults.find((k) => k.id === link.krId) : null;
                            if (!obj) return null;
                            return (
                              <span key={li} className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md">
                                <span className="max-w-[200px] truncate">
                                  {kr ? kr.title : obj.title}
                                </span>
                                <button
                                  onClick={() => handleUpdateLinkedKRs(
                                    task.id,
                                    links.filter((_, i) => i !== li)
                                  )}
                                  className="text-indigo-400 hover:text-indigo-700 leading-none ml-0.5"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* KR picker: two-level */}
                      {isPicking && (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          {objectives.map((obj) => (
                            <div key={obj.id}>
                              <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-100">
                                {obj.title}
                              </div>
                              {obj.keyResults.map((kr) => {
                                const alreadyLinked = links.some((l) => l.krId === kr.id);
                                const krTypeLabel = kr.krType === "measurement" ? "測量" : kr.krType === "milestone" ? "里程碑" : "累積";
                                return (
                                  <button
                                    key={kr.id}
                                    onClick={() => {
                                      if (alreadyLinked) {
                                        handleUpdateLinkedKRs(task.id, links.filter((l) => l.krId !== kr.id));
                                      } else {
                                        handleUpdateLinkedKRs(task.id, [...links, { objectiveId: obj.id, krId: kr.id }]);
                                      }
                                    }}
                                    className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 transition-colors border-b border-gray-50 ${
                                      alreadyLinked ? "text-indigo-600 bg-indigo-50" : "text-gray-700"
                                    }`}
                                  >
                                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[10px] ${
                                      alreadyLinked ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300"
                                    }`}>
                                      {alreadyLinked && "✓"}
                                    </span>
                                    <span className="flex-1 truncate">{kr.title}</span>
                                    <span className="text-gray-400 shrink-0">{krTypeLabel}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── 追蹤進度 tab ── */}
            {taskTab === "progress" && (
              <div>
                {(["todo", "in-progress", "done"] as TaskStatus[]).map((status) => {
                  const group = tasks.filter((t) => t.taskStatus === status);
                  if (group.length === 0) return null;
                  return (
                    <div key={status}>
                      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${TASK_STATUS_STYLE[status]}`}>
                          {TASK_STATUS_LABEL[status]}
                        </span>
                        <span className="text-xs text-gray-400 ml-2">{group.length}</span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {group.map((task) => {
                          const isMeasurePending = pendingMeasure === task.id;
                          const links = task.linkedKRs ?? [];
                          const measureKRs = links.flatMap((link) => {
                            if (!link.krId) return [];
                            const obj = objectives.find((o) => o.id === link.objectiveId);
                            const kr = obj?.keyResults.find((k) => k.id === link.krId);
                            if (!kr || (kr.krType ?? "cumulative") !== "measurement") return [];
                            return [{ obj: obj!, kr }];
                          });

                          return (
                            <div key={task.id} className="px-4 py-3 space-y-2">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-800 truncate">{task.title}</p>
                                  {links.length > 0 && (
                                    <p className="text-xs text-gray-400 truncate mt-0.5">
                                      {links
                                        .map((l) => {
                                          const obj = objectives.find((o) => o.id === l.objectiveId);
                                          const kr = l.krId ? obj?.keyResults.find((k) => k.id === l.krId) : null;
                                          return kr?.title ?? obj?.title;
                                        })
                                        .filter(Boolean)
                                        .join("、")}
                                    </p>
                                  )}
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  {(["todo", "in-progress", "done"] as TaskStatus[]).map((s) => (
                                    <button
                                      key={s}
                                      onClick={() => handleSetTaskStatus(task.id, s)}
                                      className={`text-xs px-2 py-1 rounded transition-colors ${
                                        task.taskStatus === s
                                          ? TASK_STATUS_STYLE[s] + " font-medium"
                                          : "text-gray-400 hover:text-gray-600"
                                      }`}
                                    >
                                      {TASK_STATUS_LABEL[s]}
                                    </button>
                                  ))}
                                </div>
                                <button onClick={() => handleDelete(task.id)} className="text-xs text-gray-300 hover:text-red-400 shrink-0">
                                  ×
                                </button>
                              </div>

                              {/* Measurement input panel */}
                              {isMeasurePending && measureKRs.length > 0 && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 space-y-2">
                                  <p className="text-xs font-medium text-amber-700">完成前，請填入目前的數值：</p>
                                  {measureKRs.map(({ kr }) => (
                                    <div key={kr.id} className="flex items-center gap-2">
                                      <label className="text-xs text-gray-600 flex-1 truncate">{kr.title}</label>
                                      <input
                                        type="number"
                                        value={measureInputs[task.id]?.[kr.id] ?? ""}
                                        onChange={(e) =>
                                          setMeasureInputs((prev) => ({
                                            ...prev,
                                            [task.id]: { ...(prev[task.id] ?? {}), [kr.id]: e.target.value },
                                          }))
                                        }
                                        placeholder={`目前 ${kr.metricName ?? "數值"}（${kr.unit ?? ""}）`}
                                        className="w-32 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                      />
                                    </div>
                                  ))}
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      onClick={() => confirmMeasurement(task.id)}
                                      className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                                    >
                                      確認完成
                                    </button>
                                    <button
                                      onClick={() => setPendingMeasure(null)}
                                      className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50"
                                    >
                                      取消
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
