"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, ObjGroup, GoalSuggestion } from "@/lib/types";
import { fetchObjectives, saveObjective, removeObjective, markAllIdeasForReanalysis } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
import { getObjGroups, saveObjGroups } from "@/lib/storage";
import { useLanguage } from "@/components/LanguageProvider";
import RichTextArea from "@/components/RichTextArea";
import RichTextDisplay from "@/components/RichTextDisplay";
import OKRChat from "@/components/OKRChat";

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
  description: string;
  motivation: string;
  expectedOutcome: string;
  deadline: string;
  groupId: string;
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
  const { t } = useLanguage();
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
  const hasAdvanced = form.description || form.motivation || form.expectedOutcome || form.deadline;

  return (
    <div className="space-y-3">
      <input
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && canSave && onSave()}
        placeholder={t("form.goalName")}
        autoFocus
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 mr-1">{t("form.priority")}</span>
        {([1, 2, 3] as Priority[]).map((p) => (
          <button key={p} onClick={() => setForm({ ...form, priority: p })}
            className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
              form.priority === p ? PRIORITY_CONFIG[p].style : "border-gray-200 text-gray-400 hover:border-gray-300"
            }`}>
            {p}
          </button>
        ))}
        {groups.length > 0 && (
          <>
            <span className="text-xs text-gray-300">|</span>
            <span className="text-xs text-gray-500">{t("form.group")}</span>
            <button onClick={() => setForm({ ...form, groupId: "" })}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                form.groupId === "" ? "bg-gray-800 text-white border-gray-800" : "border-gray-200 text-gray-400 hover:border-gray-300"
              }`}>{t("form.noGroup")}</button>
            {groups.map((g) => (
              <button key={g.id} onClick={() => setForm({ ...form, groupId: g.id })}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  form.groupId === g.id ? "bg-gray-800 text-white border-gray-800" : "border-gray-200 text-gray-400 hover:border-gray-300"
                }`}>{g.name}</button>
            ))}
          </>
        )}
      </div>

      <div className="space-y-2 pt-1 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">
            {t("form.keyResults")}
            {validKrCount > 0 && <span className="ml-1 text-gray-400 font-normal">({validKrCount})</span>}
          </span>
          <div className="flex flex-col items-end gap-0.5">
            <button type="button" onClick={handleSuggest} disabled={!form.title.trim() || suggesting}
              className="text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-40 transition-colors">
              {suggesting ? t("form.aiSuggesting") : t("form.aiSuggest")}
            </button>
            <span className="text-[10px] text-gray-400">{t("form.aiSuggestHint")}</span>
          </div>
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
          {t("form.addKR")}
        </button>

        {form.title.trim() && validKrCount === 0 && (
          <p className="text-[11px] text-amber-500">{t("form.krRequired")}</p>
        )}

        {suggestions.length > 0 && (
          <div className="bg-indigo-50 rounded-xl p-3 space-y-1.5">
            <p className="text-[11px] text-indigo-400 font-medium">{t("form.aiSuggestions")}</p>
            {suggestions.map((s, i) => (
              <button key={i} type="button" onClick={() => addSuggestion(s)}
                className="block w-full text-left text-xs text-indigo-700 hover:text-indigo-900 px-2 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors">
                + {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-2">
        <button type="button" onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600">
          <span className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}>›</span>
          {t("form.advanced")}
          {hasAdvanced && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-2 pl-3 border-l-2 border-gray-100">
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">{t("form.deadline")}</label>
              <input type="date" value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
              />
            </div>
            <RichTextArea value={form.description} onChange={(v) => setForm({ ...form, description: v })}
              placeholder={t("form.descPlaceholder")} rows={2} />
            <RichTextArea value={form.motivation} onChange={(v) => setForm({ ...form, motivation: v })}
              placeholder={t("form.motivationPlaceholder")} rows={2} />
            <RichTextArea value={form.expectedOutcome} onChange={(v) => setForm({ ...form, expectedOutcome: v })}
              placeholder={t("form.outcomePlaceholder")} rows={2} />
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
          {t("action.cancel")}
        </button>
        <button onClick={onSave} disabled={!canSave}
          className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {saving ? t("action.saving") : t("action.save")}
        </button>
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const { user, requireAuth } = useAuth();
  const { t, language } = useLanguage();
  const router = useRouter();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [groups, setGroups] = useState<ObjGroup[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [reanalysisTriggered, setReanalysisTriggered] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [chatMode, setChatMode] = useState<"goalBuilder" | "optimize">("goalBuilder");
  const [chatKey, setChatKey] = useState(0);
  const [desktopChatOpen, setDesktopChatOpen] = useState(false);
  const [mobileSheetVisible, setMobileSheetVisible] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  useEffect(() => {
    if (!user) { requireAuth(); router.replace("/"); return; }
    fetchObjectives().then(setObjectives).catch(console.error);
    setGroups(getObjGroups());
  }, [user]);

  function krsFromForm(form: FormState): KeyResult[] {
    return form.krs.filter((t) => t.trim()).map((title) => ({ id: uuid(), title: title.trim() }));
  }

  function metaFromForm(form: FormState, existing?: Objective["meta"]) {
    const base = { ...(existing ?? {}) };
    const meta = {
      ...base,
      priority: form.priority,
      deadline: form.deadline || undefined,
      groupId: form.groupId || undefined,
      motivation: form.motivation.trim() || undefined,
      expectedOutcome: form.expectedOutcome.trim() || undefined,
    };
    return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Objective["meta"];
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
    const obj = objectives.find((o) => o.id === id);
    if (!obj) return;
    const deleted = { ...obj, status: "deleted" as const };
    setObjectives((prev) => prev.map((o) => o.id === id ? deleted : o));
    await saveObjective(deleted).catch(console.error);
    markAllIdeasForReanalysis().catch(console.error);
    setReanalysisTriggered(true);
  }

  async function handleRestore(id: string) {
    const obj = objectives.find((o) => o.id === id);
    if (!obj) return;
    const restored = { ...obj, status: "active" as const };
    setObjectives((prev) => prev.map((o) => o.id === id ? restored : o));
    await saveObjective(restored).catch(console.error);
    markAllIdeasForReanalysis().catch(console.error);
    setReanalysisTriggered(true);
  }

  async function handlePermanentDelete(id: string) {
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    await removeObjective(id).catch(console.error);
  }

  async function handleApplySuggestion(suggestion: GoalSuggestion) {
    const ops = suggestion.goals;
    for (const item of ops) {
      if (item.action === "add") {
        const newObj: Objective = {
          id: uuid(),
          title: item.title,
          description: item.description?.trim() || undefined,
          keyResults: item.krs.map((kr) => ({ id: uuid(), title: kr })),
          createdAt: new Date().toISOString(),
          status: "active",
          meta: { priority: item.priority ?? 2, groupId: item.groupId || undefined },
        };
        await saveObjective(newObj).catch(console.error);
        setObjectives((prev) => [newObj, ...prev]);
      } else if (item.action === "update" && item.id) {
        const existing = objectives.find((o) => o.id === item.id);
        if (!existing) continue;
        const existingMap = new Map(existing.keyResults.map((kr) => [kr.title, kr]));
        const updated: Objective = {
          ...existing,
          title: item.title,
          description: item.description?.trim() || undefined,
          keyResults: item.krs.map((kr) => existingMap.get(kr) ?? { id: uuid(), title: kr }),
          meta: { ...existing.meta, priority: item.priority ?? existing.meta?.priority ?? 2 },
        };
        await saveObjective(updated).catch(console.error);
        setObjectives((prev) => prev.map((o) => o.id === item.id ? updated : o));
      } else if (item.action === "remove" && item.id) {
        const existing = objectives.find((o) => o.id === item.id);
        if (!existing) continue;
        const deleted = { ...existing, status: "deleted" as const };
        await saveObjective(deleted).catch(console.error);
        setObjectives((prev) => prev.map((o) => o.id === item.id ? deleted : o));
      }
    }
    markAllIdeasForReanalysis().catch(console.error);
    setReanalysisTriggered(true);
  }

  function openChat(mode: "goalBuilder" | "optimize") {
    setChatMode(mode);
    setChatKey((k) => k + 1);
    setDesktopChatOpen(true);
    setMobileSheetVisible(true);
    setMobileExpanded(true);
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

  const deletedObjs = objectives.filter((o) => o.status === "deleted");

  const sharedChatProps = {
    objectives,
    groups,
    onApplySuggestion: handleApplySuggestion,
    mode: chatMode,
  };

  return (
    <>
    <div className="flex">
      {/* Goals list — left column */}
      <div className="flex-1 min-w-0">
      <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-5">
      {/* Title row */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t("goals.title")}</h1>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{t("goals.subtitle")}</p>
        </div>
        {!adding && (
          <button onClick={() => { setAdding(true); setEditingId(null); setForm(emptyForm()); }}
            className="shrink-0 text-sm font-medium px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
            + {t("action.add")}
          </button>
        )}
      </div>

      {/* Secondary actions row — desktop only */}
      <div className="hidden md:flex items-center gap-1.5">
        <button onClick={() => setShowGroupModal(true)}
          className="text-xs text-gray-400 hover:text-gray-600 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors whitespace-nowrap">
          {t("goals.groupBtn")}{groups.length > 0 ? ` (${groups.length})` : ""}
        </button>
        <button onClick={() => setSortAsc((v) => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors whitespace-nowrap">
          {sortAsc ? "1→3" : "3→1"}
        </button>
        <div className="flex-1" />
        <button onClick={() => openChat("optimize")}
          className="text-xs text-gray-400 hover:text-indigo-600 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-indigo-200 transition-colors whitespace-nowrap">
          {t("chat.optimize")}
        </button>
        <button onClick={() => openChat("goalBuilder")}
          className="text-xs text-indigo-500 hover:text-indigo-700 px-2.5 py-1.5 rounded-lg border border-indigo-200 hover:border-indigo-300 transition-colors whitespace-nowrap">
          {t("chat.goalBuilder")}
        </button>
      </div>

      {/* Mobile-only AI buttons */}
      <div className="flex gap-2 md:hidden">
        <button onClick={() => openChat("goalBuilder")}
          className="flex-1 text-xs text-indigo-500 hover:text-indigo-700 px-3 py-2 rounded-xl border border-indigo-200 hover:border-indigo-300 transition-colors text-center">
          {t("chat.goalBuilder")}
        </button>
        <button onClick={() => openChat("optimize")}
          className="flex-1 text-xs text-gray-400 hover:text-gray-600 px-3 py-2 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors text-center">
          {t("chat.optimize")}
        </button>
      </div>

      {reanalysisTriggered && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-xs text-indigo-600">
          {t("goals.reanalysisNotice")}
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
          <p className="text-sm text-gray-400">{t("goals.noGoals")}</p>
          <p className="text-xs text-gray-300 mt-1">{t("goals.noGoalsHint")}</p>
        </div>
      ) : (() => {
        const renderObj = (o: typeof active[0]) => (
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
                      {o.meta?.deadline && (
                        <span className="text-xs px-1.5 py-0.5 rounded border border-amber-100 bg-amber-50 text-amber-600 shrink-0">
                          {o.meta.deadline}
                        </span>
                      )}
                      <p className="text-sm font-medium text-gray-800 truncate">{o.title}</p>
                    </div>
                    {o.description && (
                      <RichTextDisplay text={o.description} className="text-xs text-gray-400 mt-1" />
                    )}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <Link href={`/okr/${o.id}`} className="text-xs text-indigo-400 hover:text-indigo-600 transition-colors">
                      {language === "zh-TW" ? "路徑圖" : "Roadmap"}
                    </Link>
                    <button onClick={() => startEdit(o)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">{t("action.edit")}</button>
                    <button onClick={() => handleDelete(o.id)} className="text-xs text-gray-300 hover:text-red-400 transition-colors">{t("action.delete")}</button>
                  </div>
                </div>
                {o.keyResults.length > 0 && (
                  <div className="mt-2 space-y-1.5 pl-1">
                    {o.keyResults.map((kr) => (
                      <div key={kr.id} className="flex items-start gap-2">
                        <span className="text-gray-300 shrink-0 mt-0.5 leading-none">—</span>
                        <span className="text-xs text-gray-400 leading-relaxed min-w-0">{kr.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );

        const groupSections = groups
          .slice().sort((a, b) => a.priority - b.priority)
          .map((g) => ({ group: g, objs: active.filter((o) => o.meta?.groupId === g.id) }))
          .filter((s) => s.objs.length > 0);
        const ungrouped = active.filter((o) => !o.meta?.groupId);
        const hasGroupSections = groupSections.length > 0;

        return (
          <div className="space-y-3">
            {hasGroupSections ? (
              <>
                {groupSections.map(({ group: g, objs }) => {
                  const collapsed = collapsedGroups.has(g.id);
                  return (
                    <div key={g.id} className="space-y-2">
                      <div className="flex items-center gap-2 w-full">
                        <button
                          onClick={() => setCollapsedGroups((prev) => {
                            const next = new Set(prev);
                            next.has(g.id) ? next.delete(g.id) : next.add(g.id);
                            return next;
                          })}
                          className="flex items-center gap-2 flex-1 text-left py-0.5 min-w-0"
                        >
                          <span className={`text-gray-400 text-xs transition-transform leading-none shrink-0 ${collapsed ? "" : "rotate-90"}`}>›</span>
                          <span className="text-sm font-semibold text-gray-700 truncate">{g.name}</span>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded border shrink-0 ${PRIORITY_CONFIG[g.priority].style}`}>{g.priority}</span>
                          <span className="text-xs text-gray-400 shrink-0">{t("goals.objCount", { n: objs.length })}</span>
                        </button>
                        <Link
                          href={`/okr/group/${g.id}`}
                          className="text-xs text-indigo-400 hover:text-indigo-600 transition-colors shrink-0 py-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {language === "zh-TW" ? "路徑圖" : "Roadmap"}
                        </Link>
                      </div>
                      {!collapsed && (
                        <div className="space-y-2 pl-3 border-l-2 border-gray-100">
                          {objs.map(renderObj)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {ungrouped.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400 font-medium pl-0.5">{t("goals.ungrouped")}</p>
                    {ungrouped.map(renderObj)}
                  </div>
                )}
              </>
            ) : (
              active.map(renderObj)
            )}
          </div>
        );
      })()}

      {deletedObjs.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{t("goals.deletedCount", { n: deletedObjs.length })}</p>
            <button
              onClick={async () => {
                const toDelete = [...deletedObjs];
                setObjectives((prev) => prev.filter((o) => o.status !== "deleted"));
                await Promise.all(toDelete.map((o) => removeObjective(o.id).catch(console.error)));
              }}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              {t("action.clearAll")}
            </button>
          </div>
          {deletedObjs.map((o) => (
            <div key={o.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
              <p className="text-sm text-gray-400 flex-1 truncate line-through">{o.title}</p>
              <button onClick={() => handleRestore(o.id)} className="text-xs text-gray-400 hover:text-indigo-600 shrink-0 transition-colors">{t("action.restore")}</button>
              <button onClick={() => handlePermanentDelete(o.id)} className="text-xs text-red-300 hover:text-red-500 shrink-0 transition-colors">{t("action.permanentDelete")}</button>
            </div>
          ))}
        </div>
      )}

      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowGroupModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{t("groupModal.title")}</h2>
              <button onClick={() => setShowGroupModal(false)} className="text-gray-300 hover:text-gray-500 text-xl leading-none">×</button>
            </div>

            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                  <input
                    value={g.name}
                    onChange={(e) => {
                      const updated = groups.map((x) => x.id === g.id ? { ...x, name: e.target.value } : x);
                      setGroups(updated);
                      saveObjGroups(updated);
                    }}
                    className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder:text-gray-300"
                    placeholder={t("groupModal.namePlaceholder")}
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    {([1, 2, 3] as const).map((p) => (
                      <button
                        key={p}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const updated = groups.map((x) => x.id === g.id ? { ...x, priority: p } : x);
                          setGroups(updated);
                          saveObjGroups(updated);
                        }}
                        className={`text-xs w-6 h-6 rounded border font-medium transition-colors ${
                          g.priority === p ? PRIORITY_CONFIG[p].style : "border-gray-200 text-gray-300 hover:border-gray-300"
                        }`}
                      >{p}</button>
                    ))}
                  </div>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const updated = groups.filter((x) => x.id !== g.id);
                      setGroups(updated);
                      saveObjGroups(updated);
                    }}
                    className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none shrink-0"
                  >×</button>
                </div>
              ))}

              <div className="flex gap-2 pt-1">
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && newGroupName.trim()) {
                      const updated = [...groups, { id: uuid(), name: newGroupName.trim(), priority: 2 as const }];
                      setGroups(updated);
                      saveObjGroups(updated);
                      setNewGroupName("");
                    }
                  }}
                  placeholder={t("groupModal.newGroupPlaceholder")}
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
                />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (!newGroupName.trim()) return;
                    const updated = [...groups, { id: uuid(), name: newGroupName.trim(), priority: 2 as const }];
                    setGroups(updated);
                    saveObjGroups(updated);
                    setNewGroupName("");
                  }}
                  disabled={!newGroupName.trim()}
                  className="text-sm px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >{t("action.add")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
      </div>

      {/* Desktop chat panel */}
      {desktopChatOpen && (
        <div className="hidden lg:flex w-[380px] shrink-0 flex-col border-l border-gray-100 sticky top-0 self-start h-screen">
          <OKRChat key={chatKey} {...sharedChatProps} onClose={() => setDesktopChatOpen(false)} />
        </div>
      )}
    </div>

    {/* Mobile bottom sheet */}
    {mobileSheetVisible && (
      <div className={`lg:hidden fixed left-0 right-0 z-40 bg-white rounded-t-2xl border-t border-gray-100 shadow-xl flex flex-col transition-transform duration-300 h-[65vh] bottom-14 ${mobileExpanded ? "translate-y-0" : "translate-y-[calc(100%-52px)]"}`}>
        <button
          onClick={() => setMobileExpanded((v) => !v)}
          className="flex items-center justify-center gap-2 h-[52px] shrink-0 w-full"
        >
          <div className="w-8 h-1 rounded-full bg-gray-200" />
          <span className="text-xs font-medium text-gray-500">{t("chat.toggleChat")}</span>
          <span className={`text-xs text-gray-300 transition-transform ${mobileExpanded ? "rotate-180" : ""}`}>▲</span>
        </button>
        <div className="flex-1 min-h-0 overflow-hidden">
          <OKRChat key={chatKey} {...sharedChatProps} onClose={() => { setMobileSheetVisible(false); setMobileExpanded(false); }} />
        </div>
      </div>
    )}
    </>
  );
}
