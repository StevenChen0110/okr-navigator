"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Idea, Objective, KeyResult, CheckIn } from "@/lib/types";
import { fetchIdeas, fetchObjectives } from "@/lib/db";

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

const TASK_STATUS_LABEL = { todo: "待辦", "in-progress": "進行中", done: "完成" } as const;
const TASK_STATUS_STYLE = {
  todo: "bg-gray-100 text-gray-500",
  "in-progress": "bg-amber-50 text-amber-600",
  done: "bg-green-50 text-green-600",
} as const;

export default function DashboardPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [expandedObjId, setExpandedObjId] = useState<string | null>(null);

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

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
    return Math.round((today.getTime() - new Date(obj.createdAt).getTime()) / (1000 * 60 * 60 * 24)) >= 3;
  });

  const activeTasks = ideas.filter((i) => (i.ideaStatus ?? "active") === "active");
  const doneTasks = ideas.filter((i) => i.taskStatus === "done");

  // Priority tasks for dashboard: in-progress first, then by AI score, exclude done, max 4
  const priorityTasks = [...activeTasks]
    .filter((i) => i.taskStatus !== "done")
    .sort((a, b) => {
      const aIP = a.taskStatus === "in-progress" ? 0 : 1;
      const bIP = b.taskStatus === "in-progress" ? 0 : 1;
      if (aIP !== bIP) return aIP - bIP;
      return (b.analysis?.finalScore ?? -1) - (a.analysis?.finalScore ?? -1);
    })
    .slice(0, 4);

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
            {activeTasks.filter(t => t.taskStatus === "in-progress").length > 0 && (
              <span className="text-amber-500">{activeTasks.filter(t => t.taskStatus === "in-progress").length} 進行中</span>
            )}
            {activeTasks.filter(t => t.taskStatus === "done").length > 0 && (
              <span className="text-green-500">{activeTasks.filter(t => t.taskStatus === "done").length} 完成</span>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-indigo-600">{doneTasks.length}</div>
          <div className="text-xs text-gray-500 mt-1">已完成</div>
          {staleKRs.length > 0 && (
            <div className="mt-1 text-xs text-amber-500">{staleKRs.length} 子目標待更新</div>
          )}
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

      {/* ── OKR Progress ────────────────────────────────────────────────────── */}
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

      {/* ── 重點 Tasks ───────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">重點 Tasks</h2>
          <Link href="/tasks" className="text-xs text-indigo-500 hover:text-indigo-700">查看全部 →</Link>
        </div>
        {priorityTasks.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Link href="/tasks" className="text-xs text-indigo-500 hover:text-indigo-700">
              + 新增第一個 Task
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {priorityTasks.map((idea) => (
              <div key={idea.id} className="px-4 py-3 flex items-center gap-2">
                <p className="text-sm text-gray-800 flex-1 truncate">{idea.title}</p>
                {idea.taskStatus && (
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${TASK_STATUS_STYLE[idea.taskStatus]}`}>
                    {TASK_STATUS_LABEL[idea.taskStatus]}
                  </span>
                )}
                {idea.analysis?.finalScore != null && (
                  <span className="text-xs text-gray-300 shrink-0">{idea.analysis.finalScore.toFixed(1)}</span>
                )}
              </div>
            ))}
            {activeTasks.filter(i => i.taskStatus !== "done").length > 4 && (
              <div className="px-4 py-2.5 text-center">
                <Link href="/tasks" className="text-xs text-indigo-500 hover:text-indigo-700">
                  查看全部 {activeTasks.filter(i => i.taskStatus !== "done").length} 條 →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
