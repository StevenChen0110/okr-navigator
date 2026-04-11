"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Idea, Objective, KeyResult, CheckIn } from "@/lib/types";
import { fetchIdeas, fetchObjectives, removeIdea, updateIdeaCompletion } from "@/lib/db";
import ScoreBar from "@/components/ScoreBar";

type SortKey = "score" | "date";

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

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getLastCheckIn(kr: KeyResult): CheckIn | undefined {
  if (!kr.checkIns?.length) return undefined;
  return kr.checkIns[kr.checkIns.length - 1];
}

function getProgressColor(completion: number, deadline?: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = deadline ? new Date(deadline) < today : false;

  if (isOverdue && completion < 100) {
    return "bg-red-400";
  }
  if (completion >= 60) {
    return "bg-green-400";
  }
  if (completion >= 30) {
    return "bg-amber-400";
  }
  return "bg-gray-400";
}

export default function DashboardPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [sort, setSort] = useState<SortKey>("score");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  function handleDelete(id: string) {
    if (!confirm("確定要刪除這個 Idea？")) return;
    removeIdea(id).catch(console.error);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  function handleToggleComplete(id: string, current: boolean) {
    const next = !current;
    updateIdeaCompletion(id, next).catch(console.error);
    setIdeas((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, completed: next, completedAt: next ? new Date().toISOString() : undefined } : i
      )
    );
  }

  // ── Derived metrics ─────────────────────────────────────────────────────────

  const allKRs = objectives.flatMap((o) =>
    o.keyResults.map((kr) => ({ ...kr, objectiveTitle: o.title, objectiveId: o.id }))
  );

  // Confidence distribution
  const confidenceCounts = {
    "on-track": allKRs.filter((kr) => kr.confidence === "on-track").length,
    "at-risk": allKRs.filter((kr) => kr.confidence === "at-risk").length,
    "needs-rethink": allKRs.filter((kr) => kr.confidence === "needs-rethink").length,
    unset: allKRs.filter((kr) => !kr.confidence).length,
  };

  // Average O completion (only objectives with at least one trackable KR)
  const oCompletions = objectives.map(calcOCompletion).filter((v): v is number => v !== undefined);
  const avgOCompletion = oCompletions.length > 0
    ? Math.round(oCompletions.reduce((a, b) => a + b, 0) / oCompletions.length)
    : null;

  // Upcoming deadlines (within 30 days, not 100% complete)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcomingKRs = allKRs
    .filter((kr) => {
      if (!kr.deadline) return false;
      const days = daysUntil(kr.deadline);
      const completion = calcKRCompletion(kr);
      return days >= 0 && days <= 30 && (completion === undefined || completion < 100);
    })
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());

  // Stale KRs: trackable KRs with no check-in in 7+ days (or created 3+ days ago and never checked in)
  const staleKRs = allKRs.filter((kr) => {
    if (!kr.targetValue || kr.targetValue <= 0) return false;
    const completion = calcKRCompletion(kr);
    if (completion !== undefined && completion >= 100) return false;
    const last = getLastCheckIn(kr);
    if (last) {
      const diff = Math.round((today.getTime() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24));
      return diff >= 7;
    }
    // Never checked in — stale if objective was created 3+ days ago
    const obj = objectives.find((o) => o.keyResults.some((k) => k.id === kr.id));
    if (!obj) return false;
    const ageDays = Math.round((today.getTime() - new Date(obj.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    return ageDays >= 3;
  });

  // Ideas summary
  const completedIdeas = ideas.filter((i) => i.completed).length;
  const linkedIdeas = ideas.filter((i) => i.linkedKRs && i.linkedKRs.length > 0).length;

  // Sorted ideas
  const sorted = [...ideas].sort((a, b) => {
    if (sort === "score") return (b.analysis?.finalScore ?? -1) - (a.analysis?.finalScore ?? -1);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const totalKRs = allKRs.length;
  const hasConfidenceData = confidenceCounts["on-track"] + confidenceCounts["at-risk"] + confidenceCounts["needs-rethink"] > 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">

      {/* ── Top stat cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {/* Objectives card */}
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
              <div
                className="h-full rounded-full bg-indigo-400 transition-all"
                style={{ width: `${avgOCompletion}%` }}
              />
            </div>
          )}
        </div>

        {/* KRs card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-indigo-600">{totalKRs}</div>
          <div className="text-xs text-gray-500 mt-1">量化指標 (KR)</div>
          {hasConfidenceData && (
            <div className="mt-2 flex gap-1 items-center">
              {confidenceCounts["on-track"] > 0 && (
                <span className="text-xs text-green-600 font-medium">{confidenceCounts["on-track"]}✓</span>
              )}
              {confidenceCounts["at-risk"] > 0 && (
                <span className="text-xs text-amber-500 font-medium">{confidenceCounts["at-risk"]}!</span>
              )}
              {confidenceCounts["needs-rethink"] > 0 && (
                <span className="text-xs text-red-500 font-medium">{confidenceCounts["needs-rethink"]}✕</span>
              )}
            </div>
          )}
        </div>

        {/* Ideas card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-indigo-600">{ideas.length}</div>
          <div className="text-xs text-gray-500 mt-1">Ideas</div>
          {ideas.length > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              {Math.round((completedIdeas / ideas.length) * 100)}% 完成
            </div>
          )}
          <div className="mt-1 text-xs text-gray-400">
            {completedIdeas > 0 && <span className="text-green-500">{completedIdeas} 完成</span>}
            {completedIdeas > 0 && linkedIdeas > 0 && <span className="mx-1">·</span>}
            {linkedIdeas > 0 && <span>{linkedIdeas} 已連結</span>}
          </div>
        </div>
      </div>

      {/* ── KR Health Bar ─────────────────────────────────────────────────────── */}
      {hasConfidenceData && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">KR 健康狀態</h2>
            <span className="text-xs text-gray-400">{totalKRs - confidenceCounts.unset} / {totalKRs} 已評估</span>
          </div>
          {/* Stacked bar */}
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mb-3">
            {confidenceCounts["on-track"] > 0 && (
              <div
                className="bg-green-400 transition-all"
                style={{ width: `${(confidenceCounts["on-track"] / totalKRs) * 100}%` }}
              />
            )}
            {confidenceCounts["at-risk"] > 0 && (
              <div
                className="bg-amber-400 transition-all"
                style={{ width: `${(confidenceCounts["at-risk"] / totalKRs) * 100}%` }}
              />
            )}
            {confidenceCounts["needs-rethink"] > 0 && (
              <div
                className="bg-red-400 transition-all"
                style={{ width: `${(confidenceCounts["needs-rethink"] / totalKRs) * 100}%` }}
              />
            )}
          </div>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
              順利 {confidenceCounts["on-track"]}
            </span>
            <span className="flex items-center gap-1.5 text-amber-600">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              卡關 {confidenceCounts["at-risk"]}
            </span>
            <span className="flex items-center gap-1.5 text-red-600">
              <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
              需重新思考 {confidenceCounts["needs-rethink"]}
            </span>
          </div>
        </div>
      )}

      {/* ── Upcoming Deadlines ────────────────────────────────────────────────── */}
      {upcomingKRs.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            即將到期 <span className="text-amber-500 ml-1">({upcomingKRs.length})</span>
          </h2>
          <div className="space-y-2">
            {upcomingKRs.map((kr) => {
              const days = daysUntil(kr.deadline!);
              const completion = calcKRCompletion(kr);
              const urgent = days <= 7;
              return (
                <div key={kr.id} className="flex items-center gap-3">
                  <div className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-md ${
                    urgent ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  }`}>
                    {days === 0 ? "今天" : `${days}天`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{kr.title}</p>
                    <p className="text-xs text-gray-400 truncate">{kr.objectiveTitle}</p>
                  </div>
                  {completion !== undefined && (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getProgressColor(completion, kr.deadline)}`}
                          style={{ width: `${completion}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{completion}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Stale KRs reminder ───────────────────────────────────────────────── */}
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

      {/* ── OKR Progress Overview ────────────────────────────────────────────── */}
      {objectives.length > 0 && oCompletions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">目標進度</h2>
            <Link href="/okr" className="text-xs text-indigo-500 hover:text-indigo-700">全部 →</Link>
          </div>
          <div className="space-y-3">
            {objectives.map((o) => {
              const completion = calcOCompletion(o);
              if (completion === undefined) return null;
              const krCount = o.keyResults.filter((kr) => kr.targetValue && kr.targetValue > 0).length;
              return (
                <div key={o.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-700 truncate flex-1 mr-3">{o.title}</span>
                    <span className={`text-xs font-bold shrink-0 ${
                      completion >= 70 ? "text-green-600" : completion >= 40 ? "text-amber-500" : "text-red-500"
                    }`}>{completion}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getProgressColor(completion)}`}
                      style={{ width: `${completion}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{krCount} 個 KR 追蹤中</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Ideas ────────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-base">Ideas 排行榜</h2>
          {ideas.length > 0 && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {(["score", "date"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    sort === k ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
                  }`}
                >
                  {k === "score" ? "依優先分" : "依時間"}
                </button>
              ))}
            </div>
          )}
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <div className="text-4xl mb-3">💡</div>
            <p className="text-sm text-gray-500 mb-4">還沒有 Idea，開始分析你的第一個想法</p>
            <Link
              href="/idea/new"
              className="inline-block px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              + 新增 Idea
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((idea, idx) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                rank={idx + 1}
                expanded={expandedId === idea.id}
                onToggle={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
                onDelete={() => handleDelete(idea.id)}
                onToggleComplete={() => handleToggleComplete(idea.id, idea.completed ?? false)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IdeaCard({
  idea,
  rank,
  expanded,
  onToggle,
  onDelete,
  onToggleComplete,
}: {
  idea: Idea;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const score = idea.analysis?.finalScore;
  const scoreColor =
    score === undefined ? "text-gray-400"
    : score >= 7 ? "text-indigo-600"
    : score >= 4 ? "text-amber-500"
    : "text-red-500";

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${idea.completed ? "border-green-200 opacity-75" : "border-gray-200"}`}>
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-center gap-4"
      >
        <span className="text-sm font-bold text-gray-300 w-5 shrink-0">#{rank}</span>
        <div className="flex-1 min-w-0">
          <div className={`font-medium text-sm truncate ${idea.completed ? "line-through text-gray-400" : ""}`}>{idea.title}</div>
          {idea.completed ? (
            <span className="text-xs text-green-500">已完成</span>
          ) : (
            <div className="text-xs text-gray-400 truncate mt-0.5">{idea.description}</div>
          )}
        </div>
        {!idea.completed && score !== undefined && (
          <span className={`text-xl font-bold shrink-0 ${scoreColor}`}>{score.toFixed(1)}</span>
        )}
        {idea.linkedKRs && idea.linkedKRs.length > 0 && (
          <span className="text-xs text-gray-400 shrink-0">{idea.linkedKRs.length} KR</span>
        )}
        <span className="text-gray-300 text-sm">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {idea.analysis && (
            <>
              {idea.analysis.objectiveScores.map((os) => (
                <div key={os.objectiveId}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-medium text-gray-700">{os.objectiveTitle}</span>
                    <span className={`text-xs font-bold ${
                      os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-500"
                    }`}>{os.overallScore.toFixed(1)}</span>
                  </div>
                  <div className="space-y-1 pl-2">
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
            </>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={onToggleComplete}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                idea.completed
                  ? "border-gray-200 text-gray-500 hover:bg-gray-50"
                  : "border-green-300 text-green-600 hover:bg-green-50"
              }`}
            >
              {idea.completed ? "取消完成" : "標記完成"}
            </button>
            <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
              刪除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
