"use client";

import { useState, useEffect } from "react";
import { Background, BackgroundCategory } from "@/lib/types";
import { fetchBackgrounds, saveBackground, updateBackground, removeBackground } from "@/lib/db";

const CATEGORIES: BackgroundCategory[] = ["技能", "工作經歷", "學習背景", "其他"];

const CATEGORY_COLOR: Record<BackgroundCategory, string> = {
  "技能": "bg-blue-50 text-blue-600 border-blue-200",
  "工作經歷": "bg-purple-50 text-purple-600 border-purple-200",
  "學習背景": "bg-green-50 text-green-600 border-green-200",
  "其他": "bg-gray-50 text-gray-500 border-gray-200",
};

interface FormState {
  category: BackgroundCategory;
  title: string;
  description: string;
}

const EMPTY_FORM: FormState = { category: "技能", title: "", description: "" };

export default function BackgroundsPage() {
  const [items, setItems] = useState<Background[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchBackgrounds()
      .then(setItems)
      .catch(() => setError("載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  }

  function openEdit(bg: Background) {
    setEditingId(bg.id);
    setForm({ category: bg.category, title: bg.title, description: bg.description ?? "" });
    setError("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (editingId) {
        await updateBackground(editingId, {
          category: form.category,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
        });
        setItems((prev) =>
          prev.map((bg) =>
            bg.id === editingId
              ? { ...bg, category: form.category, title: form.title.trim(), description: form.description.trim() || undefined }
              : bg
          )
        );
      } else {
        const created = await saveBackground({
          category: form.category,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
        });
        setItems((prev) => [created, ...prev]);
      }
      closeForm();
    } catch {
      setError("儲存失敗，請重試");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("確定要刪除這筆背景資料？")) return;
    await removeBackground(id).catch(() => {});
    setItems((prev) => prev.filter((bg) => bg.id !== id));
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">背景經歷</h1>
        <button
          onClick={openAdd}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
        >
          + 新增
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">記錄你的技能與經歷，AI 會在分析時參考這些資料</p>

      {/* 新增 / 編輯表單 */}
      {showForm && (
        <div className="bg-white border border-indigo-200 rounded-xl p-5 mb-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">
            {editingId ? "編輯背景" : "新增背景"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Category */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">類別</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: c }))}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      form.category === c
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "border-gray-200 text-gray-600 hover:border-indigo-300"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">標題</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
                placeholder="例：React 前端開發、3 年 B2B SaaS 銷售經驗"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">補充說明（選填）</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="進一步描述程度、年資、成果等"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={closeForm}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={busy || !form.title.trim()}
                className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {busy ? "儲存中…" : "儲存"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-10">載入中…</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-sm text-gray-500 mb-3">還沒有背景資料</p>
          <button
            onClick={openAdd}
            className="text-sm text-indigo-600 hover:underline"
          >
            新增第一筆
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((bg) => (
            <div key={bg.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-start gap-4">
              <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-md border ${CATEGORY_COLOR[bg.category]}`}>
                {bg.category}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{bg.title}</p>
                {bg.description && (
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{bg.description}</p>
                )}
              </div>
              <div className="flex gap-3 shrink-0">
                <button
                  onClick={() => openEdit(bg)}
                  className="text-xs text-gray-400 hover:text-indigo-500 transition-colors"
                >
                  編輯
                </button>
                <button
                  onClick={() => handleDelete(bg.id)}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
