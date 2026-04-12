"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Idea, Objective, KeyResult, CheckIn, TaskStatus } from "@/lib/types";
import { fetchIdeas, fetchObjectives, removeIdea, saveIdea, updateIdeaTaskStatus } from "@/lib/db";
import ScoreBar from "@/components/ScoreBar";

type TaskTab = "priority" | "assign" | "progress";

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

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  // ── Ideas helpers ────────────────────────────────────────────────────────────

  function handleDelete(id: string) {
    if (!confirm("確定要刪除這個 Idea？")) return;
    removeIdea(id).catch(console.error);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  function handlePromoteToTask(id: string) {
    updateIdeaTaskStatus(id, "todo").catch(console.error);
    setIdeas((prev) => prev.map((i) => i.id === id ? { ...i, taskStatus: "todo" } : i));
  }

  function handleSetTaskStatus(id: string, status: TaskStatus) {
    updateIdeaTaskStatus(id, status).catch(console.error);
    setIdeas((prev) => prev.map((i) => i.id === id ? { ...i, taskStatus: status } : i));
  }

  function handleUpdateLinkedObjectives(ideaId: string, objectiveIds: string[]) {
    const links = objectiveIds.map((objectiveId) => ({ objectiveId }));
    setIdeas((prev) => {
      const updated = prev.map((i) => (i.id === ideaId ? { ...i, linkedKRs: links } : i));
      const idea = updated.find((i) => i.id === ideaId);
      if (idea) saveIdea(idea).catch(console.error);
      return updated;
    });
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

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
          <div className="mt-1 text-xs text-gray-400 space-x-1">
            {taskStatusCounts["in-progress"] > 0 && <span className="text-amber-500">{taskStatusCounts["in-progress"]} 進行中</span>}
            {taskStatusCounts.done > 0 && <span className="text-green-500">{taskStatusCounts.done} 完成</span>}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-indigo-600">{ideas.length}</div>
          <div className="text-xs text-gray-500 mt-1">Ideas</div>
          <div className="mt-1 text-xs text-gray-400">
            {nonTasks.length > 0 && <span>{nonTasks.length} 待評估</span>}
          </div>
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
              const linkedCount = ideas.filter(
                (i) => i.linkedKRs?.some((l) => l.objectiveId === o.id)
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
                        {linkedCount > 0 && (
                          <span className="text-xs text-indigo-400">{linkedCount} task</span>
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
                        return (
                          <div key={kr.id} className="flex items-center gap-3 pl-2">
                            <div className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-600 truncate">{kr.title}</p>
                              {krCompletion !== undefined && (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${getProgressColor(krCompletion)}`}
                                      style={{ width: `${krCompletion}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-400 w-8 text-right shrink-0">
                                    {krCompletion}%
                                  </span>
                                </div>
                              )}
                              {krCompletion === undefined && (
                                <p className="text-xs text-gray-300 mt-0.5">無數值追蹤</p>
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

        {/* Promote Ideas section (shown in all tabs when there are non-tasks) */}
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
                  const linkedObjectiveIds = Array.from(
                    new Set((task.linkedKRs ?? []).map((l) => l.objectiveId))
                  );
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
                          {isPicking ? "完成" : "指定目標"}
                        </button>
                      </div>

                      {linkedObjectiveIds.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {linkedObjectiveIds.map((id) => {
                            const obj = objectives.find((o) => o.id === id);
                            if (!obj) return null;
                            return (
                              <span key={id} className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md">
                                <span className="max-w-[160px] truncate">{obj.title}</span>
                                <button
                                  onClick={() => handleUpdateLinkedObjectives(
                                    task.id,
                                    linkedObjectiveIds.filter((oid) => oid !== id)
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

                      {isPicking && (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          {objectives.map((obj) => {
                            const linked = linkedObjectiveIds.includes(obj.id);
                            return (
                              <button
                                key={obj.id}
                                onClick={() =>
                                  handleUpdateLinkedObjectives(
                                    task.id,
                                    linked
                                      ? linkedObjectiveIds.filter((id) => id !== obj.id)
                                      : [...linkedObjectiveIds, obj.id]
                                  )
                                }
                                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                                  linked ? "text-indigo-600 bg-indigo-50" : "text-gray-700"
                                }`}
                              >
                                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[10px] ${
                                  linked ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300"
                                }`}>
                                  {linked && "✓"}
                                </span>
                                <span className="truncate">{obj.title}</span>
                              </button>
                            );
                          })}
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
                        {group.map((task) => (
                          <div key={task.id} className="px-4 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 truncate">{task.title}</p>
                              {task.linkedKRs && task.linkedKRs.length > 0 && (
                                <p className="text-xs text-gray-400 truncate mt-0.5">
                                  {task.linkedKRs
                                    .map((l) => objectives.find((o) => o.id === l.objectiveId)?.title)
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
                            <button onClick={() => handleDelete(task.id)} className="text-xs text-gray-300 hover:text-red-400 transition-colors shrink-0">
                              ×
                            </button>
                          </div>
                        ))}
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
