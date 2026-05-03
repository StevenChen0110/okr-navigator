"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, ObjGroup } from "@/lib/types";
import { fetchObjectives, saveObjective, removeObjective, markAllIdeasForReanalysis } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
import { getObjGroups } from "@/lib/storage";

const PRIORITY_CONFIG = {
  1: { label: "1", style: "bg-red-100 text-red-600 border-red-200" },
  2: { label: "2", style: "bg-amber-100 text-amber-600 border-amber-200" },
  3: { label: "3", style: "bg-gray-100 text-gray-500 border-gray-200" },
} as const;

type Priority = 1 | 2 | 3;

interface FormState {
  title: string;
  priority: Priority;
  krs: string[];
  // advanced
  description: string;
  motivation: string;
  expectedOutcome: string;
  deadline: string;   // YYYY-MM-DD or ""
  groupId: string;    // "" means no group
}

function emptyForm(): FormState {
  return {
    title: "", priority: 2, krs: [],
    description: "", motivation: "", expectedOutcome: "", deadline: "", groupId: "",
  };
}

function GoalForm({
  form, setForm, onSave, onCancel, saving, groups,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  groups: ObjGroup[];
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleSuggest() {
    if (!form.title.trim()) return;
    setSuggesting(true);
    setSuggestions([]);
    try {
      const results = await callAI<string[]>("suggestKeyResults", {
        objectiveTitle: form.title,
        objectiveDescription: form.description || undefined,
        existingKRs: form.krs.filter((k) => k.trim()),
      });
      const existing = new Set(form.krs.map((k) => k.trim()));
      setSuggestions(results.filter((r) => !existing.has(r)));
    } catch { /* ignore */ }
    finally { setSuggesting(false); }
  }

  function addKr() { setForm({ ...form, krs: [...form.krs, ""] }); }
  function updateKr(i: number, value: string) {
    const krs = [...form.krs]; krs[i] = value; setForm({ ...form, krs });
  }
  function removeKr(i: number) {
    setForm({ ...form, krs: form.krs.filter((_, idx) => idx !== i) });
  }
  function addSuggestion(s: string) {
    setForm({ ...form, krs: [...form.krs, s] });
    setSuggestions((prev) => prev.filter((x) => x !== s));
  }

  const validKrCount = form.krs.filter((k) => k.trim()).length;
  const canSave = form.title.trim() && validKrCount > 0 && !saving;
  const hasAdvanced = form.description || form.motivation || form.expectedOutcome || form.deadline || form.groupId;

  return (
    <div className="space-y-3">
      {/* ── Basic ── */}
      <input
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && canSave && onSave()}
        placeholder="目標名稱"
        autoFocus
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 mr-1">重要度</span>
        {([1, 2, 3] as Priority[]).map((p) => (
          <button key={p} onClick={() => setForm({ ...form, priority: p })}
            className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
              form.priority === p ? PRIORITY_CONFIG[p].style : "border-gray-200 text-gray-400 hover:border-gray-300"
            }`}>
            {p}
          </button>
        ))}
      </div>

      {/* KR section */}
      <div className="space-y-2 pt-1 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">
            關鍵結果 (KR)
            {validKrCount > 0 && <span className="ml-1 text-gray-400 font-normal">({validKrCount})</span>}
          </span>
          <button type="button" onClick={handleSuggest} disabled={!form.title.trim() || suggesting}
            className="text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-40 transition-colors">
            {suggesting ? "AI 建議中…" : "✦ AI 建議"}
          </button>
        </div>

        {form.krs.map((kr, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input value={kr} onChange={(e) => updateKr(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addKr(); }}
              placeholder={`KR ${i + 1}`}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button type="button" onClick={() => removeKr(i)}
              className="text-gray-300 hover:text-red-400 text-xl leading-none shrink-0 transition-colors">×</button>
          </div>
        ))}

        <button type="button" onClick={addKr} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
          + 新增 KR
        </button>

        {form.title.trim() && validKrCount === 0 && (
          <p className="text-[11px] text-amber-500">請至少填入一個 KR，AI 才能準確評估你的想法</p>
        )}

        {suggestions.length > 0 && (
          <div className="bg-indigo-50 rounded-xl p-3 space-y-1.5">
            <p className="text-[11px] text-indigo-400 font-medium">AI 建議（點選加入，可再編輯）</p>
            {suggestions.map((s, i) => (
              <button key={i} type="button" onClick={() => addSuggestion(s)}
                className="block w-full text-left text-xs text-indigo-700 hover:text-indigo-900 px-2 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors">
                + {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Advanced toggle ── */}
      <div className="border-t border-gray-100 pt-2">
        <button type="button" onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600">
          <span className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}>›</span>
          進階設定
          {hasAdvanced && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-2 pl-3 border-l-2 border-gray-100">
            {groups.length > 0 && (
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">群組</label>
                <div className="flex gap-1.5 flex-wrap">
                  <button onClick={() => setForm({ ...form, groupId: "" })}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      form.groupId === "" ? "bg-gray-800 text-white border-gray-800" : "border-gray-200 text-gray-400 hover:border-gray-300"
                    }`}>無</button>
                  {groups.map((g) => (
                    <button key={g.id} onClick={() => setForm({ ...form, groupId: g.id })}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                        form.groupId === g.id ? "bg-gray-800 text-white border-gray-800" : "border-gray-200 text-gray-400 hover:border-gray-300"
                      }`}>{g.name}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">截止時間</label>
              <input type="date" value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
              />
            </div>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="說明（幫助 AI 更準確判斷）" rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none resize-none" />
            <textarea value={form.motivation} onChange={(e) => setForm({ ...form, motivation: e.target.value })}
              placeholder="動機（為什麼這個目標對你重要）" rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none resize-none" />
            <textarea value={form.expectedOutcome} onChange={(e) => setForm({ ...form, expectedOutcome: e.target.value })}
              placeholder="預期成果（完成後的狀態）" rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none resize-none" />
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
          取消
        </button>
        <button onClick={onSave} disabled={!canSave}
          className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {saving ? "儲存中…" : "儲存"}
        </button>
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const { user, requireAuth } = useAuth();
  const router = useRouter();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [groups, setGroups] = useState<ObjGroup[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [reanalysisTriggered, setReanalysisTriggered] = useState(false);

  useEffect(() => {
    if (!user) { requireAuth(); router.replace("/"); return; }
    fetchObjectives().then(setObjectives).catch(console.error);
    setGroups(getObjGroups());
  }, [user]);

  function krsFromForm(form: FormState): KeyResult[] {
    return form.krs.filter((t) => t.trim()).map((title) => ({ id: uuid(), title: title.trim() }));
  }

  function metaFromForm(form: FormState, existing?: Objective["meta"]) {
    return {
      ...(existing ?? {}),
      priority: form.priority,
      ...(form.deadline ? { deadline: form.deadline } : {}),
      ...(form.groupId ? { groupId: form.groupId } : {}),
      ...(form.description.trim() ? {} : {}), // description goes to objective.description
      ...(form.motivation.trim() ? { motivation: form.motivation.trim() } : {}),
      ...(form.expectedOutcome.trim() ? { expectedOutcome: form.expectedOutcome.trim() } : {}),
    };
  }

  async function handleAdd() {
    if (!form.title.trim() || form.krs.filter((k) => k.trim()).length === 0) return;
    setSaving(true);
    const newObj: Objective = {
      id: uuid(),
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      keyResults: krsFromForm(form),
      createdAt: new Date().toISOString(),
      status: "active",
      meta: metaFromForm(form),
    };
    await saveObjective(newObj);
    setObjectives((prev) => [newObj, ...prev]);
    markAllIdeasForReanalysis().catch(console.error);
    setReanalysisTriggered(true);
    setForm(emptyForm());
    setAdding(false);
    setSaving(false);
  }

  async function handleUpdate(id: string) {
    if (!form.title.trim() || form.krs.filter((k) => k.trim()).length === 0) return;
    setSaving(true);
    const existing = objectives.find((o) => o.id === id);
    if (!existing) return;

    const existingMap = new Map(existing.keyResults.map((kr) => [kr.title, kr]));
    const keyResults: KeyResult[] = form.krs
      .filter((t) => t.trim())
      .map((title) => existingMap.get(title.trim()) ?? { id: uuid(), title: title.trim() });

    const updated: Objective = {
      ...existing,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      keyResults,
      meta: metaFromForm(form, existing.meta),
    };

    const titleChanged = existing.title !== updated.title;
    const descChanged = (existing.description ?? "") !== (updated.description ?? "");
    const krsChanged =
      JSON.stringify(existing.keyResults.map((kr) => kr.title).sort()) !==
      JSON.stringify(keyResults.map((kr) => kr.title).sort());

    await saveObjective(updated);
    setObjectives((prev) => prev.map((o) => (o.id === id ? updated : o)));

    if (titleChanged || descChanged || krsChanged) {
      markAllIdeasForReanalysis().catch(console.error);
      setReanalysisTriggered(true);
    }

    setEditingId(null);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await removeObjective(id).catch(console.error);
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    markAllIdeasForReanalysis().catch(console.error);
    setReanalysisTriggered(true);
  }

  function startEdit(o: Objective) {
    setEditingId(o.id);
    setAdding(false);
    setForm({
      title: o.title,
      priority: o.meta?.priority ?? 2,
      krs: o.keyResults.map((kr) => kr.title),
      description: o.description ?? "",
      motivation: o.meta?.motivation ?? "",
      expectedOutcome: o.meta?.expectedOutcome ?? "",
      deadline: o.meta?.deadline ?? "",
      groupId: o.meta?.groupId ?? "",
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
          <button onClick={() => setSortAsc((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
            {sortAsc ? "1→3" : "3→1"}
          </button>
          {!adding && (
            <button onClick={() => { setAdding(true); setEditingId(null); setForm(emptyForm()); }}
              className="text-sm font-medium px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
              + 新增
            </button>
          )}
        </div>
      </div>

      {reanalysisTriggered && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-xs text-indigo-600">
          目標已更新，回到主頁後所有想法會自動重新分析
        </div>
      )}

      {adding && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <GoalForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => setAdding(false)} saving={saving} groups={groups} />
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
          {active.map((o) => {
            const group = groups.find((g) => g.id === o.meta?.groupId);
            return (
              <div key={o.id} className="bg-white rounded-xl border border-gray-200">
                {editingId === o.id ? (
                  <div className="p-4">
                    <GoalForm form={form} setForm={setForm} onSave={() => handleUpdate(o.id)} onCancel={() => setEditingId(null)} saving={saving} groups={groups} />
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded border shrink-0 ${PRIORITY_CONFIG[o.meta?.priority ?? 2].style}`}>
                            {PRIORITY_CONFIG[o.meta?.priority ?? 2].label}
                          </span>
                          {group && (
                            <span className="text-xs px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-500 shrink-0">
                              {group.name}
                            </span>
                          )}
                          {o.meta?.deadline && (
                            <span className="text-xs px-1.5 py-0.5 rounded border border-amber-100 bg-amber-50 text-amber-600 shrink-0">
                              {o.meta.deadline}
                            </span>
                          )}
                          <p className="text-sm font-medium text-gray-800 truncate">{o.title}</p>
                        </div>
                        {o.description && (
                          <p className="text-xs text-gray-400 mt-1 leading-snug">{o.description}</p>
                        )}
                      </div>
                      <div className="flex gap-3 shrink-0">
                        <button onClick={() => startEdit(o)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">編輯</button>
                        <button onClick={() => handleDelete(o.id)} className="text-xs text-gray-300 hover:text-red-400 transition-colors">刪除</button>
                      </div>
                    </div>
                    {o.keyResults.length > 0 && (
                      <div className="mt-2 space-y-1 pl-1">
                        {o.keyResults.map((kr) => (
                          <p key={kr.id} className="text-xs text-gray-400 flex items-start gap-1.5">
                            <span className="text-gray-300 shrink-0 mt-0.5">—</span>
                            {kr.title}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
