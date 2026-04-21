"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Idea, Objective, KeyResult, CheckIn, TodoItem, TaskStatus, IdeaStatus, IdeaAnalysis, IdeaKRLink } from "@/lib/types";
import { fetchIdeas, fetchObjectives, saveIdea, updateIdeaTaskStatus } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import ScoreBar from "@/components/ScoreBar";
import Markdown from "@/components/Markdown";

type ModalStatus = "idle" | "clarifying" | "analyzing" | "confirm" | "saving";
type DashTaskFilter = "all" | "todo" | "in-progress" | "done";

interface SuggestedLink {
  objectiveId: string; objectiveTitle: string;
  krId: string; krTitle: string; score: number;
}
interface KRTasksPopup {
  krId: string; krTitle: string; objTitle: string; objId: string;
}

function calcKRCompletion(kr: KeyResult): number | undefined {
  if (kr.krType === "milestone") return kr.currentValue && kr.currentValue >= 1 ? 100 : 0;
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

function getProgressColor(pct: number): string {
  if (pct >= 60) return "bg-indigo-300";
  if (pct >= 30) return "bg-indigo-200";
  return "bg-gray-200";
}

function getProgressTextColor(pct: number): string {
  if (pct >= 60) return "text-indigo-600";
  if (pct >= 30) return "text-indigo-400";
  return "text-gray-400";
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

const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: "待辦", "in-progress": "進行中", done: "完成" };
const TASK_STATUS_STYLE: Record<TaskStatus, string> = {
  todo: "bg-gray-100 text-gray-500",
  "in-progress": "bg-amber-50 text-amber-600",
  done: "bg-green-50 text-green-600",
};

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 7 ? "bg-indigo-50 text-indigo-600"
    : score >= 4 ? "bg-amber-50 text-amber-600"
    : "bg-gray-100 text-gray-500";
  return <span className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded shrink-0 ${cls}`}>{score.toFixed(1)}</span>;
}

export default function DashboardPage() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);

  // Section collapse
  const [objSectionOpen, setObjSectionOpen] = useState(true);
  const [taskSectionOpen, setTaskSectionOpen] = useState(true);

  // Sets for multi-expand
  const [expandedObjIds, setExpandedObjIds] = useState<Set<string>>(new Set());
  const [expandedDashTaskIds, setExpandedDashTaskIds] = useState<Set<string>>(new Set());
  const [dashTaskFilter, setDashTaskFilter] = useState<DashTaskFilter>("all");
  const dashTodoRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  function toggleObjExpand(id: string) {
    setExpandedObjIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function toggleTaskExpand(id: string) {
    setExpandedDashTaskIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  // ── Modal ────────────────────────────────────────────────────────────────

  const [modalOpen, setModalOpen] = useState(false);
  const [modalStatus, setModalStatus] = useState<ModalStatus>("idle");
  const [modalTitle, setModalTitle] = useState("");
  const [modalWhy, setModalWhy] = useState("");
  const [modalOutcome, setModalOutcome] = useState("");
  const [modalNotes, setModalNotes] = useState("");
  const [modalDetailsOpen, setModalDetailsOpen] = useState(false);
  const [modalAnalysis, setModalAnalysis] = useState<IdeaAnalysis | null>(null);
  const [modalSuggestedLinks, setModalSuggestedLinks] = useState<SuggestedLink[]>([]);
  const [modalSelectedLinkIds, setModalSelectedLinkIds] = useState<Set<string>>(new Set());
  const [modalErrorMsg, setModalErrorMsg] = useState("");
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");

  const hasDetails = modalWhy.trim() || modalOutcome.trim() || modalNotes.trim();
  const isQuickMode = !hasDetails;

  function openModal() {
    setModalOpen(true);
    setModalStatus("idle");
  }

  function closeModal() {
    setModalOpen(false);
    setModalStatus("idle");
    setModalTitle(""); setModalWhy(""); setModalOutcome(""); setModalNotes("");
    setModalDetailsOpen(false);
    setModalAnalysis(null);
    setModalSuggestedLinks([]); setModalSelectedLinkIds(new Set());
    setModalErrorMsg("");
    setClarifyQuestion(""); setClarifyAnswer("");
  }

  async function runModalAnalysis(extraNotes?: string) {
    setModalStatus("analyzing");
    setModalErrorMsg("");
    try {
      const combinedNotes = [modalNotes, extraNotes].filter(Boolean).join("\n");
      const result = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle: modalTitle, ideaWhy: modalWhy, ideaOutcome: modalOutcome,
        ideaNotes: combinedNotes, objectives,
        progressContext: buildProgressContext(objectives),
      });
      setModalAnalysis(result);
      const links: SuggestedLink[] = [];
      for (const os of result.objectiveScores) {
        for (const krs of os.keyResultScores) {
          if (krs.score >= 5) links.push({ objectiveId: os.objectiveId, objectiveTitle: os.objectiveTitle, krId: krs.keyResultId, krTitle: krs.keyResultTitle, score: krs.score });
        }
      }
      links.sort((a, b) => b.score - a.score);
      setModalSuggestedLinks(links);
      setModalSelectedLinkIds(new Set(links.filter((l) => l.score >= 7).map((l) => l.krId)));
      setModalStatus("confirm");
    } catch (e) {
      setModalErrorMsg(e instanceof Error ? e.message : "分析失敗");
      setModalStatus("idle");
    }
  }

  async function handleModalAnalyze() {
    if (!modalTitle.trim()) return;
    if (objectives.length === 0) { setModalErrorMsg("請先建立至少一個 OKR 目標"); return; }
    setModalErrorMsg("");
    if (isQuickMode) {
      setModalStatus("clarifying");
      try {
        const { shouldClarify, question } = await callAI<{ shouldClarify: boolean; question: string }>(
          "clarifyIdea", { ideaTitle: modalTitle, objectives }
        );
        if (shouldClarify && question) { setClarifyQuestion(question); setClarifyAnswer(""); return; }
      } catch { /* fall through */ }
    }
    await runModalAnalysis();
  }

  async function handleModalSave(ideaStatus: IdeaStatus | undefined, taskStatus: TaskStatus) {
    if (!modalAnalysis) return;
    setModalStatus("saving");

    const linkedKRs: IdeaKRLink[] = modalSuggestedLinks
      .filter((l) => modalSelectedLinkIds.has(l.krId))
      .map((l) => ({ objectiveId: l.objectiveId, krId: l.krId }));

    const descParts: string[] = [];
    if (modalWhy.trim()) descParts.push(`為什麼要做：${modalWhy}`);
    if (modalOutcome.trim()) descParts.push(`預期成效：${modalOutcome}`);
    if (modalNotes.trim()) descParts.push(`備註：${modalNotes}`);

    const newIdea: Idea = {
      id: uuid(), title: modalTitle,
      description: descParts.join("\n"),
      analysis: modalAnalysis, createdAt: new Date().toISOString(),
      completed: false, linkedKRs, taskStatus,
      ideaStatus: ideaStatus ?? "active",
      quickAnalysis: isQuickMode,
    };

    try {
      await saveIdea(newIdea);
      setIdeas((prev) => [newIdea, ...prev]);
      closeModal();
      if (ideaStatus === "deleted") router.push("/tasks?filter=deleted");
      else if (ideaStatus === "shelved") router.push("/tasks?filter=shelved");
    } catch (e) {
      setModalErrorMsg(e instanceof Error ? e.message : "儲存失敗");
      setModalStatus("confirm");
    }
  }

  // ── KR Tasks Popup ───────────────────────────────────────────────────────

  const [krTasksPopup, setKrTasksPopup] = useState<KRTasksPopup | null>(null);

  // ── Dashboard task handlers ──────────────────────────────────────────────

  function handleDashSetTaskStatus(taskId: string, status: TaskStatus) {
    updateIdeaTaskStatus(taskId, status).catch(console.error);
    setIdeas((prev) => prev.map((i) => i.id === taskId ? { ...i, taskStatus: status } : i));
  }

  function handleDashToggleTodo(ideaId: string, todoId: string) {
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

  function handleDashAddTodo(ideaId: string, afterTodoId?: string) {
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
    setTimeout(() => dashTodoRefs.current[todo.id]?.focus(), 30);
  }

  function handleDashUpdateTodoTitle(ideaId: string, todoId: string, newTitle: string) {
    setIdeas((prev) => prev.map((i) => {
      if (i.id !== ideaId) return i;
      const todos = (i.todos ?? []).map((t) => t.id === todoId ? { ...t, title: newTitle } : t);
      const updated = { ...i, todos };
      saveIdea(updated).catch(console.error);
      return updated;
    }));
  }

  function handleDashDeleteTodo(ideaId: string, todoId: string) {
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
    if (prevId) setTimeout(() => dashTodoRefs.current[prevId]?.focus(), 30);
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const allKRs = objectives.flatMap((o) =>
    o.keyResults.map((kr) => ({ ...kr, objectiveTitle: o.title, objectiveId: o.id }))
  );
  const oCompletions = objectives.map(calcOCompletion).filter((v): v is number => v !== undefined);
  const avgOCompletion = oCompletions.length > 0
    ? Math.round(oCompletions.reduce((a, b) => a + b, 0) / oCompletions.length) : null;

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

  const filteredTasks = [...activeTasks]
    .filter((i) => dashTaskFilter === "all" || i.taskStatus === dashTaskFilter)
    .sort((a, b) => {
      const aDone = a.taskStatus === "done" ? 1 : 0, bDone = b.taskStatus === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      const aIP = a.taskStatus === "in-progress" ? 0 : 1, bIP = b.taskStatus === "in-progress" ? 0 : 1;
      if (aIP !== bIP) return aIP - bIP;
      return (b.analysis?.finalScore ?? -1) - (a.analysis?.finalScore ?? -1);
    });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">

      {/* ── Analysis Modal ──────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget && modalStatus === "idle") closeModal(); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">新增 Task</h2>
                {(modalStatus === "idle" || modalStatus === "confirm") && (
                  <button onClick={closeModal} className="text-gray-300 hover:text-gray-500 text-xl leading-none">×</button>
                )}
              </div>

              {(modalStatus === "analyzing" || modalStatus === "saving" || (modalStatus === "clarifying" && !clarifyQuestion)) && (
                <div className="text-center py-10">
                  <div className="text-3xl mb-3 animate-pulse">◎</div>
                  <p className="text-xs text-gray-400">{modalStatus === "saving" ? "儲存中…" : "AI 分析中，通常需要 5–15 秒…"}</p>
                </div>
              )}

              {modalStatus === "clarifying" && clarifyQuestion && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700 font-medium">{clarifyQuestion}</p>
                  <textarea value={clarifyAnswer} onChange={(e) => setClarifyAnswer(e.target.value)}
                    placeholder="簡單說明即可…" rows={3} autoFocus
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                  <div className="flex gap-2">
                    <button onClick={() => runModalAnalysis()} className="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">跳過</button>
                    <button onClick={() => runModalAnalysis(clarifyAnswer.trim() || undefined)} disabled={!clarifyAnswer.trim()}
                      className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">繼續分析</button>
                  </div>
                </div>
              )}

              {modalStatus === "idle" && (
                <div className="space-y-3">
                  <input value={modalTitle} onChange={(e) => setModalTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleModalAnalyze()}
                    placeholder="用一句話描述你的 Task" autoFocus
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <button type="button" onClick={() => setModalDetailsOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600">
                    <span className={`transition-transform ${modalDetailsOpen ? "rotate-90" : ""}`}>›</span>
                    補充說明（選填）
                    {hasDetails && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
                  </button>
                  {modalDetailsOpen && (
                    <div className="space-y-2 pl-3 border-l-2 border-gray-100">
                      <textarea value={modalWhy} onChange={(e) => setModalWhy(e.target.value)} placeholder="為什麼要做？" rows={2}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                      <textarea value={modalOutcome} onChange={(e) => setModalOutcome(e.target.value)} placeholder="預期成效" rows={2}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                      <textarea value={modalNotes} onChange={(e) => setModalNotes(e.target.value)} placeholder="備註" rows={2}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                    </div>
                  )}
                  {modalErrorMsg && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{modalErrorMsg}</div>}
                  <button onClick={handleModalAnalyze} disabled={!modalTitle.trim()}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {isQuickMode ? "快速評估" : "完整分析"}
                  </button>
                </div>
              )}

              {modalStatus === "confirm" && modalAnalysis && (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{modalTitle}</p>
                      <p className="text-xs text-gray-400 mt-0.5">分析結果</p>
                    </div>
                    <div className="flex flex-col items-center bg-indigo-50 rounded-xl px-3 py-2 shrink-0">
                      <span className="text-2xl font-bold font-mono text-indigo-600">{modalAnalysis.finalScore.toFixed(1)}</span>
                      <span className="text-[10px] text-gray-400 mt-0.5">綜合分</span>
                    </div>
                  </div>
                  {modalAnalysis.objectiveScores.map((os) => (
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
                  {modalAnalysis.risks.length > 0 && (
                    <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                      <span className="font-medium">風險：</span>{modalAnalysis.risks.join("；")}
                    </div>
                  )}
                  {modalSuggestedLinks.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-600">連結至子目標</p>
                      {modalSuggestedLinks.map((l) => (
                        <label key={l.krId} className="flex items-center gap-2.5 cursor-pointer">
                          <input type="checkbox" checked={modalSelectedLinkIds.has(l.krId)} onChange={() => {
                            setModalSelectedLinkIds((prev) => { const s = new Set(prev); s.has(l.krId) ? s.delete(l.krId) : s.add(l.krId); return s; });
                          }} className="accent-indigo-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-700 truncate">{l.krTitle}</p>
                            <p className="text-xs text-gray-400 truncate">{l.objectiveTitle}</p>
                          </div>
                          <span className={`text-xs font-bold shrink-0 ${l.score >= 7 ? "text-indigo-600" : "text-amber-500"}`}>{l.score.toFixed(1)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {modalErrorMsg && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{modalErrorMsg}</div>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => handleModalSave("deleted", "todo")}
                      className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">放棄</button>
                    <button onClick={() => handleModalSave("shelved", "todo")}
                      className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-amber-50 hover:border-amber-200">暫存</button>
                    <button onClick={() => handleModalSave(undefined, "in-progress")}
                      className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">執行</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── KR Tasks Popup (game quest window) ──────────────────────────────── */}
      {krTasksPopup && (() => {
        const kr = objectives.find((o) => o.id === krTasksPopup.objId)?.keyResults.find((k) => k.id === krTasksPopup.krId);
        const krCompletion = kr ? calcKRCompletion(kr) : undefined;
        const relatedTasks = ideas.filter((i) =>
          (i.ideaStatus ?? "active") === "active" &&
          (i.linkedKRs ?? []).some((l) => l.krId === krTasksPopup.krId)
        );
        const doneCount = relatedTasks.filter((t) => t.taskStatus === "done").length;
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setKrTasksPopup(null); }}>
            <div className="bg-white rounded-xl w-full max-w-sm shadow-lg overflow-hidden border border-gray-200">

              {/* Header */}
              <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-400 mb-0.5">{krTasksPopup.objTitle}</p>
                    <p className="text-sm font-semibold text-gray-800 leading-snug">{krTasksPopup.krTitle}</p>
                  </div>
                  <button onClick={() => setKrTasksPopup(null)} className="text-gray-300 hover:text-gray-500 text-lg leading-none shrink-0 mt-0.5">×</button>
                </div>
                {krCompletion !== undefined && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{doneCount}/{relatedTasks.length} 任務完成</span>
                      <span className={`text-xs font-medium font-mono ${getProgressTextColor(krCompletion)}`}>{krCompletion}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${getProgressColor(krCompletion)}`} style={{ width: `${krCompletion}%`, minWidth: "3px" }} />
                    </div>
                    {kr && kr.targetValue && (
                      <p className="text-[10px] text-gray-400 text-right font-mono">
                        {kr.currentValue ?? 0}{kr.unit ? ` ${kr.unit}` : ""} / {kr.targetValue}{kr.unit ? ` ${kr.unit}` : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Task list */}
              <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
                {relatedTasks.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-gray-400 text-center">尚無相關任務</p>
                ) : (
                  relatedTasks.map((task) => (
                    <div key={task.id} className="px-4 py-2.5 flex items-center gap-2.5">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        task.taskStatus === "done" ? "bg-indigo-300" :
                        task.taskStatus === "in-progress" ? "bg-amber-300" : "bg-gray-300"
                      }`} />
                      <p className={`text-xs flex-1 min-w-0 truncate ${task.taskStatus === "done" ? "line-through text-gray-400" : "text-gray-700"}`}>
                        {task.title}
                      </p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                        task.taskStatus === "done" ? "bg-gray-50 text-gray-400" :
                        task.taskStatus === "in-progress" ? "bg-amber-50 text-amber-500" :
                        "bg-gray-50 text-gray-400"
                      }`}>
                        {task.taskStatus ? TASK_STATUS_LABEL[task.taskStatus] : "待辦"}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-2.5 border-t border-gray-100">
                <Link href={`/tasks?objectiveId=${krTasksPopup.objId}&krId=${krTasksPopup.krId}`}
                  onClick={() => setKrTasksPopup(null)}
                  className="text-xs text-indigo-500 hover:text-indigo-700">
                  ＋ 新增任務
                </Link>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-end gap-1.5">
            <span className="text-2xl font-bold font-mono text-indigo-600">{objectives.length}</span>
            {avgOCompletion !== null && <span className="text-sm font-mono text-gray-400 mb-0.5">{avgOCompletion}%</span>}
          </div>
          <div className="text-xs text-gray-500 mt-1">目標 (O)</div>
          {avgOCompletion !== null && (
            <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${avgOCompletion}%`, minWidth: "3px" }} />
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold font-mono text-indigo-600">{activeTasks.length}</div>
          <div className="text-xs text-gray-500 mt-1">Tasks</div>
          <div className="mt-1 text-xs space-x-1">
            {activeTasks.filter(t => t.taskStatus === "in-progress").length > 0 && (
              <span className="text-amber-500 font-mono">{activeTasks.filter(t => t.taskStatus === "in-progress").length} 進行中</span>
            )}
            {activeTasks.filter(t => t.taskStatus === "done").length > 0 && (
              <span className="text-green-500 font-mono">{activeTasks.filter(t => t.taskStatus === "done").length} 完成</span>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold font-mono text-indigo-600">{doneTasks.length}</div>
          <div className="text-xs text-gray-500 mt-1">已完成</div>
          {staleKRs.length > 0 && <div className="mt-1 text-xs text-amber-500">{staleKRs.length} 子目標待更新</div>}
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
              const daysOld = last ? Math.round((today.getTime() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24)) : null;
              return (
                <div key={kr.id} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{kr.title}</p>
                    <p className="text-xs text-gray-400 truncate">{kr.objectiveTitle}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 font-mono">{daysOld !== null ? `${daysOld}天前` : "從未更新"}</span>
                </div>
              );
            })}
            {staleKRs.length > 5 && (
              <Link href="/okr" className="text-xs text-indigo-500 hover:text-indigo-700 block mt-1">查看全部 {staleKRs.length} 條 →</Link>
            )}
          </div>
        </div>
      )}

      {/* ── OKR Progress ────────────────────────────────────────────────────── */}
      {objectives.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <button onClick={() => setObjSectionOpen((v) => !v)}
              className="flex items-center gap-2 flex-1 text-left">
              <h2 className="text-sm font-semibold text-gray-700">目標進度</h2>
              <span className="text-gray-300 text-xs">{objSectionOpen ? "▲" : "▼"}</span>
            </button>
            <Link href="/okr" className="text-xs text-indigo-500 hover:text-indigo-700">管理 →</Link>
          </div>
          {objSectionOpen && <div className="divide-y divide-gray-50">
            {objectives.map((o) => {
              const completion = calcOCompletion(o);
              const isExpanded = expandedObjIds.has(o.id);
              const linkedTaskCount = ideas.filter((t) => t.linkedKRs?.some((l) => l.objectiveId === o.id)).length;
              return (
                <div key={o.id}>
                  <button onClick={() => toggleObjExpand(o.id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-gray-800 truncate flex-1 mr-3 font-medium">{o.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {linkedTaskCount > 0 && <span className="text-xs text-indigo-400 font-mono">{linkedTaskCount} task</span>}
                        {completion !== undefined && (
                          <span className={`text-xs font-medium font-mono ${getProgressTextColor(completion)}`}>{completion}%</span>
                        )}
                        <span className="text-gray-300 text-xs">{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {completion !== undefined ? (
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${getProgressColor(completion)}`} style={{ width: `${completion}%`, minWidth: "3px" }} />
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">尚無可追蹤的子目標</p>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-3 pt-1 space-y-3 bg-gray-50/60">
                      {o.keyResults.map((kr) => {
                        const krCompletion = calcKRCompletion(kr);
                        const krType = kr.krType ?? "cumulative";
                        return (
                          <div key={kr.id} className="pl-2 space-y-1.5">
                            {/* Title row */}
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                              <p className="text-xs text-gray-700 flex-1 truncate min-w-0">{kr.title}</p>
                              {krType === "milestone" ? (
                                <span className={`text-xs font-medium shrink-0 ${kr.currentValue && kr.currentValue >= 1 ? "text-green-600" : "text-gray-400"}`}>
                                  {kr.currentValue && kr.currentValue >= 1 ? "已達成" : "未達成"}
                                </span>
                              ) : krCompletion !== undefined && (
                                <span className={`text-xs font-medium font-mono shrink-0 ${getProgressTextColor(krCompletion)}`}>
                                  {krCompletion}%
                                </span>
                              )}
                              <button
                                onClick={() => setKrTasksPopup({ krId: kr.id, krTitle: kr.title, objTitle: o.title, objId: o.id })}
                                className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 shrink-0"
                              >
                                Tasks
                              </button>
                            </div>
                            {/* Progress bar */}
                            <div className="pl-3.5">
                              {krType === "milestone" ? (
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${kr.currentValue && kr.currentValue >= 1 ? "bg-green-400" : "bg-gray-200"}`}
                                    style={{ width: kr.currentValue && kr.currentValue >= 1 ? "100%" : "0%" }} />
                                </div>
                              ) : krCompletion !== undefined ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${getProgressColor(krCompletion)}`} style={{ width: `${krCompletion}%`, minWidth: "3px" }} />
                                  </div>
                                  <span className="text-xs text-gray-400 shrink-0 font-mono">
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
          </div>}
        </div>
      )}

      {/* ── Tasks ────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button onClick={() => setTaskSectionOpen((v) => !v)}
            className="flex items-center gap-2 flex-1 text-left">
            <h2 className="text-sm font-semibold text-gray-700">任務清單</h2>
            <span className="text-gray-300 text-xs">{taskSectionOpen ? "▲" : "▼"}</span>
          </button>
          <Link href="/tasks" className="text-xs text-indigo-500 hover:text-indigo-700">管理 →</Link>
        </div>

        {taskSectionOpen && <>
        {/* Quick-add */}
        <div onClick={openModal} className="px-4 py-3 border-b border-gray-100 cursor-text hover:bg-gray-50 transition-colors">
          <span className="text-sm text-gray-400">+ 新增任務…</span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-gray-100">
          {(["all", "todo", "in-progress", "done"] as const).map((f) => {
            const label = f === "all" ? "全部" : TASK_STATUS_LABEL[f];
            const count = f === "all" ? activeTasks.length : activeTasks.filter((i) => i.taskStatus === f).length;
            return (
              <button key={f} onClick={() => setDashTaskFilter(f)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${dashTaskFilter === f ? "bg-indigo-50 text-indigo-600 font-medium" : "text-gray-400 hover:text-gray-600"}`}>
                {label}{count > 0 ? ` ${count}` : ""}
              </button>
            );
          })}
        </div>

        {filteredTasks.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            {dashTaskFilter === "all" ? "還沒有 Task，點上方開始新增" : `沒有${TASK_STATUS_LABEL[dashTaskFilter as TaskStatus]}的任務`}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filteredTasks.map((idea) => {
              const isExpanded = expandedDashTaskIds.has(idea.id);
              const isDone = idea.taskStatus === "done";
              const todos = idea.todos ?? [];
              const doneTodoCount = todos.filter((t) => t.done).length;
              const todoPct = todos.length > 0 ? Math.round((doneTodoCount / todos.length) * 100) : 0;
              return (
                <div key={idea.id} className={isDone ? "opacity-60" : ""}>
                  <div className="px-4 py-3 flex items-center gap-2">
                    <button onClick={() => toggleTaskExpand(idea.id)}
                      className="flex-1 text-left flex items-center gap-2 min-w-0">
                      <p className={`text-sm text-gray-800 flex-1 truncate ${isDone ? "line-through text-gray-400" : ""}`}>{idea.title}</p>
                      {todos.length > 0 && <span className="text-xs text-gray-400 font-mono shrink-0">{doneTodoCount}/{todos.length}</span>}
                      <span className="text-gray-300 text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
                    </button>
                    <div className="flex gap-1 shrink-0">
                      {(["todo", "in-progress", "done"] as TaskStatus[]).map((s) => (
                        <button key={s} onClick={(e) => { e.stopPropagation(); handleDashSetTaskStatus(idea.id, s); }}
                          className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap transition-colors ${idea.taskStatus === s ? TASK_STATUS_STYLE[s] + " font-medium" : "text-gray-300 hover:text-gray-500"}`}>
                          {TASK_STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                    {idea.analysis?.finalScore != null && <ScoreBadge score={idea.analysis.finalScore} />}
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100 space-y-2 pt-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-600">子任務</span>
                        {todos.length > 0 && (
                          <>
                            <span className="text-xs text-gray-400 font-mono">{doneTodoCount}/{todos.length}</span>
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${getProgressColor(todoPct)}`} style={{ width: `${todoPct}%` }} />
                            </div>
                          </>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {todos.map((todo) => (
                          <div key={todo.id} className="flex items-center gap-2 group rounded-md px-1 py-0.5 hover:bg-white">
                            <button onClick={() => handleDashToggleTodo(idea.id, todo.id)}
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${todo.done ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-indigo-400"}`}>
                              {todo.done && <span className="text-white text-[9px] leading-none">✓</span>}
                            </button>
                            <input ref={(el) => { dashTodoRefs.current[todo.id] = el; }} type="text"
                              defaultValue={todo.title}
                              onBlur={(e) => handleDashUpdateTodoTitle(idea.id, todo.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); handleDashAddTodo(idea.id, todo.id); }
                                if (e.key === "Backspace" && e.currentTarget.value === "") { e.preventDefault(); handleDashDeleteTodo(idea.id, todo.id); }
                              }}
                              className={`flex-1 text-xs bg-transparent border-none outline-none py-0.5 ${todo.done ? "line-through text-gray-400" : "text-gray-700"}`}
                              placeholder="待辦事項" />
                          </div>
                        ))}
                        <button onClick={() => handleDashAddTodo(idea.id)}
                          className="flex items-center gap-2 w-full px-1 py-0.5 text-xs text-gray-400 hover:text-gray-600 rounded-md hover:bg-white">
                          <span className="w-4 h-4 shrink-0 flex items-center justify-center text-gray-300 text-base leading-none">+</span>
                          新增待辦
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>}
      </div>

    </div>
  );
}
