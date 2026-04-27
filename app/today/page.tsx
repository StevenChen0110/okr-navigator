"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchIdeas, fetchHabits, fetchTodayHabitLogs, logHabitDone, undoHabitLog, saveHabit, updateIdeaTaskStatus } from "@/lib/db";
import { Idea, Habit, HabitLog } from "@/lib/types";
import { v4 as uuid } from "uuid";

const TODAY_KEY = () => `mit_${new Date().toISOString().split("T")[0]}`;
const IDENTITY_KEY = "loco_identity";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function formatDate() {
  return new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "short" });
}

export default function TodayPage() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [mitIds, setMitIds] = useState<string[]>([]);
  const [identity, setIdentity] = useState("");
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [identityDraft, setIdentityDraft] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [showRitual, setShowRitual] = useState(false);
  const [ritualNote, setRitualNote] = useState("");
  const [ritualDone, setRitualDone] = useState(false);

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchHabits().then(setHabits).catch(console.error);
    fetchTodayHabitLogs().then(setHabitLogs).catch(console.error);
    const stored = localStorage.getItem(TODAY_KEY());
    if (stored) setMitIds(JSON.parse(stored));
    const id = localStorage.getItem(IDENTITY_KEY) ?? "";
    setIdentity(id);
    setIdentityDraft(id);
  }, []);

  function saveMitIds(ids: string[]) {
    setMitIds(ids);
    localStorage.setItem(TODAY_KEY(), JSON.stringify(ids));
  }

  function saveIdentity() {
    const v = identityDraft.trim();
    setIdentity(v);
    localStorage.setItem(IDENTITY_KEY, v);
    setEditingIdentity(false);
  }

  const mitTasks = mitIds
    .map((id) => ideas.find((i) => i.id === id))
    .filter(Boolean) as Idea[];

  const doneTodayCount = mitTasks.filter((t) => t.taskStatus === "done").length;
  const allMitDone = mitTasks.length > 0 && doneTodayCount === mitTasks.length;

  const availableTasks = ideas.filter((i) => {
    if (mitIds.includes(i.id)) return false;
    if (i.taskStatus === "done") return false;
    const s = i.ideaStatus ?? "active";
    return s === "active";
  });

  async function toggleMITDone(task: Idea) {
    const next = task.taskStatus === "done" ? "todo" : "done";
    setIdeas((prev) => prev.map((i) => i.id === task.id ? { ...i, taskStatus: next } : i));
    await updateIdeaTaskStatus(task.id, next).catch(console.error);
  }

  function removeMIT(id: string) {
    saveMitIds(mitIds.filter((m) => m !== id));
  }

  function addMIT(id: string) {
    if (mitIds.length >= 3) return;
    saveMitIds([...mitIds, id]);
    setShowPicker(false);
  }

  const doneHabitIds = new Set(habitLogs.filter((l) => !l.skipped).map((l) => l.habitId));
  const todayHabits = habits.filter((h) => h.frequency === "daily" || h.lastDoneAt !== todayStr());

  async function toggleHabit(habit: Habit) {
    if (doneHabitIds.has(habit.id)) {
      const updated = await undoHabitLog(habit.id, habit).catch(() => habit);
      setHabits((prev) => prev.map((h) => h.id === habit.id ? updated : h));
      setHabitLogs((prev) => prev.filter((l) => l.habitId !== habit.id || l.loggedAt !== todayStr()));
    } else {
      const updated = await logHabitDone(habit.id, habit).catch(() => habit);
      setHabits((prev) => prev.map((h) => h.id === habit.id ? updated : h));
      const newLog: HabitLog = { id: uuid(), habitId: habit.id, loggedAt: todayStr(), skipped: false };
      setHabitLogs((prev) => [...prev, newLog]);
    }
  }

  function completeRitual() {
    if (ritualNote.trim()) {
      localStorage.setItem(`ritual_${todayStr()}`, ritualNote.trim());
    }
    setRitualDone(true);
  }

  const yesterdayKey = `ritual_${new Date(Date.now() - 86400000).toISOString().split("T")[0]}`;
  const yesterdayNote = typeof window !== "undefined" ? localStorage.getItem(yesterdayKey) : null;

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 pb-32">

      {/* MIT Picker Modal */}
      {showPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPicker(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">選擇今日重點（最多 {3 - mitIds.length} 個）</p>
              <button onClick={() => setShowPicker(false)} className="text-gray-400 text-lg">×</button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
              {availableTasks.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  沒有待辦任務了<br />
                  <button onClick={() => { setShowPicker(false); router.push("/inbox"); }} className="mt-2 text-indigo-500 text-xs">去收件匣找找</button>
                </div>
              ) : availableTasks.map((task) => (
                <button key={task.id} onClick={() => addMIT(task.id)}
                  className="w-full text-left px-5 py-3 hover:bg-indigo-50 transition-colors flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-gray-200 shrink-0" />
                  <span className="text-sm text-gray-700 flex-1 truncate">{task.title}</span>
                  <span className="text-indigo-400 text-xs shrink-0">選擇</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* End-of-day ritual modal */}
      {showRitual && !ritualDone && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-5">
            <div className="text-center">
              <div className="text-3xl mb-2">🌙</div>
              <h2 className="text-base font-semibold text-gray-800">今天結束了</h2>
              <p className="text-xs text-gray-400 mt-1">花 30 秒回顧一下</p>
            </div>
            {mitTasks.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-medium">今天的重點</p>
                {mitTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <span className={`text-base ${t.taskStatus === "done" ? "text-indigo-400" : "text-gray-300"}`}>
                      {t.taskStatus === "done" ? "✓" : "○"}
                    </span>
                    <span className={t.taskStatus === "done" ? "text-gray-700" : "text-gray-400"}>{t.title}</span>
                  </div>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">今天有什麼讓自己驕傲的小事？</p>
              <textarea
                value={ritualNote}
                onChange={(e) => setRitualNote(e.target.value)}
                placeholder="寫下來，哪怕很小（可跳過）"
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowRitual(false)} className="flex-1 py-2 rounded-xl border border-gray-200 text-xs text-gray-400 hover:bg-gray-50">
                稍後再說
              </button>
              <button onClick={completeRitual} className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
                收工 🎉
              </button>
            </div>
          </div>
        </div>
      )}

      {ritualDone && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-8 text-center space-y-4">
            <div className="text-5xl">🌟</div>
            <h2 className="text-lg font-semibold">做到了！</h2>
            <p className="text-sm text-gray-500">今天辛苦了。明天繼續。</p>
            <button onClick={() => { setShowRitual(false); setRitualDone(false); }}
              className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
              關閉
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">{formatDate()}</p>
          <h1 className="text-2xl font-semibold text-gray-900">今天</h1>
        </div>
      </div>

      {/* Identity statement */}
      <div className="mb-7">
        {editingIdentity ? (
          <div className="flex items-center gap-2">
            <input
              value={identityDraft}
              onChange={(e) => setIdentityDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveIdentity(); if (e.key === "Escape") setEditingIdentity(false); }}
              placeholder="下一季結束時，你希望成為什麼樣的人？"
              className="flex-1 text-sm text-gray-600 bg-transparent border-b border-indigo-300 pb-1 focus:outline-none"
              autoFocus
            />
            <button onClick={saveIdentity} className="text-xs text-indigo-500 font-medium shrink-0">儲存</button>
            <button onClick={() => setEditingIdentity(false)} className="text-xs text-gray-400 shrink-0">取消</button>
          </div>
        ) : identity ? (
          <button onClick={() => { setIdentityDraft(identity); setEditingIdentity(true); }}
            className="text-sm text-gray-500 hover:text-gray-700 text-left group flex items-center gap-1.5">
            <span className="text-indigo-300">◈</span>
            <span>{identity}</span>
            <span className="text-gray-200 group-hover:text-gray-400 text-xs">✎</span>
          </button>
        ) : (
          <button onClick={() => setEditingIdentity(true)}
            className="text-sm text-gray-300 hover:text-gray-500 text-left flex items-center gap-1.5">
            <span className="text-gray-200">◈</span>
            <span>你這一季想成為什麼樣的人？</span>
          </button>
        )}
      </div>

      {/* Yesterday's note */}
      {yesterdayNote && (
        <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl">
          <p className="text-xs text-amber-500 font-medium mb-1">昨天你說</p>
          <p className="text-sm text-amber-700">{yesterdayNote}</p>
        </div>
      )}

      {/* MIT Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">今天最重要的事</h2>
          {mitIds.length < 3 && (
            <button onClick={() => setShowPicker(true)}
              className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
              + 選擇
            </button>
          )}
        </div>

        {mitTasks.length === 0 ? (
          <button onClick={() => setShowPicker(true)}
            className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-8 text-center hover:border-indigo-200 transition-colors group">
            <p className="text-sm text-gray-400 group-hover:text-indigo-400">點此選擇今天最重要的 1–3 件事</p>
          </button>
        ) : (
          <div className="space-y-3">
            {mitTasks.map((task) => {
              const done = task.taskStatus === "done";
              return (
                <div key={task.id}
                  className={`bg-white rounded-2xl border p-5 shadow-sm transition-all ${done ? "border-gray-100 opacity-60" : "border-gray-200 hover:border-indigo-100"}`}>
                  <div className="flex items-start gap-4">
                    <button onClick={() => toggleMITDone(task)}
                      className={`mt-0.5 w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                        done ? "bg-indigo-400 border-indigo-400 text-white" : "border-gray-300 hover:border-indigo-400"
                      }`}>
                      {done && <span className="text-xs">✓</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-base font-medium leading-snug ${done ? "line-through text-gray-400" : "text-gray-800"}`}>
                        {task.title}
                      </p>
                      {(task.linkedKRs?.length ?? 0) > 0 && (
                        <p className="text-xs text-gray-400 mt-1">連結 {task.linkedKRs!.length} 個目標</p>
                      )}
                    </div>
                    <button onClick={() => removeMIT(task.id)}
                      className="text-gray-200 hover:text-gray-400 text-sm shrink-0 mt-0.5">×</button>
                  </div>
                </div>
              );
            })}
            {mitIds.length < 3 && (
              <button onClick={() => setShowPicker(true)}
                className="w-full py-3 rounded-2xl border border-dashed border-gray-200 text-xs text-gray-400 hover:border-indigo-200 hover:text-indigo-400 transition-colors">
                + 再加一件事
              </button>
            )}
          </div>
        )}
      </div>

      {/* Habits Section */}
      {habits.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">今天的習慣</h2>
            <button onClick={() => router.push("/habits")} className="text-xs text-gray-400 hover:text-gray-600">管理</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {todayHabits.map((habit) => {
              const done = doneHabitIds.has(habit.id);
              return (
                <button key={habit.id} onClick={() => toggleHabit(habit)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                    done ? "bg-indigo-50 border-indigo-200" : "bg-white border-gray-200 hover:border-indigo-100"
                  }`}>
                  <span className={`text-lg shrink-0 ${done ? "opacity-100" : "opacity-30"}`}>
                    {done ? "✓" : "○"}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${done ? "text-indigo-700" : "text-gray-700"}`}>{habit.name}</p>
                    {habit.streakCount > 1 && (
                      <p className="text-xs text-amber-500">🔥 {habit.streakCount} 天</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {habits.length === 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">習慣</h2>
          </div>
          <button onClick={() => router.push("/habits")}
            className="w-full py-4 rounded-xl border border-dashed border-gray-200 text-xs text-gray-400 hover:border-indigo-200 hover:text-indigo-400 transition-colors">
            + 建立第一個習慣
          </button>
        </div>
      )}

      {/* End of day */}
      <div className="text-center pt-4 border-t border-gray-100">
        {allMitDone ? (
          <p className="text-sm text-indigo-500 mb-3 font-medium">今天的重點都完成了 🎉</p>
        ) : null}
        <button onClick={() => setShowRitual(true)}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          今天結束了 →
        </button>
      </div>
    </div>
  );
}
