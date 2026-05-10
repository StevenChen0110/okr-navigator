"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import {
  Idea, Objective, KeyResult, TaskStatus, IdeaStatus,
  IdeaKRLink, IdeaAnalysis, TodoItem, TaskTimeframe,
} from "@/lib/types";
import {
  fetchIdeas, fetchObjectives, removeIdea, saveIdea,
  saveObjective, updateIdeaTaskStatus, updateIdeaStatus,
} from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import ScoreBar from "@/components/ScoreBar";
import { useLanguage } from "@/components/LanguageProvider";
import { getChatHistory, saveChatHistory } from "@/lib/storage";
import { useAuth } from "@/components/AuthProvider";

interface UIMessage {
  role: "user" | "assistant";
  content: string;
  isLoading?: boolean;
}

interface SuggestedLink {
  objectiveId: string;
  objectiveTitle: string;
  krId: string;
  krTitle: string;
  score: number;
}

type MeasurementInputs = Record<string, Record<string, string>>;

function sanitize(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}([\s\S]*?)`{1,3}/g, "$1")
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .trim();
}

function formatAnalysisAsMessage(analysis: IdeaAnalysis, language: "zh-TW" | "en"): string {
  const sorted = [...analysis.objectiveScores].sort((a, b) => b.overallScore - a.overallScore);
  const top3 = sorted.slice(0, 3).map((os) => `${os.objectiveTitle}：${os.overallScore.toFixed(1)} 分`).join("、");
  let msg = language === "zh-TW"
    ? `分析完成，綜合分數 ${analysis.finalScore.toFixed(1)}/10。${analysis.summary}`
    : `Analysis complete. Score: ${analysis.finalScore.toFixed(1)}/10. ${analysis.summary}`;
  if (top3) msg += language === "zh-TW" ? `\n\n與目標關聯：${top3}。` : `\n\nGoal relevance: ${top3}.`;
  if (analysis.risks.length > 0) msg += language === "zh-TW" ? `\n\n需注意的風險：${analysis.risks.join("；")}。` : `\n\nRisks: ${analysis.risks.join("; ")}.`;
  if (analysis.executionSuggestions.length > 0) msg += language === "zh-TW" ? `\n\n執行建議：${analysis.executionSuggestions.join("；")}。` : `\n\nSuggestions: ${analysis.executionSuggestions.join("; ")}.`;
  return msg;
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

const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: "待辦", "in-progress": "進行中", done: "完成" };
const TASK_STATUS_STYLE: Record<TaskStatus, string> = {
  todo: "bg-gray-100 text-gray-500",
  "in-progress": "bg-amber-50 text-amber-600",
  done: "bg-green-50 text-green-600",
};

const TIMEFRAME_LABELS: Record<TaskTimeframe, { zh: string; en: string }> = {
  daily: { zh: "今日", en: "Today" },
  weekly: { zh: "本週", en: "This week" },
  monthly: { zh: "本月", en: "This month" },
  custom: { zh: "自定", en: "Custom" },
};

function getTimeframeLabel(tf: TaskTimeframe | undefined, customLabel: string | undefined, language: "zh-TW" | "en"): string {
  if (!tf) return "";
  if (tf === "custom" && customLabel) return customLabel;
  return language === "zh-TW" ? TIMEFRAME_LABELS[tf].zh : TIMEFRAME_LABELS[tf].en;
}

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
              <span className="text-xs text-gray-600 flex-1 truncate">{kr ? `↳ ${kr.title}` : "（整體目標）"}</span>
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
  const { language } = useLanguage();
  const { user } = useAuth();

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  // ── Timeframe filter ──────────────────────────────────────────────────────────
  const [activeTimeframe, setActiveTimeframe] = useState<"all" | TaskTimeframe>("all");
  const [taskFilter, setTaskFilter] = useState<"active" | "shelved" | "deleted">("active");

  // ── Workspace state ───────────────────────────────────────────────────────────
  type WorkspaceMode = "empty" | "draft" | "task";
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("empty");
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [workspaceMessages, setWorkspaceMessages] = useState<UIMessage[]>([]);
  const [workspaceChatInput, setWorkspaceChatInput] = useState("");
  const [workspaceChatLoading, setWorkspaceChatLoading] = useState(false);
  const workspaceEndRef = useRef<HTMLDivElement>(null);

  // ── Draft task state ──────────────────────────────────────────────────────────
  const [draftTitle, setDraftTitle] = useState(() => searchParams.get("title") ?? "");
  const [draftTimeframe, setDraftTimeframe] = useState<TaskTimeframe>("daily");
  const [draftCustomLabel, setDraftCustomLabel] = useState("");
  const [draftAnalyzing, setDraftAnalyzing] = useState(false);
  const [draftAnalysis, setDraftAnalysis] = useState<IdeaAnalysis | null>(null);
  const [draftSuggestedLinks, setDraftSuggestedLinks] = useState<SuggestedLink[]>([]);
  const [draftSelectedLinks, setDraftSelectedLinks] = useState<Set<string>>(new Set());
  const [draftSaving, setDraftSaving] = useState(false);

  // ── Mobile tabs ───────────────────────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<"list" | "workspace">("list");

  // ── Task detail expansion ─────────────────────────────────────────────────────
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedAnalysisIds, setExpandedAnalysisIds] = useState<Set<string>>(new Set());
  const [showObjPickerId, setShowObjPickerId] = useState<string | null>(null);
  const [pendingMeasure, setPendingMeasure] = useState<string | null>(null);
  const [measureInputs, setMeasureInputs] = useState<MeasurementInputs>({});
  const [reanalyzingIds, setReanalyzingIds] = useState<Set<string>>(new Set());
  const todoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Scroll workspace to bottom on new messages
  useEffect(() => {
    workspaceEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [workspaceMessages]);

  // Save workspace chat when messages change (task mode only)
  useEffect(() => {
    if (workspaceMode !== "task" || !focusedTaskId || workspaceMessages.length === 0) return;
    saveChatHistory(`task_${focusedTaskId}`, workspaceMessages.filter((m) => !m.isLoading).map((m) => ({ role: m.role, content: m.content })));
  }, [workspaceMessages, workspaceMode, focusedTaskId]);

  // ── Draft task flow ───────────────────────────────────────────────────────────

  async function handleStartDraft() {
    if (!draftTitle.trim() || draftAnalyzing) return;
    if (objectives.length === 0) return;
    setDraftAnalyzing(true);
    setDraftAnalysis(null);
    setDraftSuggestedLinks([]);
    setDraftSelectedLinks(new Set());
    setWorkspaceMode("draft");
    setFocusedTaskId(null);
    setWorkspaceMessages([{ role: "assistant", content: "", isLoading: true }]);
    setMobileTab("workspace");
    try {
      const analysis = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle: draftTitle.trim(),
        ideaNotes: "",
        objectives,
      });
      const formattedMsg = formatAnalysisAsMessage(analysis, language);
      setDraftAnalysis(analysis);
      const links: SuggestedLink[] = [];
      for (const os of analysis.objectiveScores) {
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
      setDraftSuggestedLinks(links);
      setDraftSelectedLinks(new Set(links.filter((l) => l.score >= 7).map((l) => l.krId)));
      setWorkspaceMessages([{ role: "assistant", content: formattedMsg }]);
    } catch {
      setWorkspaceMessages([{ role: "assistant", content: language === "zh-TW" ? "分析失敗，請再試一次。" : "Analysis failed. Please try again." }]);
    } finally {
      setDraftAnalyzing(false);
    }
  }

  async function handleConfirmDraft() {
    if (!draftAnalysis || draftSaving) return;
    setDraftSaving(true);
    const linkedKRs: IdeaKRLink[] = draftSuggestedLinks
      .filter((l) => draftSelectedLinks.has(l.krId))
      .map((l) => ({ objectiveId: l.objectiveId, krId: l.krId }));
    const newIdea: Idea = {
      id: uuid(),
      title: draftTitle.trim(),
      description: "",
      analysis: draftAnalysis,
      createdAt: new Date().toISOString(),
      completed: false,
      linkedKRs,
      taskStatus: "todo",
      taskTimeframe: draftTimeframe,
      taskTimeframeCustomLabel: draftTimeframe === "custom" ? draftCustomLabel : undefined,
    };
    try {
      await saveIdea(newIdea);
      setIdeas((prev) => [newIdea, ...prev]);
      const toSave = workspaceMessages.filter((m) => !m.isLoading).map((m) => ({ role: m.role, content: m.content }));
      saveChatHistory(`task_${newIdea.id}`, toSave);
      setDraftTitle("");
      setDraftAnalysis(null);
      setDraftSuggestedLinks([]);
      setDraftSelectedLinks(new Set());
      setWorkspaceMode("task");
      setFocusedTaskId(newIdea.id);
      setWorkspaceMessages((prev) => [
        ...prev.filter((m) => !m.isLoading),
        { role: "assistant", content: language === "zh-TW" ? "任務已儲存！有什麼想繼續討論的都可以說。" : "Task saved! Feel free to continue the discussion." },
      ]);
    } catch {
      // silent
    } finally {
      setDraftSaving(false);
    }
  }

  function handleFocusTask(task: Idea) {
    if (focusedTaskId === task.id && workspaceMode === "task") return;
    setFocusedTaskId(task.id);
    setWorkspaceMode("task");
    setDraftTitle("");
    setDraftAnalysis(null);
    const stored = getChatHistory(`task_${task.id}`);
    if (stored.length > 0) {
      setWorkspaceMessages(stored.map((m) => ({ role: m.role, content: m.content })));
    } else if (task.analysis) {
      setWorkspaceMessages([{ role: "assistant", content: formatAnalysisAsMessage(task.analysis, language) }]);
    } else {
      setWorkspaceMessages([]);
    }
    setMobileTab("workspace");
  }

  // ── Workspace chat ────────────────────────────────────────────────────────────

  async function sendWorkspaceChat(text: string) {
    if (!text.trim() || workspaceChatLoading || workspaceMode === "empty") return;
    const focusedTask = focusedTaskId ? ideas.find((i) => i.id === focusedTaskId) : null;
    const taskCtx = workspaceMode === "draft"
      ? { title: draftTitle, timeframe: getTimeframeLabel(draftTimeframe, draftCustomLabel, language), analysis: draftAnalysis }
      : focusedTask
        ? { title: focusedTask.title, timeframe: getTimeframeLabel(focusedTask.taskTimeframe, focusedTask.taskTimeframeCustomLabel, language), analysis: focusedTask.analysis }
        : null;
    if (!taskCtx) return;
    const userMsg: UIMessage = { role: "user", content: text };
    const history = workspaceMessages.filter((m) => !m.isLoading);
    const newHistory = [...history, userMsg];
    setWorkspaceMessages([...newHistory, { role: "assistant", content: "", isLoading: true }]);
    setWorkspaceChatLoading(true);
    try {
      const result = await callAI<{ content: string }>("chatTask", {
        messages: newHistory.map((m) => ({ role: m.role, content: m.content })),
        task: taskCtx,
        objectives,
      });
      const newMessages: UIMessage[] = [...newHistory, { role: "assistant", content: sanitize(result.content) }];
      setWorkspaceMessages(newMessages);
    } catch {
      setWorkspaceMessages([...newHistory, { role: "assistant" as const, content: language === "zh-TW" ? "發生錯誤，請再試一次。" : "An error occurred." }]);
    } finally {
      setWorkspaceChatLoading(false);
    }
  }

  function handleWorkspaceSend() {
    const text = workspaceChatInput.trim();
    if (!text || workspaceChatLoading) return;
    setWorkspaceChatInput("");
    sendWorkspaceChat(text);
  }

  // ── Task list operations ──────────────────────────────────────────────────────

  function setIdeaStatus(id: string, status: IdeaStatus) {
    updateIdeaStatus(id, status).catch(console.error);
    setIdeas((prev) => prev.map((i) => i.id === id ? { ...i, ideaStatus: status } : i));
  }

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
        ideaTitle: idea.title, ideaNotes: idea.description ?? "", objectives,
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
          newValue = ideas.filter((i) =>
            i.id !== task.id && (i.ideaStatus ?? "active") !== "deleted" &&
            i.taskStatus === "done" && (i.linkedKRs ?? []).some((l) => l.krId === link.krId)
          ).length;
        } else if (krType === "milestone") {
          newValue = 0;
        }
        if (newValue !== undefined)
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
        const doneCount = ideas.filter((i) =>
          i.id !== taskId && (i.ideaStatus ?? "active") !== "deleted" &&
          i.taskStatus === "done" && (i.linkedKRs ?? []).some((l) => l.krId === kr.id)
        ).length + 1;
        newValue = kr.targetValue ? Math.min(kr.targetValue, doneCount) : doneCount;
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

  // ── Derived ────────────────────────────────────────────────────────────────────

  const activeTasks = ideas.filter((i) => (i.ideaStatus ?? "active") === "active");
  const shelvedTasks = ideas.filter((i) => i.ideaStatus === "shelved");
  const deletedTasks = ideas.filter((i) => i.ideaStatus === "deleted");

  const filteredActive = activeTimeframe === "all"
    ? activeTasks
    : activeTasks.filter((i) => i.taskTimeframe === activeTimeframe);

  const sortedActive = [...filteredActive].sort((a, b) => {
    const aDone = a.taskStatus === "done" ? 1 : 0;
    const bDone = b.taskStatus === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (b.analysis?.finalScore ?? -1) - (a.analysis?.finalScore ?? -1);
  });

  const focusedTask = focusedTaskId ? ideas.find((i) => i.id === focusedTaskId) ?? null : null;

  const workspaceTitle = workspaceMode === "draft" && draftTitle
    ? draftTitle
    : focusedTask?.title ?? "";

  // ── Render ─────────────────────────────────────────────────────────────────────

  const TIMEFRAME_TABS: { key: "all" | TaskTimeframe; zh: string; en: string }[] = [
    { key: "all", zh: "全部", en: "All" },
    { key: "daily", zh: "今日", en: "Today" },
    { key: "weekly", zh: "本週", en: "Week" },
    { key: "monthly", zh: "本月", en: "Month" },
    { key: "custom", zh: "自定", en: "Custom" },
  ];

  const taskListPanel = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Add task input */}
      <div className="shrink-0 border-b border-gray-100 px-4 py-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStartDraft()}
            placeholder={language === "zh-TW" ? "+ 輸入任務…" : "+ Add a task…"}
            disabled={draftAnalyzing}
            className="flex-1 min-w-0 text-sm text-gray-700 placeholder-gray-400 bg-transparent focus:outline-none"
          />
          <select
            value={draftTimeframe}
            onChange={(e) => setDraftTimeframe(e.target.value as TaskTimeframe)}
            className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white shrink-0"
          >
            {TIMEFRAME_TABS.filter((t) => t.key !== "all").map((t) => (
              <option key={t.key} value={t.key}>{language === "zh-TW" ? t.zh : t.en}</option>
            ))}
          </select>
          <button
            onClick={handleStartDraft}
            disabled={!draftTitle.trim() || draftAnalyzing || objectives.length === 0}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0 whitespace-nowrap"
          >
            {draftAnalyzing ? (language === "zh-TW" ? "分析中…" : "Analyzing…") : (language === "zh-TW" ? "AI 評估" : "Evaluate")}
          </button>
        </div>
        {draftTimeframe === "custom" && (
          <input
            value={draftCustomLabel}
            onChange={(e) => setDraftCustomLabel(e.target.value)}
            placeholder={language === "zh-TW" ? "時段描述（如：Q2 第一個月）" : "Timeframe label (e.g. Q2 first month)"}
            className="w-full text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        )}
        {objectives.length === 0 && (
          <p className="text-xs text-amber-600">{language === "zh-TW" ? "請先到「目標」頁設定 OKR，AI 才能評估任務" : "Set up OKR goals first so AI can evaluate tasks"}</p>
        )}
      </div>

      {/* Status + timeframe filter */}
      <div className="shrink-0 border-b border-gray-100">
        <div className="flex gap-1 px-4 py-2">
          {(["active", "shelved", "deleted"] as const).map((f) => {
            const count = f === "active" ? activeTasks.length : f === "shelved" ? shelvedTasks.length : deletedTasks.length;
            return (
              <button key={f} onClick={() => setTaskFilter(f)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${taskFilter === f ? "bg-indigo-50 text-indigo-600 font-medium" : "text-gray-400 hover:text-gray-600"}`}>
                {f === "active" ? (language === "zh-TW" ? "進行中" : "Active") : f === "shelved" ? (language === "zh-TW" ? "暫存" : "Shelved") : (language === "zh-TW" ? "垃圾桶" : "Deleted")}
                {count > 0 ? ` ${count}` : ""}
              </button>
            );
          })}
        </div>
        {taskFilter === "active" && (
          <div className="flex gap-0.5 px-4 pb-2 overflow-x-auto">
            {TIMEFRAME_TABS.map((tab) => {
              const count = tab.key === "all" ? activeTasks.length : activeTasks.filter((i) => i.taskTimeframe === tab.key).length;
              return (
                <button key={tab.key} onClick={() => setActiveTimeframe(tab.key)}
                  className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${activeTimeframe === tab.key ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {language === "zh-TW" ? tab.zh : tab.en}{count > 0 && tab.key !== "all" ? ` ${count}` : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {taskFilter === "shelved" && (
          shelvedTasks.length === 0
            ? <div className="px-4 py-8 text-center text-xs text-gray-400">{language === "zh-TW" ? "沒有暫存的任務" : "No shelved tasks"}</div>
            : <div className="divide-y divide-gray-50">
              {shelvedTasks.map((idea) => (
                <div key={idea.id} className="px-4 py-3 flex items-center gap-2">
                  <p className="text-sm text-gray-700 flex-1 truncate">{idea.title}</p>
                  <button onClick={() => setIdeaStatus(idea.id, "active")} className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 shrink-0">{language === "zh-TW" ? "還原" : "Restore"}</button>
                  <button onClick={() => setIdeaStatus(idea.id, "deleted")} className="text-gray-300 hover:text-red-400 text-base leading-none px-1 shrink-0">×</button>
                </div>
              ))}
            </div>
        )}

        {taskFilter === "deleted" && (
          deletedTasks.length === 0
            ? <div className="px-4 py-8 text-center text-xs text-gray-400">{language === "zh-TW" ? "垃圾桶是空的" : "Trash is empty"}</div>
            : <div className="divide-y divide-gray-50">
              {deletedTasks.map((idea) => (
                <div key={idea.id} className="px-4 py-3 flex items-center gap-2 opacity-60">
                  <p className="text-sm text-gray-500 flex-1 truncate line-through">{idea.title}</p>
                  <button onClick={() => setIdeaStatus(idea.id, "active")} className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 shrink-0">{language === "zh-TW" ? "還原" : "Restore"}</button>
                  <button onClick={() => handlePermanentDelete(idea.id)} className="text-xs text-red-400 hover:text-red-600 shrink-0">{language === "zh-TW" ? "永久刪除" : "Delete"}</button>
                </div>
              ))}
            </div>
        )}

        {taskFilter === "active" && (
          sortedActive.length === 0
            ? <div className="px-4 py-8 text-center text-xs text-gray-400">{language === "zh-TW" ? "沒有任務，在上方輸入開始" : "No tasks yet — type above to add one"}</div>
            : <div className="divide-y divide-gray-50">
              {sortedActive.map((idea) => {
                const isExpanded = expandedIds.has(idea.id);
                const isDone = idea.taskStatus === "done";
                const isFocused = focusedTaskId === idea.id && workspaceMode === "task";
                const links = idea.linkedKRs ?? [];
                const isPicking = showObjPickerId === idea.id;
                const isMeasurePending = pendingMeasure === idea.id;
                const measureKRs = links.flatMap((link) => {
                  const obj = objectives.find((o) => o.id === link.objectiveId);
                  const kr = obj?.keyResults.find((k) => k.id === link.krId);
                  if (!kr || (kr.krType ?? "cumulative") !== "measurement") return [];
                  return [{ obj: obj!, kr }];
                });
                return (
                  <div key={idea.id} className={`${isDone ? "opacity-60" : ""} ${isFocused ? "bg-indigo-50/60" : ""}`}>
                    <div className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => handleFocusTask(idea)}
                          className="flex-1 text-left min-w-0"
                        >
                          <p className={`text-sm text-gray-800 ${isDone ? "line-through text-gray-400" : ""}`}>{idea.title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {idea.taskTimeframe && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                                {getTimeframeLabel(idea.taskTimeframe, idea.taskTimeframeCustomLabel, language)}
                              </span>
                            )}
                            {idea.analysis && (
                              <span className={`text-[10px] font-semibold ${idea.analysis.finalScore >= 7 ? "text-indigo-600" : idea.analysis.finalScore >= 4 ? "text-amber-500" : "text-gray-400"}`}>
                                {idea.analysis.finalScore.toFixed(1)}
                              </span>
                            )}
                            {idea.needsReanalysis && (
                              <button onClick={(e) => { e.stopPropagation(); handleReanalyze(idea); }} disabled={reanalyzingIds.has(idea.id)}
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 disabled:opacity-50">
                                {reanalyzingIds.has(idea.id) ? (language === "zh-TW" ? "評估中…" : "Analyzing…") : (language === "zh-TW" ? "重新評估" : "Re-evaluate")}
                              </button>
                            )}
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          {(["todo", "in-progress", "done"] as TaskStatus[]).map((s) => (
                            <button key={s} onClick={(e) => { e.stopPropagation(); handleSetTaskStatus(idea.id, s); }}
                              className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap transition-colors ${idea.taskStatus === s ? TASK_STATUS_STYLE[s] + " font-medium" : "text-gray-200 hover:text-gray-500"}`}>
                              {TASK_STATUS_LABEL[s]}
                            </button>
                          ))}
                          <button onClick={(e) => { e.stopPropagation(); setExpandedIds((prev) => { const s = new Set(prev); isExpanded ? s.delete(idea.id) : s.add(idea.id); return s; }); }}
                            className="text-gray-300 hover:text-gray-500 text-xs px-1">
                            {isExpanded ? "▲" : "▼"}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setIdeaStatus(idea.id, "shelved"); }}
                            className="text-gray-300 hover:text-amber-500 text-xs px-0.5" title={language === "zh-TW" ? "暫存" : "Shelve"}>⊸</button>
                          <button onClick={(e) => { e.stopPropagation(); setIdeaStatus(idea.id, "deleted"); }}
                            className="text-gray-300 hover:text-red-400 text-base leading-none px-0.5">×</button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-3 bg-gray-50/70 border-t border-gray-100">
                        {/* Todos */}
                        {(() => {
                          const todos = idea.todos ?? [];
                          const doneCount = todos.filter((t) => t.done).length;
                          const allDone = todos.length > 0 && doneCount === todos.length;
                          const pct = todos.length > 0 ? Math.round((doneCount / todos.length) * 100) : 0;
                          return (
                            <div className="pt-3">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-medium text-gray-600">{language === "zh-TW" ? "子任務" : "Subtasks"}</span>
                                {todos.length > 0 && (
                                  <>
                                    <span className="text-xs text-gray-400">{doneCount}/{todos.length}</span>
                                    <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${getProgressColor(pct)}`} style={{ width: `${pct}%` }} />
                                    </div>
                                    {allDone && idea.taskStatus !== "done" && (
                                      <button onClick={() => handleSetTaskStatus(idea.id, "done")}
                                        className="text-xs px-2 py-0.5 bg-green-600 text-white rounded-lg hover:bg-green-700 shrink-0">
                                        {language === "zh-TW" ? "標記完成" : "Mark done"}
                                      </button>
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
                                      placeholder={language === "zh-TW" ? "待辦事項" : "Subtask"} />
                                  </div>
                                ))}
                                <button onClick={() => handleAddTodoAfter(idea.id)}
                                  className="flex items-center gap-2 w-full px-1 py-0.5 text-xs text-gray-400 hover:text-gray-600 rounded-md hover:bg-white">
                                  <span className="w-4 h-4 shrink-0 flex items-center justify-center text-gray-300 text-base leading-none">+</span>
                                  {language === "zh-TW" ? "新增待辦" : "Add subtask"}
                                </button>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Linked KRs */}
                        <div className="border-t border-gray-100 pt-3 space-y-1.5">
                          <LinkedObjsEditable links={links} objectives={objectives}
                            onRemove={(idx) => handleUpdateLinkedKRs(idea.id, links.filter((_, i) => i !== idx))} />
                          <button onClick={() => setShowObjPickerId(isPicking ? null : idea.id)}
                            className="text-xs text-indigo-500 hover:text-indigo-700">
                            {isPicking ? (language === "zh-TW" ? "完成指定" : "Done") : (language === "zh-TW" ? "＋ 指定目標" : "+ Link to goal")}
                          </button>
                          {isPicking && (
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                              {objectives.map((obj) => (
                                <div key={obj.id}>
                                  <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-100">{obj.title}</div>
                                  {obj.keyResults.map((kr) => {
                                    const alreadyLinked = links.some((l) => l.krId === kr.id);
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
                            <p className="text-xs font-medium text-amber-700">{language === "zh-TW" ? "完成前，請填入目前的數值：" : "Enter current values before marking done:"}</p>
                            {measureKRs.map(({ kr }) => (
                              <div key={kr.id} className="flex items-center gap-2">
                                <label className="text-xs text-gray-600 flex-1 truncate">{kr.title}</label>
                                <input type="number"
                                  value={measureInputs[idea.id]?.[kr.id] ?? ""}
                                  onChange={(e) => setMeasureInputs((prev) => ({ ...prev, [idea.id]: { ...(prev[idea.id] ?? {}), [kr.id]: e.target.value } }))}
                                  className="w-28 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                              </div>
                            ))}
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => confirmMeasurement(idea.id)}
                                className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">{language === "zh-TW" ? "確認完成" : "Confirm"}</button>
                              <button onClick={() => setPendingMeasure(null)}
                                className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50">{language === "zh-TW" ? "取消" : "Cancel"}</button>
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

  const workspacePanel = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Workspace header */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-700">{language === "zh-TW" ? "AI 工作區" : "AI Workspace"}</span>
          {workspaceTitle && (
            <span className="text-xs text-gray-400 truncate flex-1">— {workspaceTitle}</span>
          )}
          {workspaceMode !== "empty" && (
            <button onClick={() => { setWorkspaceMode("empty"); setFocusedTaskId(null); setWorkspaceMessages([]); }}
              className="text-gray-300 hover:text-gray-500 text-xl leading-none shrink-0">×</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {workspaceMode === "empty" && (
          <p className="text-xs text-gray-400 text-center py-8 leading-relaxed">
            {language === "zh-TW"
              ? "點擊左側任務，開始 AI 督導討論\n或輸入新任務讓 AI 評估"
              : "Click a task to start an AI discussion\nor type a new task to evaluate it"}
          </p>
        )}
        {workspaceMessages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed ${msg.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-800"}`}>
              {msg.isLoading
                ? <span className="text-xs opacity-50 animate-pulse">{language === "zh-TW" ? "分析中…" : "Analyzing…"}</span>
                : <p className="whitespace-pre-wrap">{msg.content}</p>
              }
            </div>
          </div>
        ))}

        {/* Draft: KR link selection */}
        {workspaceMode === "draft" && !draftAnalyzing && draftAnalysis && draftSuggestedLinks.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 space-y-2">
            <p className="text-xs font-medium text-indigo-600">{language === "zh-TW" ? "連結至目標（選填）" : "Link to goals (optional)"}</p>
            {draftSuggestedLinks.map((l) => (
              <label key={l.krId} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={draftSelectedLinks.has(l.krId)} onChange={() => {
                  setDraftSelectedLinks((prev) => { const n = new Set(prev); n.has(l.krId) ? n.delete(l.krId) : n.add(l.krId); return n; });
                }} className="accent-indigo-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 truncate">{l.krTitle}</p>
                  <p className="text-[10px] text-gray-400 truncate">{l.objectiveTitle}</p>
                </div>
                <span className={`text-xs font-semibold shrink-0 ${l.score >= 7 ? "text-indigo-600" : "text-amber-500"}`}>{l.score.toFixed(1)}</span>
              </label>
            ))}
          </div>
        )}

        {/* Draft: confirm button */}
        {workspaceMode === "draft" && !draftAnalyzing && draftAnalysis && (
          <button
            onClick={handleConfirmDraft}
            disabled={draftSaving}
            className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {draftSaving ? (language === "zh-TW" ? "儲存中…" : "Saving…") : (language === "zh-TW" ? "確認儲存此任務" : "Confirm & Save Task")}
          </button>
        )}
        <div ref={workspaceEndRef} />
      </div>

      {/* Chat input */}
      {workspaceMode !== "empty" && (
        <div className="shrink-0 px-3 pb-3 pt-2 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              value={workspaceChatInput}
              onChange={(e) => setWorkspaceChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleWorkspaceSend(); }}
              placeholder={language === "zh-TW" ? "跟 AI 督導討論這個任務…" : "Discuss this task with the AI supervisor…"}
              disabled={workspaceChatLoading}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
            />
            <button
              onClick={handleWorkspaceSend}
              disabled={!workspaceChatInput.trim() || workspaceChatLoading}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
            >
              {language === "zh-TW" ? "送出" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 px-4 py-4 md:px-6">
        <h1 className="text-lg font-semibold text-gray-800">{language === "zh-TW" ? "任務" : "Tasks"}</h1>
        <p className="text-xs text-gray-400 mt-0.5">{language === "zh-TW" ? "AI 督導每個任務，確保都在軌道上" : "AI supervises each task to keep everything on track"}</p>
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden shrink-0 flex border-b border-gray-100">
        {(["list", "workspace"] as const).map((tab) => (
          <button key={tab} onClick={() => setMobileTab(tab)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${mobileTab === tab ? "text-indigo-600 border-b-2 border-indigo-600" : "text-gray-400"}`}>
            {tab === "list"
              ? (language === "zh-TW" ? "任務清單" : "Task List")
              : (language === "zh-TW" ? "AI 工作區" : "AI Workspace")}
          </button>
        ))}
      </div>

      {/* Main split layout */}
      <div className="flex flex-1">
        {/* Left: task list */}
        <div className={`lg:w-[480px] lg:shrink-0 lg:border-r lg:border-gray-100 flex flex-col min-h-0 ${mobileTab !== "list" ? "hidden lg:flex" : "flex flex-1"}`}
          style={{ height: "calc(100vh - 120px)" }}>
          {taskListPanel}
        </div>

        {/* Right: AI workspace */}
        <div className={`flex-1 flex flex-col min-h-0 ${mobileTab !== "workspace" ? "hidden lg:flex" : "flex flex-1"}`}
          style={{ height: "calc(100vh - 120px)" }}>
          {workspacePanel}
        </div>
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
