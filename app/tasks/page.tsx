"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import {
  Idea, Objective, KeyResult, TaskStatus, IdeaStatus,
  IdeaKRLink, IdeaAnalysis, TodoItem,
} from "@/lib/types";
import {
  fetchIdeas, fetchObjectives, removeIdea, saveIdea,
  saveObjective, updateIdeaTaskStatus, updateIdeaStatus,
} from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import ScoreBar from "@/components/ScoreBar";
import Markdown from "@/components/Markdown";

type CreateStatus = "idle" | "clarifying" | "analyzing" | "confirm" | "saving";
type TaskFilter = "active" | "shelved" | "deleted";
type MeasurementInputs = Record<string, Record<string, string>>;

interface SuggestedLink {
  objectiveId: string;
  objectiveTitle: string;
  krId: string;
  krTitle: string;
  score: number;
}

function calcKRCompletion(kr: KeyResult): number | undefined {
  if (kr.krType === "milestone") return kr.currentValue && kr.currentValue >= 1 ? 100 : 0;
  if (!kr.targetValue || kr.targetValue <= 0) return undefined;
  return Math.min(100, Math.round(((kr.currentValue ?? 0) / kr.targetValue) * 100));
}

function getProgressColor(completion: number): string {
  if (completion >= 60) return "bg-green-400";
  if (completion >= 30) return "bg-amber-400";
  return "bg-gray-400";
}

function buildProgressContext(objectives: Objective[]): string {
  return objectives.map((o) => {
    const krLines = o.keyResults.map((kr) => {
      const pct = calcKRCompletion(kr);
      return `    - ${kr.title}${pct !== undefined ? ` (${Math.round(pct)}% complete)` : ""}`;
    }).join("\n");
    return `${o.title}:\n${krLines}`;
  }).join("\n\n");
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

function LinkedObjsEditable({ links, objectives, onRemove }: {
  links: IdeaKRLink[];
  objectives: Objective[];
  onRemove: (index: number) => void;
}) {
  if (links.length === 0) return null;
  const grouped: { obj: Objective; items: { kr: KeyResult | null; linkIndex: number }[] }[] = [];
  links.forEach((link, idx) => {
    const obj = objectives.find((o) => o.id === link.objectiveId);
    if (!obj) return;
    let entry = grouped.find((g) => g.obj.id === obj.id);
    if (!entry) { entry = { obj, items: [] }; grouped.push(entry); }
    const kr = link.krId ? obj.keyResults.find((k) => k.id === link.krId) ?? null : null;
    entry.items.push({ kr, linkIndex: idx });
  });
  return (
    <div className="space-y-1.5">
      {grouped.map(({ obj, items }) => (
        <div key={obj.id}>
          <p className="text-xs text-gray-500 font-medium leading-snug">{obj.title}</p>
          {items.map(({ kr, linkIndex }) => (
            <div key={linkIndex} className="flex items-center gap-1.5 pl-2 mt-0.5">
              <span className="text-xs text-gray-600 flex-1 truncate">
                {kr ? `↳ ${kr.title}` : "（整體目標）"}
              </span>
              <button onClick={() => onRemove(linkIndex)} className="text-gray-300 hover:text-red-400 text-sm leading-none">×</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TasksPageInner() {
  const searchParams = useSearchParams();
  const preselectedKrId = searchParams.get("krId") ?? undefined;
  const preselectedObjectiveId = searchParams.get("objectiveId") ?? undefined;
  const prefilledTitle = searchParams.get("title") ?? "";

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  // ── Creation form ──────────────────────────────────────────────────────────

  const [createStatus, setCreateStatus] = useState<CreateStatus>("idle");
  const [createOpen, setCreateOpen] = useState(() => !!prefilledTitle);
  const [title, setTitle] = useState(() => prefilledTitle);
  const [why, setWhy] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [analysis, setAnalysis] = useState<IdeaAnalysis | null>(null);
  const [suggestedLinks, setSuggestedLinks] = useState<SuggestedLink[]>([]);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState("");
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");

  const hasDetails = why.trim() || outcome.trim() || notes.trim();
  const isQuickMode = !hasDetails;

  async function runAnalysis(extraNotes?: string) {
    setCreateStatus("analyzing");
    setErrorMsg("");
    try {
      const combinedNotes = [notes, extraNotes].filter(Boolean).join("\n");
      const result = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle: title, ideaWhy: why, ideaOutcome: outcome,
        ideaNotes: combinedNotes, objectives,
        progressContext: buildProgressContext(objectives),
      });
      setAnalysis(result);

      const links: SuggestedLink[] = [];
      for (const os of result.objectiveScores) {
        for (const krs of os.keyResultScores) {
          if (krs.score >= 5) {
            links.push({
              objectiveId: os.objectiveId, objectiveTitle: os.objectiveTitle,
              krId: krs.keyResultId, krTitle: krs.keyResultTitle, score: krs.score,
            });
          }
        }
      }
      links.sort((a, b) => b.score - a.score);

      if (preselectedKrId && preselectedObjectiveId) {
        const obj = objectives.find((o) => o.id === preselectedObjectiveId);
        const kr = obj?.keyResults.find((k) => k.id === preselectedKrId);
        if (kr && !links.some((l) => l.krId === preselectedKrId)) {
          links.push({ objectiveId: preselectedObjectiveId, objectiveTitle: obj!.title, krId: preselectedKrId, krTitle: kr.title, score: 0 });
        }
      }

      setSuggestedLinks(links);
      const initialSelected = new Set(links.filter((l) => l.score >= 7).map((l) => l.krId));
      if (preselectedKrId) initialSelected.add(preselectedKrId);
      setSelectedLinkIds(initialSelected);
      setCreateStatus("confirm");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "分析失敗");
      setCreateStatus("idle");
    }
  }

  async function handleAnalyze() {
    if (!title.trim()) return;
    if (objectives.length === 0) { setErrorMsg("請先建立至少一個 OKR 目標"); return; }
    setErrorMsg("");

    if (isQuickMode) {
      setCreateStatus("clarifying");
      try {
        const { shouldClarify, question } = await callAI<{ shouldClarify: boolean; question: string }>(
          "clarifyIdea", { ideaTitle: title, objectives }
        );
        if (shouldClarify && question) {
          setClarifyQuestion(question);
          setClarifyAnswer("");
          return;
        }
      } catch { /* fall through */ }
    }

    await runAnalysis();
  }

  async function handleConfirm() {
    if (!analysis) return;
    setCreateStatus("saving");

    const linkedKRs: IdeaKRLink[] = suggestedLinks
      .filter((l) => selectedLinkIds.has(l.krId))
      .map((l) => ({ objectiveId: l.objectiveId, krId: l.krId }));

    const descParts: string[] = [];
    if (why.trim()) descParts.push(`為什麼要做：${why}`);
    if (outcome.trim()) descParts.push(`預期成效：${outcome}`);
    if (notes.trim()) descParts.push(`備註：${notes}`);

    const newIdea: Idea = {
      id: uuid(),
      title,
      description: descParts.join("\n"),
      analysis,
      createdAt: new Date().toISOString(),
      completed: false,
      linkedKRs,
      taskStatus: "todo",
      quickAnalysis: isQuickMode,
    };

    try {
      await saveIdea(newIdea);
      setIdeas((prev) => [newIdea, ...prev]);
      resetForm();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "儲存失敗");
      setCreateStatus("confirm");
    }
  }

  function toggleLink(krId: string) {
    setSelectedLinkIds((prev) => {
      const next = new Set(prev);
      if (next.has(krId)) next.delete(krId); else next.add(krId);
      return next;
    });
  }

  function resetForm() {
    setCreateStatus("idle");
    setCreateOpen(false);
    setAnalysis(null);
    setSuggestedLinks([]);
    setSelectedLinkIds(new Set());
    setClarifyQuestion(""); setClarifyAnswer("");
    setTitle(""); setWhy(""); setOutcome(""); setNotes(""); setDetailsOpen(false);
    setErrorMsg("");
  }

  // ── Task list ──────────────────────────────────────────────────────────────

  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null);
  const [showObjPickerId, setShowObjPickerId] = useState<string | null>(null);
  const [pendingMeasure, setPendingMeasure] = useState<string | null>(null);
  const [measureInputs, setMeasureInputs] = useState<MeasurementInputs>({});
  const [expandedAnalysisIds, setExpandedAnalysisIds] = useState<Set<string>>(new Set());
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("active");
  const [reanalyzingIds, setReanalyzingIds] = useState<Set<string>>(new Set());
  const todoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function setIdeaStatus(id: string, status: IdeaStatus) {
    updateIdeaStatus(id, status).catch(console.error);
    setIdeas((prev) => prev.map((i) => i.id === id ? { ...i, ideaStatus: status } : i));
  }
  function handleSoftDelete(id: string) { setIdeaStatus(id, "deleted"); }
  function handleShelve(id: string) { setIdeaStatus(id, "shelved"); }
  function handleRestore(id: string) { setIdeaStatus(id, "active"); }
  function handlePermanentDelete(id: string) {
    if (!confirm("永久刪除後無法復原，確定嗎？")) return;
    removeIdea(id).catch(console.error);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  async function handleReanalyze(idea: Idea) {
    if (reanalyzingIds.has(idea.id)) return;
    setReanalyzingIds((prev) => new Set(prev).add(idea.id));
    try {
      const result = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle: idea.title, ideaWhy: "", ideaOutcome: "",
        ideaNotes: idea.description ?? "", objectives,
        progressContext: buildProgressContext(objectives),
      });
      const updated: Idea = { ...idea, analysis: result, needsReanalysis: false };
      setIdeas((prev) => prev.map((i) => i.id === idea.id ? updated : i));
      saveIdea(updated).catch(console.error);
    } catch { /* silent */ } finally {
      setReanalyzingIds((prev) => { const s = new Set(prev); s.delete(idea.id); return s; });
    }
  }

  function handleToggleTodo(ideaId: string, todoId: string) {
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const todos = (i.todos ?? []).map((t) =>
        t.id === todoId ? { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : undefined } : t
      );
      const updated = { ...i, todos };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
  }

  function handleAddTodoAfter(ideaId: string, afterTodoId?: string) {
    const todo: TodoItem = { id: crypto.randomUUID(), title: "", done: false };
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const todos = i.todos ?? [];
      const newTodos = afterTodoId
        ? (() => { const idx = todos.findIndex((t) => t.id === afterTodoId); return [...todos.slice(0, idx + 1), todo, ...todos.slice(idx + 1)]; })()
        : [...todos, todo];
      const updated = { ...i, todos: newTodos };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
    setTimeout(() => todoInputRefs.current[todo.id]?.focus(), 30);
  }

  function handleUpdateTodoTitle(ideaId: string, todoId: string, newTitle: string) {
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const todos = (i.todos ?? []).map((t) => t.id === todoId ? { ...t, title: newTitle } : t);
      const updated = { ...i, todos };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
  }

  function handleDeleteTodo(ideaId: string, todoId: string) {
    const idea = ideas.find((i) => i.id === ideaId);
    const todos = idea?.todos ?? [];
    const idx = todos.findIndex((t) => t.id === todoId);
    const prevId = idx > 0 ? todos[idx - 1].id : null;
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const updated = { ...i, todos: (i.todos ?? []).filter((t) => t.id !== todoId) };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
    if (prevId) setTimeout(() => todoInputRefs.current[prevId]?.focus(), 30);
  }

  function handleUpdateLinkedKRs(ideaId: string, links: IdeaKRLink[]) {
    setIdeas((prev) => {
      const updated = prev.map((i) => i.id === ideaId ? { ...i, linkedKRs: links } : i);
      const idea = updated.find((i) => i.id === ideaId);
      if (idea) saveIdea(idea).catch(console.error);
      return updated;
    });
  }

  function collectLinkedKRs(task: Idea) {
    return (task.linkedKRs ?? []).flatMap((link) => {
      const obj = objectives.find((o) => o.id === link.objectiveId);
      if (!obj) return [];
      const kr = link.krId ? obj.keyResults.find((k) => k.id === link.krId) : null;
      if (!kr) return [];
      return [{ obj, kr, link }];
    });
  }

  function handleSetTaskStatus(taskId: string, status: TaskStatus) {
    const task = ideas.find((i) => i.id === taskId);
    if (!task || task.taskStatus === status) return;
    const wasDown = task.taskStatus === "done";
    if (status !== "done") {
      if (wasDown) applyTaskUndo(task);
      updateIdeaTaskStatus(taskId, status).catch(console.error);
      setIdeas((prev) => prev.map((i) => i.id === taskId ? { ...i, taskStatus: status } : i));
      return;
    }
    const linkedKRs = collectLinkedKRs(task);
    if (linkedKRs.some((r) => (r.kr.krType ?? "cumulative") === "measurement")) {
      const initInputs: Record<string, string> = {};
      linkedKRs.filter((r) => (r.kr.krType ?? "cumulative") === "measurement").forEach((r) => {
        initInputs[r.kr.id] = String(r.kr.currentValue ?? "");
      });
      setMeasureInputs((prev) => ({ ...prev, [taskId]: initInputs }));
      setPendingMeasure(taskId);
      return;
    }
    applyTaskDone(taskId, task, linkedKRs, {});
  }

  function applyTaskUndo(task: Idea) {
    const linkedKRLinks = (task.linkedKRs ?? []).filter((l) => l.krId);
    if (linkedKRLinks.length === 0) return;
    setObjectives((prevObjs) => {
      const updatedMap = new Map<string, Objective>();
      for (const link of linkedKRLinks) {
        const obj = prevObjs.find((o) => o.id === link.objectiveId);
        if (!obj || !link.krId) continue;
        const current = updatedMap.get(obj.id) ?? obj;
        const kr = current.keyResults.find((k) => k.id === link.krId);
        if (!kr) continue;
        const krType = kr.krType ?? "cumulative";
        let newValue: number | undefined;
        if (krType === "cumulative") {
          const getScore = (krId: string) =>
            task.analysis?.objectiveScores.find((os) => os.objectiveId === obj.id)
              ?.keyResultScores.find((ks) => ks.keyResultId === krId)?.score ?? 1;
          const totalScore = linkedKRLinks.filter((l) => l.objectiveId === obj.id).reduce((sum, l) => sum + getScore(l.krId!), 0) || 1;
          newValue = Math.max(0, (kr.currentValue ?? 0) - (kr.incrementPerTask ?? 1) * (getScore(kr.id) / totalScore));
        } else {
          newValue = 0;
        }
        updatedMap.set(obj.id, { ...current, keyResults: current.keyResults.map((k) => k.id === link.krId ? { ...k, currentValue: newValue } : k) });
      }
      updatedMap.forEach((o) => saveObjective(o).catch(console.error));
      return prevObjs.map((o) => updatedMap.get(o.id) ?? o);
    });
  }

  function confirmMeasurement(taskId: string) {
    const task = ideas.find((i) => i.id === taskId);
    if (!task) return;
    applyTaskDone(taskId, task, collectLinkedKRs(task), measureInputs[taskId] ?? {});
    setPendingMeasure(null);
  }

  function applyTaskDone(
    taskId: string, task: Idea,
    linkedKRs: Array<{ obj: Objective; kr: KeyResult; link: IdeaKRLink }>,
    measurements: Record<string, string>
  ) {
    const updatedObjectives = new Map<string, Objective>();
    for (const { obj, kr } of linkedKRs) {
      const current = updatedObjectives.get(obj.id) ?? obj;
      const krType = kr.krType ?? "cumulative";
      let newValue: number | undefined;
      if (krType === "cumulative") {
        const linkedInObj = linkedKRs.filter((r) => r.obj.id === obj.id);
        const getScore = (krId: string) =>
          task.analysis?.objectiveScores.find((os) => os.objectiveId === obj.id)
            ?.keyResultScores.find((ks) => ks.keyResultId === krId)?.score ?? 1;
        const totalScore = linkedInObj.reduce((sum, r) => sum + getScore(r.kr.id), 0) || 1;
        newValue = Math.min(kr.targetValue ?? Infinity, (kr.currentValue ?? 0) + (kr.incrementPerTask ?? 1) * (getScore(kr.id) / totalScore));
      } else if (krType === "measurement") {
        const raw = measurements[kr.id];
        if (raw !== undefined && raw !== "") newValue = parseFloat(raw);
      } else if (krType === "milestone") {
        newValue = 1;
      }
      if (newValue !== undefined) {
        updatedObjectives.set(obj.id, { ...current, keyResults: current.keyResults.map((k) => k.id === kr.id ? { ...k, currentValue: newValue } : k) });
      }
    }
    updatedObjectives.forEach((o) => saveObjective(o).catch(console.error));
    setObjectives((prev) => prev.map((o) => updatedObjectives.get(o.id) ?? o));
    updateIdeaTaskStatus(taskId, "done").catch(console.error);
    setIdeas((prev) => {
      const updatedKRIds = new Set(linkedKRs.map((r) => r.kr.id));
      return prev.map((i) => {
        if (i.id === taskId) return { ...i, taskStatus: "done" };
        if (i.taskStatus === "done" || !i.analysis) return i;
        if (!(i.linkedKRs ?? []).some((l) => l.krId && updatedKRIds.has(l.krId))) return i;
        const updated = { ...i, needsReanalysis: true };
        saveIdea(updated).catch(console.error);
        return updated;
      });
    });
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeTasks = ideas.filter((i) => (i.ideaStatus ?? "active") === "active");
  const shelvedTasks = ideas.filter((i) => i.ideaStatus === "shelved");
  const deletedTasks = ideas.filter((i) => i.ideaStatus === "deleted");
  const sortedActiveTasks = [...activeTasks].sort((a, b) => {
    const aDone = a.taskStatus === "done" ? 1 : 0;
    const bDone = b.taskStatus === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (b.analysis?.finalScore ?? -1) - (a.analysis?.finalScore ?? -1);
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">

      {/* ── 新增 Task ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

        {/* Collapsed: single-line input trigger */}
        {!createOpen && createStatus === "idle" && (
          <div className="px-4 py-3">
            <input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setCreateOpen(true); }}
              onFocus={() => setCreateOpen(true)}
              placeholder="+ 新增 Task…"
              className="w-full text-sm text-gray-500 placeholder-gray-400 bg-transparent outline-none"
            />
          </div>
        )}

        {/* Expanded */}
        {(createOpen || createStatus !== "idle") && (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">新增 Task</h2>
              {createStatus === "idle" && (
                <button onClick={resetForm} className="text-gray-300 hover:text-gray-500 text-xl leading-none">×</button>
              )}
            </div>

            {/* Clarification question */}
            {createStatus === "clarifying" && clarifyQuestion && (
              <div className="space-y-3">
                <p className="text-sm text-gray-700 font-medium">{clarifyQuestion}</p>
                <textarea
                  value={clarifyAnswer}
                  onChange={(e) => setClarifyAnswer(e.target.value)}
                  placeholder="簡單說明即可…"
                  rows={3}
                  autoFocus
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
                <div className="flex gap-2">
                  <button onClick={() => runAnalysis()}
                    className="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">跳過</button>
                  <button onClick={() => runAnalysis(clarifyAnswer.trim() || undefined)} disabled={!clarifyAnswer.trim()}
                    className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                    繼續分析
                  </button>
                </div>
              </div>
            )}

            {/* Loading states */}
            {(createStatus === "analyzing" || (createStatus === "clarifying" && !clarifyQuestion) || createStatus === "saving") && (
              <div className="text-center py-8">
                <div className="text-3xl mb-3 animate-pulse">◎</div>
                <p className="text-xs text-gray-400">
                  {createStatus === "saving" ? "儲存中…" : "AI 分析中，通常需要 5–15 秒…"}
                </p>
              </div>
            )}

            {/* Confirm: analysis results */}
            {createStatus === "confirm" && analysis && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">分析結果</p>
                  </div>
                  <div className="flex flex-col items-center bg-indigo-50 rounded-xl px-3 py-2 shrink-0">
                    <span className="text-2xl font-bold text-indigo-600">{analysis.finalScore.toFixed(1)}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">綜合分</span>
                  </div>
                </div>

                {analysis.objectiveScores.map((os) => (
                  <div key={os.objectiveId} className="bg-gray-50 rounded-lg border border-gray-100 p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <h3 className="text-xs font-medium text-gray-700">{os.objectiveTitle}</h3>
                      <span className={`text-xs font-bold ${os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-500"}`}>
                        {os.overallScore.toFixed(1)}
                      </span>
                    </div>
                    <Markdown className="text-xs text-gray-500 mb-2">{os.reasoning}</Markdown>
                    <div className="space-y-1">
                      {os.keyResultScores.map((krs) => (
                        <div key={krs.keyResultId}>
                          <ScoreBar score={krs.score} label={krs.keyResultTitle} />
                          <Markdown className="text-xs text-gray-400 mt-0.5">{krs.reasoning}</Markdown>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {analysis.risks.length > 0 && (
                  <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    <span className="font-medium">風險：</span>{analysis.risks.join("；")}
                  </div>
                )}

                {suggestedLinks.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-600">連結至子目標</p>
                    {suggestedLinks.map((l) => (
                      <label key={l.krId} className="flex items-center gap-2.5 cursor-pointer">
                        <input type="checkbox" checked={selectedLinkIds.has(l.krId)} onChange={() => toggleLink(l.krId)} className="accent-indigo-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-700 truncate">{l.krTitle}</p>
                          <p className="text-xs text-gray-400 truncate">{l.objectiveTitle}</p>
                        </div>
                        <span className={`text-xs font-bold shrink-0 ${l.score >= 7 ? "text-indigo-600" : "text-amber-500"}`}>{l.score.toFixed(1)}</span>
                      </label>
                    ))}
                  </div>
                )}

                {errorMsg && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</div>}

                <div className="flex gap-2 pt-1">
                  <button onClick={resetForm} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                    ← 重新輸入
                  </button>
                  <button onClick={handleConfirm} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
                    確認並儲存
                  </button>
                </div>
              </div>
            )}

            {/* Input form */}
            {createStatus === "idle" && (
              <div className="space-y-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  placeholder="用一句話描述你的 Task"
                  autoFocus
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />

                <button type="button" onClick={() => setDetailsOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600">
                  <span className={`transition-transform ${detailsOpen ? "rotate-90" : ""}`}>›</span>
                  補充說明（選填）
                  {hasDetails && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
                </button>

                {detailsOpen && (
                  <div className="space-y-2 pl-3 border-l-2 border-gray-100">
                    <textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="為什麼要做？" rows={2}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                    <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="預期成效" rows={2}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="備註" rows={2}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                  </div>
                )}

                {errorMsg && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</div>}

                <button onClick={handleAnalyze} disabled={!title.trim()}
                  className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {isQuickMode ? "快速評估" : "完整分析"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Task list ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-700">
            Tasks{activeTasks.length > 0 ? ` ${activeTasks.length}` : ""}
          </span>
        </div>

        {/* Sub-filter */}
        <div className="flex gap-1 px-4 py-2 border-b border-gray-100">
          {(["active", "shelved", "deleted"] as const).map((f) => {
            const count = f === "active" ? activeTasks.length : f === "shelved" ? shelvedTasks.length : deletedTasks.length;
            return (
              <button key={f} onClick={() => setTaskFilter(f)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${taskFilter === f ? "bg-indigo-50 text-indigo-600 font-medium" : "text-gray-400 hover:text-gray-600"}`}>
                {f === "active" ? "進行中" : f === "shelved" ? "暫存" : "垃圾桶"}{count > 0 ? ` ${count}` : ""}
              </button>
            );
          })}
        </div>

        {/* Shelved */}
        {taskFilter === "shelved" && (
          shelvedTasks.length === 0
            ? <div className="px-4 py-8 text-center text-xs text-gray-400">沒有暫存的 Task</div>
            : <div className="divide-y divide-gray-50">
              {shelvedTasks.map((idea) => (
                <div key={idea.id} className="px-4 py-3 flex items-center gap-2">
                  <p className="text-sm text-gray-700 flex-1 truncate">{idea.title}</p>
                  {idea.taskStatus && <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_STYLE[idea.taskStatus]}`}>{TASK_STATUS_LABEL[idea.taskStatus]}</span>}
                  <button onClick={() => handleRestore(idea.id)} className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 shrink-0">還原</button>
                  <button onClick={() => handleSoftDelete(idea.id)} className="text-gray-300 hover:text-red-400 text-base leading-none px-1 shrink-0">×</button>
                </div>
              ))}
            </div>
        )}

        {/* Deleted */}
        {taskFilter === "deleted" && (
          deletedTasks.length === 0
            ? <div className="px-4 py-8 text-center text-xs text-gray-400">垃圾桶是空的</div>
            : <div className="divide-y divide-gray-50">
              {deletedTasks.map((idea) => (
                <div key={idea.id} className="px-4 py-3 flex items-center gap-2 opacity-60">
                  <p className="text-sm text-gray-500 flex-1 truncate line-through">{idea.title}</p>
                  <button onClick={() => handleRestore(idea.id)} className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 shrink-0">還原</button>
                  <button onClick={() => handlePermanentDelete(idea.id)} className="text-xs text-red-400 hover:text-red-600 shrink-0">永久刪除</button>
                </div>
              ))}
            </div>
        )}

        {/* Active */}
        {taskFilter === "active" && (
          sortedActiveTasks.length === 0
            ? <div className="px-4 py-8 text-center text-xs text-gray-400">還沒有 Task，在上方輸入開始</div>
            : <div className="divide-y divide-gray-50">
              {sortedActiveTasks.map((idea) => {
                const isExpanded = expandedIdeaId === idea.id;
                const isDone = idea.taskStatus === "done";
                const isMeasurePending = pendingMeasure === idea.id;
                const links = idea.linkedKRs ?? [];
                const isPicking = showObjPickerId === idea.id;
                const measureKRs = links.flatMap((link) => {
                  if (!link.krId) return [];
                  const obj = objectives.find((o) => o.id === link.objectiveId);
                  const kr = obj?.keyResults.find((k) => k.id === link.krId);
                  if (!kr || (kr.krType ?? "cumulative") !== "measurement") return [];
                  return [{ obj: obj!, kr }];
                });

                return (
                  <div key={idea.id} className={isDone ? "opacity-60" : ""}>
                    <div className="px-4 py-3 flex items-center gap-2">
                      <button onClick={() => setExpandedIdeaId(isExpanded ? null : idea.id)}
                        className="flex-1 text-left flex items-center gap-2 min-w-0">
                        <p className={`text-sm text-gray-800 flex-1 truncate ${isDone ? "line-through text-gray-400" : ""}`}>{idea.title}</p>
                        <span className="text-gray-300 text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
                      </button>
                      <div className="flex gap-1 shrink-0">
                        {(["todo", "in-progress", "done"] as TaskStatus[]).map((s) => (
                          <button key={s} onClick={(e) => { e.stopPropagation(); handleSetTaskStatus(idea.id, s); }}
                            className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap transition-colors ${idea.taskStatus === s ? TASK_STATUS_STYLE[s] + " font-medium" : "text-gray-300 hover:text-gray-500"}`}>
                            {TASK_STATUS_LABEL[s]}
                          </button>
                        ))}
                      </div>
                      {idea.needsReanalysis && (
                        <button onClick={() => handleReanalyze(idea)} disabled={reanalyzingIds.has(idea.id)}
                          className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-300 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap">
                          {reanalyzingIds.has(idea.id) ? "評估中…" : "重新評估"}
                        </button>
                      )}
                      <button onClick={() => handleShelve(idea.id)} className="shrink-0 text-gray-300 hover:text-amber-500 text-xs px-1" title="暫存">⊸</button>
                      <button onClick={() => handleSoftDelete(idea.id)} className="shrink-0 text-gray-300 hover:text-red-400 text-base leading-none px-1">×</button>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-3 bg-gray-50 border-t border-gray-100">

                        {/* Todos */}
                        {(() => {
                          const todos = idea.todos ?? [];
                          const doneCount = todos.filter((t) => t.done).length;
                          const allDone = todos.length > 0 && doneCount === todos.length;
                          const pct = todos.length > 0 ? Math.round((doneCount / todos.length) * 100) : 0;
                          return (
                            <div className="pt-3">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-medium text-gray-600">子任務</span>
                                {todos.length > 0 && (
                                  <>
                                    <span className="text-xs text-gray-400">{doneCount}/{todos.length}</span>
                                    <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${getProgressColor(pct)}`} style={{ width: `${pct}%` }} />
                                    </div>
                                    {allDone && idea.taskStatus !== "done" && (
                                      <button onClick={() => handleSetTaskStatus(idea.id, "done")}
                                        className="text-xs px-2 py-0.5 bg-green-600 text-white rounded-lg hover:bg-green-700 shrink-0">標記完成</button>
                                    )}
                                  </>
                                )}
                              </div>
                              <div className="space-y-0.5">
                                {todos.map((todo) => (
                                  <div key={todo.id} className="flex items-center gap-2 group rounded-md px-1 py-0.5 hover:bg-white">
                                    <button onClick={() => handleToggleTodo(idea.id, todo.id)}
                                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${todo.done ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-indigo-400"}`}>
                                      {todo.done && <span className="text-white text-[9px] leading-none">✓</span>}
                                    </button>
                                    <input ref={(el) => { todoInputRefs.current[todo.id] = el; }} type="text"
                                      defaultValue={todo.title}
                                      onBlur={(e) => handleUpdateTodoTitle(idea.id, todo.id, e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") { e.preventDefault(); handleAddTodoAfter(idea.id, todo.id); }
                                        if (e.key === "Backspace" && e.currentTarget.value === "") { e.preventDefault(); handleDeleteTodo(idea.id, todo.id); }
                                      }}
                                      className={`flex-1 text-xs bg-transparent border-none outline-none py-0.5 ${todo.done ? "line-through text-gray-400" : "text-gray-700"}`}
                                      placeholder="待辦事項" />
                                  </div>
                                ))}
                                <button onClick={() => handleAddTodoAfter(idea.id)}
                                  className="flex items-center gap-2 w-full px-1 py-0.5 text-xs text-gray-400 hover:text-gray-600 rounded-md hover:bg-white">
                                  <span className="w-4 h-4 shrink-0 flex items-center justify-center text-gray-300 text-base leading-none">+</span>
                                  新增待辦
                                </button>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Analysis */}
                        {idea.analysis && (() => {
                          const isAnalysisOpen = expandedAnalysisIds.has(idea.id);
                          return (
                            <div className="border-t border-gray-100 pt-3">
                              <button onClick={() => setExpandedAnalysisIds((prev) => {
                                const s = new Set(prev); isAnalysisOpen ? s.delete(idea.id) : s.add(idea.id); return s;
                              })} className="flex items-center gap-1.5 w-full text-left">
                                <span className="text-xs font-medium text-gray-600">任務分析</span>
                                <span className="text-gray-300 text-[10px]">{isAnalysisOpen ? "▲" : "▼"}</span>
                              </button>
                              {isAnalysisOpen && (
                                <div className="space-y-2 mt-2">
                                  {idea.analysis.objectiveScores.map((os) => (
                                    <div key={os.objectiveId}>
                                      <div className="flex justify-between items-center mb-0.5">
                                        <span className="text-xs text-gray-600 truncate flex-1 mr-2">{os.objectiveTitle}</span>
                                        <span className={`text-xs font-bold shrink-0 ${os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-500"}`}>
                                          {os.overallScore.toFixed(1)}
                                        </span>
                                      </div>
                                      <p className="text-xs text-gray-500">{os.reasoning}</p>
                                      <div className="space-y-0.5 pl-2 mt-1">
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
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* 指定子目標 */}
                        <div className="border-t border-gray-100 pt-3 space-y-1.5">
                          <LinkedObjsEditable links={links} objectives={objectives}
                            onRemove={(idx) => handleUpdateLinkedKRs(idea.id, links.filter((_, i) => i !== idx))} />
                          <button onClick={() => setShowObjPickerId(isPicking ? null : idea.id)}
                            className="text-xs text-indigo-500 hover:text-indigo-700">
                            {isPicking ? "完成指定" : "＋ 指定子目標"}
                          </button>
                          {isPicking && (
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                              {objectives.map((obj) => (
                                <div key={obj.id}>
                                  <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-100">{obj.title}</div>
                                  {obj.keyResults.map((kr) => {
                                    const alreadyLinked = links.some((l) => l.krId === kr.id);
                                    const typeIcon = (kr.krType ?? "cumulative") === "measurement" ? "📊" : kr.krType === "milestone" ? "✅" : "📈";
                                    return (
                                      <button key={kr.id}
                                        onClick={() => alreadyLinked
                                          ? handleUpdateLinkedKRs(idea.id, links.filter((l) => l.krId !== kr.id))
                                          : handleUpdateLinkedKRs(idea.id, [...links, { objectiveId: obj.id, krId: kr.id }])}
                                        className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 hover:bg-gray-50 border-b border-gray-50 ${alreadyLinked ? "text-indigo-600 bg-indigo-50" : "text-gray-700"}`}>
                                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[10px] ${alreadyLinked ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300"}`}>
                                          {alreadyLinked && "✓"}
                                        </span>
                                        <span className="flex-1 truncate">{kr.title}</span>
                                        <span className="text-gray-400 shrink-0">{typeIcon}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Measurement input */}
                        {isMeasurePending && measureKRs.length > 0 && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 space-y-2">
                            <p className="text-xs font-medium text-amber-700">完成前，請填入目前的數值：</p>
                            {measureKRs.map(({ kr }) => (
                              <div key={kr.id} className="flex items-center gap-2">
                                <label className="text-xs text-gray-600 flex-1 truncate">{kr.title}</label>
                                <input type="number"
                                  value={measureInputs[idea.id]?.[kr.id] ?? ""}
                                  onChange={(e) => setMeasureInputs((prev) => ({ ...prev, [idea.id]: { ...(prev[idea.id] ?? {}), [kr.id]: e.target.value } }))}
                                  placeholder={`目前 ${kr.metricName ?? "數值"}（${kr.unit ?? ""}）`}
                                  className="w-32 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                              </div>
                            ))}
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => confirmMeasurement(idea.id)}
                                className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">確認完成</button>
                              <button onClick={() => setPendingMeasure(null)}
                                className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50">取消</button>
                            </div>
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
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense>
      <TasksPageInner />
    </Suspense>
  );
}
