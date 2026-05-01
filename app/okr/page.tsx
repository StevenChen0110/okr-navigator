"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { Objective } from "@/lib/types";
import { fetchObjectives, saveObjective, removeObjective } from "@/lib/db";

const PRIORITY_CONFIG = {
  1: { label: "1", style: "bg-red-100 text-red-600 border-red-200" },
  2: { label: "2", style: "bg-amber-100 text-amber-600 border-amber-200" },
  3: { label: "3", style: "bg-gray-100 text-gray-500 border-gray-200" },
} as const;

type Priority = 1 | 2 | 3;

function emptyForm() {
  return { title: "", description: "", priority: 2 as Priority };
}

function GoalForm({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
}: {
  form: { title: string; description: string; priority: Priority };
  setForm: (f: { title: string; description: string; priority: Priority }) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3">
      <input
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && onSave()}
        placeholder="目標名稱"
        autoFocus
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <textarea
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="補充說明，幫助 AI 更準確判斷（選填）"
        rows={2}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none resize-none"
      />
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 mr-1">重要度</span>
        {([1, 2, 3] as Priority[]).map((p) => (
          <button
            key={p}
            onClick={() => setForm({ ...form, priority: p })}
            className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
              form.priority === p
                ? PRIORITY_CONFIG[p].style
                : "border-gray-200 text-gray-400 hover:border-gray-300"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50"
        >
          取消
        </button>
        <button
          onClick={onSave}
          disabled={!form.title.trim() || saving}
          className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  async function handleAdd() {
    if (!form.title.trim()) return;
    setSaving(true);
    const newObj: Objective = {
      id: uuid(),
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      keyResults: [],
      createdAt: new Date().toISOString(),
      status: "active",
      meta: { priority: form.priority },
    };
    await saveObjective(newObj);
    setObjectives((prev) => [newObj, ...prev]);
    setForm(emptyForm());
    setAdding(false);
    setSaving(false);
  }

  async function handleUpdate(id: string) {
    if (!form.title.trim()) return;
    setSaving(true);
    const existing = objectives.find((o) => o.id === id);
    if (!existing) return;
    const updated: Objective = {
      ...existing,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      meta: { ...existing.meta, priority: form.priority },
    };
    await saveObjective(updated);
    setObjectives((prev) => prev.map((o) => (o.id === id ? updated : o)));
    setEditingId(null);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await removeObjective(id).catch(console.error);
    setObjectives((prev) => prev.filter((o) => o.id !== id));
  }

  function startEdit(o: Objective) {
    setEditingId(o.id);
    setAdding(false);
    setForm({
      title: o.title,
      description: o.description ?? "",
      priority: o.meta?.priority ?? 2,
    });
  }

  const active = objectives
    .filter((o) => !o.status || o.status === "active")
    .sort((a, b) => {
      const pa = a.meta?.priority ?? 2;
      const pb = b.meta?.priority ?? 2;
      return sortAsc ? pa - pb : pb - pa;
    });

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 pb-32 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-lg leading-none">‹</Link>
          <div>
            <h1 className="text-xl font-semibold">判斷標準</h1>
            <p className="text-xs text-gray-400 mt-0.5">AI 根據這些目標評估你的每個想法</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortAsc((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
            title={sortAsc ? "重要度升序" : "重要度降序"}
          >
            {sortAsc ? "1→3" : "3→1"}
          </button>
          {!adding && (
            <button
              onClick={() => {
                setAdding(true);
                setEditingId(null);
                setForm(emptyForm());
              }}
              className="text-sm font-medium px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              + 新增
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <GoalForm
            form={form}
            setForm={setForm}
            onSave={handleAdd}
            onCancel={() => setAdding(false)}
            saving={saving}
          />
        </div>
      )}

      {active.length === 0 && !adding ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3 text-gray-200">◎</div>
          <p className="text-sm text-gray-400">還沒有目標</p>
          <p className="text-xs text-gray-300 mt-1">設定目標後，AI 才能評估你的想法</p>
        </div>
      ) : (
        <div className="space-y-2">
          {active.map((o) => (
            <div key={o.id} className="bg-white rounded-xl border border-gray-200">
              {editingId === o.id ? (
                <div className="p-4">
                  <GoalForm
                    form={form}
                    setForm={setForm}
                    onSave={() => handleUpdate(o.id)}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                </div>
              ) : (
                <div className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded border ${
                          PRIORITY_CONFIG[o.meta?.priority ?? 2].style
                        }`}
                      >
                        {PRIORITY_CONFIG[o.meta?.priority ?? 2].label}
                      </span>
                      <p className="text-sm font-medium text-gray-800 truncate">{o.title}</p>
                    </div>
                    {o.description && (
                      <p className="text-xs text-gray-400 mt-1 leading-snug">{o.description}</p>
                    )}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button
                      onClick={() => startEdit(o)}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      編輯
                    </button>
                    <button
                      onClick={() => handleDelete(o.id)}
                      className="text-xs text-gray-300 hover:text-red-400 transition-colors"
                    >
                      刪除
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
