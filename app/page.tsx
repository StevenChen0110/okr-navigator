"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchIdeas, fetchObjectives, fetchHabits, fetchTodayHabitLogs } from "@/lib/db";
import { Idea, Objective, KeyResult, Habit, HabitLog } from "@/lib/types";

const TODAY_KEY = () => `mit_${new Date().toISOString().split("T")[0]}`;

function calcKRCompletion(kr: KeyResult): number | undefined {
  if (kr.krType === "milestone") return kr.currentValue && kr.currentValue >= 1 ? 100 : 0;
  if (!kr.targetValue || kr.targetValue <= 0) return undefined;
  return Math.min(100, Math.round(((kr.currentValue ?? 0) / kr.targetValue) * 100));
}

function calcOCompletion(o: Objective): number | undefined {
  const krs = o.keyResults.filter((kr) =>
    kr.krType === "milestone" || (kr.targetValue && kr.targetValue > 0)
  );
  if (krs.length === 0) return undefined;
  const avg =
    krs.reduce((sum, kr) => {
      if (kr.krType === "milestone")
        return sum + (kr.currentValue && kr.currentValue >= 1 ? 1 : 0);
      return sum + Math.min(1, (kr.currentValue ?? 0) / kr.targetValue!);
    }, 0) / krs.length;
  return Math.round(avg * 100);
}

function greet() {
  const h = new Date().getHours();
  if (h < 12) return "早安";
  if (h < 18) return "午安";
  return "晚安";
}

function formatDate() {
  return new Date().toLocaleDateString("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [mitIds, setMitIds] = useState<string[]>([]);

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
    fetchHabits().then(setHabits).catch(console.error);
    fetchTodayHabitLogs().then(setHabitLogs).catch(console.error);
    const stored = localStorage.getItem(TODAY_KEY());
    if (stored) setMitIds(JSON.parse(stored));
  }, []);

  const mitTasks = mitIds
    .map((id) => ideas.find((i) => i.id === id))
    .filter(Boolean) as Idea[];
  const mitDoneCount = mitTasks.filter((t) => t.taskStatus === "done").length;

  const top3Ideas = [...ideas]
    .filter(
      (i) =>
        (i.ideaStatus ?? "active") === "active" &&
        i.taskStatus !== "done" &&
        i.analysis
    )
    .sort((a, b) => (b.analysis!.finalScore ?? 0) - (a.analysis!.finalScore ?? 0))
    .slice(0, 3);

  const pendingEvalCount =
    ideas.filter((i) => i.ideaStatus === "inbox").length +
    ideas.filter((i) => (i.ideaStatus ?? "active") === "active" && !i.analysis).length;

  const doneHabitIds = new Set(
    habitLogs.filter((l) => !l.skipped).map((l) => l.habitId)
  );
  const activeHabits = habits.filter((h) => !h.archivedAt);
  const habitDoneCount = activeHabits.filter((h) => doneHabitIds.has(h.id)).length;

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 pb-32 space-y-4">
      {/* Header */}
      <div className="mb-2">
        <p className="text-xs text-gray-400">{formatDate()}</p>
        <h1 className="text-2xl font-semibold text-gray-900 mt-0.5">{greet()}</h1>
      </div>

      {/* Today MIT card */}
      <Link
        href="/today"
        className="block bg-white rounded-2xl border border-gray-200 p-5 hover:border-indigo-100 transition-colors"
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-800">今天的重點</p>
          <span
            className={`text-xs font-mono px-2 py-0.5 rounded-full ${
              mitTasks.length > 0 && mitDoneCount === mitTasks.length
                ? "bg-green-50 text-green-600"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {mitDoneCount}/{mitTasks.length || 3}
          </span>
        </div>
        {mitTasks.length === 0 ? (
          <p className="text-sm text-gray-400">還沒設定今天最重要的事 →</p>
        ) : (
          <div className="space-y-2">
            {mitTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-2.5">
                <span
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 text-[10px] ${
                    t.taskStatus === "done"
                      ? "bg-indigo-400 border-indigo-400 text-white"
                      : "border-gray-300"
                  }`}
                >
                  {t.taskStatus === "done" ? "✓" : ""}
                </span>
                <span
                  className={`text-sm ${
                    t.taskStatus === "done" ? "line-through text-gray-400" : "text-gray-700"
                  }`}
                >
                  {t.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </Link>

      {/* OKR Progress */}
      {objectives.length > 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-gray-800">目標進度</p>
            <Link href="/okr" className="text-xs text-indigo-500 hover:text-indigo-700">
              管理 →
            </Link>
          </div>
          <div className="space-y-3">
            {objectives.map((o) => {
              const completion = calcOCompletion(o);
              return (
                <div key={o.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-700 truncate flex-1 mr-2 leading-snug">
                      {o.title}
                    </span>
                    {completion !== undefined && (
                      <span className="text-xs font-mono text-indigo-500 shrink-0">
                        {completion}%
                      </span>
                    )}
                  </div>
                  {completion !== undefined ? (
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-400 transition-all"
                        style={{ width: `${completion}%`, minWidth: completion > 0 ? "3px" : "0" }}
                      />
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-400">尚無可追蹤的子目標</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Link
          href="/okr"
          className="block bg-white rounded-2xl border border-dashed border-gray-200 p-5 hover:border-indigo-200 transition-colors text-center"
        >
          <p className="text-sm text-gray-400">還沒有季度目標</p>
          <p className="text-xs text-indigo-400 mt-1">建立第一個 OKR →</p>
        </Link>
      )}

      {/* AI Top Ideas */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-gray-800">最值得做的事</p>
          <Link href="/ideas" className="text-xs text-indigo-500 hover:text-indigo-700">
            全部 →
          </Link>
        </div>
        <p className="text-xs text-gray-400 mb-4">AI 根據你的目標評分排序</p>

        {pendingEvalCount > 0 && (
          <Link
            href="/ideas"
            className="flex items-center gap-2 px-3 py-2 mb-3 bg-amber-50 rounded-xl border border-amber-100 hover:bg-amber-100 transition-colors"
          >
            <span className="text-amber-600 text-xs font-medium">
              {pendingEvalCount} 個想法待 AI 評估
            </span>
            <span className="text-xs text-amber-500 ml-auto">去評估 →</span>
          </Link>
        )}

        {top3Ideas.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-gray-400">還沒有 AI 評估的想法</p>
            <button
              onClick={() => router.push("/ideas")}
              className="mt-2 text-xs text-indigo-500 hover:text-indigo-700"
            >
              新增想法 →
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {top3Ideas.map((idea) => (
              <Link
                key={idea.id}
                href="/ideas"
                className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-gray-50 transition-colors"
              >
                <p className="text-sm text-gray-800 flex-1 truncate">{idea.title}</p>
                <span
                  className={`text-xs font-bold font-mono px-2 py-0.5 rounded-lg shrink-0 ${
                    idea.analysis!.finalScore >= 7
                      ? "bg-indigo-50 text-indigo-600"
                      : idea.analysis!.finalScore >= 4
                      ? "bg-amber-50 text-amber-600"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {idea.analysis!.finalScore.toFixed(1)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Habits quick row */}
      {activeHabits.length > 0 && (
        <Link
          href="/today"
          className="flex items-center justify-between bg-white rounded-2xl border border-gray-200 px-5 py-4 hover:border-indigo-100 transition-colors"
        >
          <p className="text-sm font-medium text-gray-700">習慣打卡</p>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {activeHabits.slice(0, 6).map((h) => (
                <span
                  key={h.id}
                  className={`w-2 h-2 rounded-full ${
                    doneHabitIds.has(h.id) ? "bg-indigo-400" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-gray-500 font-mono">
              {habitDoneCount}/{activeHabits.length}
            </span>
          </div>
        </Link>
      )}
    </div>
  );
}
