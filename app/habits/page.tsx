"use client";

import { useState, useEffect } from "react";
import { v4 as uuid } from "uuid";
import { fetchHabits, saveHabit, removeHabit, fetchTodayHabitLogs, logHabitDone, undoHabitLog } from "@/lib/db";
import { Habit, HabitLog } from "@/lib/types";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function StreakDots({ count }: { count: number }) {
  const filled = Math.min(count, 7);
  return (
    <div className="flex gap-0.5 mt-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < filled ? "bg-amber-400" : "bg-gray-100"}`} />
      ))}
    </div>
  );
}

export default function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCue, setNewCue] = useState("");
  const [newFreq, setNewFreq] = useState<"daily" | "weekly">("daily");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([fetchHabits(), fetchTodayHabitLogs()])
      .then(([h, l]) => { setHabits(h); setLogs(l); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const doneIds = new Set(logs.filter((l) => !l.skipped).map((l) => l.habitId));

  async function toggleHabit(habit: Habit) {
    if (doneIds.has(habit.id)) {
      const updated = await undoHabitLog(habit.id, habit).catch(() => habit);
      setHabits((prev) => prev.map((h) => h.id === habit.id ? updated : h));
      setLogs((prev) => prev.filter((l) => l.habitId !== habit.id || l.loggedAt !== todayStr()));
    } else {
      const updated = await logHabitDone(habit.id, habit).catch(() => habit);
      setHabits((prev) => prev.map((h) => h.id === habit.id ? updated : h));
      setLogs((prev) => [...prev, { id: uuid(), habitId: habit.id, loggedAt: todayStr(), skipped: false }]);
    }
  }

  async function addHabit() {
    if (!newName.trim() || saving) return;
    setSaving(true);
    const habit: Habit = {
      id: uuid(),
      name: newName.trim(),
      cue: newCue.trim() || undefined,
      frequency: newFreq,
      streakCount: 0,
      createdAt: new Date().toISOString(),
    };
    try {
      await saveHabit(habit);
      setHabits((prev) => [...prev, habit]);
      setNewName("");
      setNewCue("");
      setNewFreq("daily");
      setShowAdd(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function archiveHabit(id: string) {
    if (!confirm("封存這個習慣？")) return;
    await removeHabit(id).catch(console.error);
    setHabits((prev) => prev.filter((h) => h.id !== id));
  }

  if (loading) {
    return <div className="max-w-xl mx-auto px-4 py-10 text-center text-sm text-gray-400">載入中…</div>;
  }

  const todayDone = habits.filter((h) => doneIds.has(h.id)).length;
  const todayTotal = habits.filter((h) => h.frequency === "daily").length;

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 pb-32">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">習慣</h1>
          {todayTotal > 0 && (
            <p className="text-sm text-gray-400 mt-0.5">今天 {todayDone}/{todayTotal} 完成</p>
          )}
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
          + 新增
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="mb-5 bg-white rounded-xl border border-indigo-200 p-4 space-y-3">
          <p className="text-xs font-medium text-indigo-600">新習慣</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addHabit(); }}
            placeholder="習慣名稱（例：冥想 10 分鐘）"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            autoFocus
          />
          <input
            value={newCue}
            onChange={(e) => setNewCue(e.target.value)}
            placeholder="提示情境（選填，例：早上起床後）"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <div className="flex gap-2">
            {(["daily", "weekly"] as const).map((f) => (
              <button key={f} onClick={() => setNewFreq(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  newFreq === f ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-500"
                }`}>
                {f === "daily" ? "每天" : "每週"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-400">取消</button>
            <button onClick={addHabit} disabled={!newName.trim() || saving}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors">
              {saving ? "…" : "新增"}
            </button>
          </div>
        </div>
      )}

      {habits.length === 0 && !showAdd ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3">🌱</div>
          <p className="text-sm text-gray-400">還沒有習慣</p>
          <p className="text-xs text-gray-300 mt-1 mb-4">從一個小的開始</p>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
            新增習慣
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {habits.map((habit) => {
            const done = doneIds.has(habit.id);
            return (
              <div key={habit.id}
                className={`bg-white rounded-xl border transition-all ${done ? "border-indigo-100" : "border-gray-200"}`}>
                <div className="flex items-center gap-4 px-4 py-3.5">
                  <button onClick={() => toggleHabit(habit)}
                    className={`w-7 h-7 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                      done ? "bg-indigo-500 border-indigo-500 text-white" : "border-gray-300 hover:border-indigo-400"
                    }`}>
                    {done && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${done ? "text-gray-500" : "text-gray-800"}`}>{habit.name}</p>
                    {habit.cue && <p className="text-xs text-gray-400 mt-0.5">{habit.cue}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <StreakDots count={habit.streakCount} />
                      {habit.streakCount > 0 && (
                        <span className="text-xs text-amber-500">🔥 {habit.streakCount} 天連續</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-gray-300 bg-gray-50 rounded px-1.5 py-0.5">
                      {habit.frequency === "daily" ? "每天" : "每週"}
                    </span>
                    <button onClick={() => archiveHabit(habit.id)}
                      className="text-gray-200 hover:text-red-400 transition-colors ml-1 text-lg leading-none">×</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
