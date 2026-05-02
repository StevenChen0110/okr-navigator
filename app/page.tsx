"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import {
  Idea,
  Objective,
  IdeaAnalysis,
  IdeaKRLink,
  TaskStatus,
  IdeaStatus,
} from "@/lib/types";
import {
  fetchIdeas,
  fetchObjectives,
  saveIdea,
  updateIdeaTaskStatus,
  updateIdeaStatus,
} from "@/lib/db";
import { callAI } from "@/lib/ai-client";


type ModalStatus = "idle" | "clarifying" | "analyzing" | "confirm" | "saving";

interface SuggestedLink {
  objectiveId: string;
  objectiveTitle: string;
  krId: string;
  krTitle: string;
  score: number;
}

function buildProgressContext(objectives: Objective[]): string {
  return objectives
    .map((o) => {
      const krLines = o.keyResults
        .map((kr) => {
          const pct =
            kr.krType === "milestone"
              ? kr.currentValue && kr.currentValue >= 1
                ? 100
                : 0
              : kr.targetValue && kr.targetValue > 0
              ? Math.min(
                  100,
                  Math.round(((kr.currentValue ?? 0) / kr.targetValue) * 100)
                )
              : undefined;
          return `    - ${kr.title}${pct !== undefined ? ` (${pct}% complete)` : ""}`;
        })
        .join("\n");
      return `${o.title}:\n${krLines}`;
    })
    .join("\n\n");
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

export default function HomePage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"tasks" | "shelved" | "deleted">("tasks");

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
  const [pendingInboxId, setPendingInboxId] = useState<string | null>(null);

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  const hasDetails = modalWhy.trim() || modalOutcome.trim() || modalNotes.trim();
  const isQuickMode = !hasDetails;

  function openNewModal() {
    setPendingInboxId(null);
    setModalTitle("");
    setModalWhy("");
    setModalOutcome("");
    setModalNotes("");
    setModalDetailsOpen(false);
    setModalAnalysis(null);
    setModalSuggestedLinks([]);
    setModalSelectedLinkIds(new Set());
    setModalErrorMsg("");
    setClarifyQuestion("");
    setClarifyAnswer("");
    setModalStatus("idle");
    setModalOpen(true);
  }

  function openAnalyzeInbox(item: Idea) {
    setPendingInboxId(item.id);
    setModalTitle(item.title);
    setModalWhy("");
    setModalOutcome("");
    setModalNotes("");
    setModalDetailsOpen(false);
    setModalAnalysis(null);
    setModalSuggestedLinks([]);
    setModalSelectedLinkIds(new Set());
    setModalErrorMsg("");
    setClarifyQuestion("");
    setClarifyAnswer("");
    setModalStatus("idle");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalStatus("idle");
    setPendingInboxId(null);
  }

  async function runAnalysis(extraNotes?: string) {
    setModalStatus("analyzing");
    setModalErrorMsg("");
    try {
      const combinedNotes = [modalNotes, extraNotes].filter(Boolean).join("\n");
      const result = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle: modalTitle,
        ideaWhy: modalWhy,
        ideaOutcome: modalOutcome,
        ideaNotes: combinedNotes,
        objectives,
        progressContext: buildProgressContext(objectives),
      });
      setModalAnalysis(result);
      const links: SuggestedLink[] = [];
      for (const os of result.objectiveScores) {
        for (const krs of os.keyResultScores) {
          if (krs.score >= 5)
            links.push({
              objectiveId: os.objectiveId,
              objectiveTitle: os.objectiveTitle,
              krId: krs.keyResultId,
              krTitle: krs.keyResultTitle,
              score: krs.score,
            });
        }
      }
      links.sort((a, b) => b.score - a.score);
      setModalSuggestedLinks(links);
      setModalSelectedLinkIds(
        new Set(links.filter((l) => l.score >= 7).map((l) => l.krId))
      );
      setModalStatus("confirm");
    } catch (e) {
      setModalErrorMsg(e instanceof Error ? e.message : "分析失敗");
      setModalStatus("idle");
    }
  }

  async function handleAnalyze() {
    if (!modalTitle.trim()) return;
    if (objectives.length === 0) {
      setModalErrorMsg("請先建立至少一個目標");
      return;
    }
    setModalErrorMsg("");
    if (isQuickMode) {
      setModalStatus("clarifying");
      try {
        const { shouldClarify, question } = await callAI<{
          shouldClarify: boolean;
          question: string;
        }>("clarifyIdea", { ideaTitle: modalTitle, objectives });
        if (shouldClarify && question) {
          setClarifyQuestion(question);
          setClarifyAnswer("");
          return;
        }
      } catch {
        /* fall through */
      }
    }
    await runAnalysis();
  }

  async function handleSave(ideaStatus: IdeaStatus | undefined, taskStatus: TaskStatus) {
    if (!modalAnalysis) return;
    setModalStatus("saving");
    const linkedKRs: IdeaKRLink[] = modalSuggestedLinks
      .filter((l) => modalSelectedLinkIds.has(l.krId))
      .map((l) => ({ objectiveId: l.objectiveId, krId: l.krId }));

    if (pendingInboxId) {
      const existing = ideas.find((i) => i.id === pendingInboxId);
      if (existing) {
        const updated: Idea = {
          ...existing,
          analysis: modalAnalysis,
          ideaStatus: ideaStatus ?? "active",
          taskStatus,
          linkedKRs,
          quickAnalysis: isQuickMode,
        };
        try {
          await saveIdea(updated);
          setIdeas((prev) => prev.map((i) => (i.id === pendingInboxId ? updated : i)));
          closeModal();
        } catch (e) {
          setModalErrorMsg(e instanceof Error ? e.message : "儲存失敗");
          setModalStatus("confirm");
        }
      }
    } else {
      const descParts: string[] = [];
      if (modalWhy.trim()) descParts.push(`為什麼要做：${modalWhy}`);
      if (modalOutcome.trim()) descParts.push(`預期成效：${modalOutcome}`);
      if (modalNotes.trim()) descParts.push(`備註：${modalNotes}`);
      const newIdea: Idea = {
        id: uuid(),
        title: modalTitle,
        description: descParts.join("\n"),
        analysis: modalAnalysis,
        createdAt: new Date().toISOString(),
        completed: false,
        linkedKRs,
        taskStatus,
        ideaStatus: ideaStatus ?? "active",
        quickAnalysis: isQuickMode,
      };
      try {
        await saveIdea(newIdea);
        setIdeas((prev) => [newIdea, ...prev]);
        closeModal();
      } catch (e) {
        setModalErrorMsg(e instanceof Error ? e.message : "儲存失敗");
        setModalStatus("confirm");
      }
    }
  }

  async function promoteToTask(item: Idea) {
    const updated: Idea = { ...item, ideaStatus: "active", taskStatus: "todo" };
    setIdeas((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    await saveIdea(updated).catch(console.error);
  }

  async function archiveIdea(item: Idea) {
    setIdeas((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, ideaStatus: "shelved" as IdeaStatus } : i))
    );
    await updateIdeaStatus(item.id, "shelved").catch(console.error);
  }

  async function deleteIdea(item: Idea) {
    setIdeas((prev) => prev.filter((i) => i.id !== item.id));
    await updateIdeaStatus(item.id, "deleted").catch(console.error);
  }

  async function restoreIdea(item: Idea) {
    setIdeas((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, ideaStatus: "active" as IdeaStatus } : i))
    );
    await updateIdeaStatus(item.id, "active").catch(console.error);
  }

  function setTaskStatus(ideaId: string, status: TaskStatus) {
    setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, taskStatus: status } : i)));
    updateIdeaTaskStatus(ideaId, status).catch(console.error);
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  const inboxItems = ideas.filter((i) => i.ideaStatus === "inbox");
  const unevaluated = ideas.filter(
    (i) => (i.ideaStatus ?? "active") === "active" && !i.analysis
  );
  const pendingItems = [...inboxItems, ...unevaluated];
  const shelved = ideas.filter((i) => i.ideaStatus === "shelved");
  const deleted = ideas.filter((i) => i.ideaStatus === "deleted");

  const evaluated = ideas
    .filter((i) => (i.ideaStatus ?? "active") === "active" && i.analysis)
    .sort((a, b) => {
      const aDone = a.taskStatus === "done" ? 1 : 0;
      const bDone = b.taskStatus === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return (b.analysis!.finalScore ?? 0) - (a.analysis!.finalScore ?? 0);
    });

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 pb-32 space-y-6">
      {/* Analyze Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && modalStatus === "idle") closeModal();
          }}
        >
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">
                  {pendingInboxId ? "AI 評估想法" : "新增想法"}
                </h2>
                {(modalStatus === "idle" || modalStatus === "confirm") && (
                  <button
                    onClick={closeModal}
                    className="text-gray-300 hover:text-gray-500 text-xl leading-none"
                  >
                    ×
                  </button>
                )}
              </div>

              {(modalStatus === "analyzing" ||
                modalStatus === "saving" ||
                (modalStatus === "clarifying" && !clarifyQuestion)) && (
                <div className="text-center py-10">
                  <div className="text-3xl mb-3 animate-pulse">◎</div>
                  <p className="text-xs text-gray-400">
                    {modalStatus === "saving" ? "儲存中…" : "AI 分析中…"}
                  </p>
                </div>
              )}

              {modalStatus === "clarifying" && clarifyQuestion && (
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
                    <button
                      onClick={() => runAnalysis()}
                      className="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
                    >
                      跳過
                    </button>
                    <button
                      onClick={() => runAnalysis(clarifyAnswer.trim() || undefined)}
                      disabled={!clarifyAnswer.trim()}
                      className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      繼續分析
                    </button>
                  </div>
                </div>
              )}

              {modalStatus === "idle" && (
                <div className="space-y-3">
                  <input
                    value={modalTitle}
                    onChange={(e) => setModalTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleAnalyze()}
                    placeholder="用一句話描述這個想法"
                    autoFocus
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setModalDetailsOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
                  >
                    <span className={`transition-transform ${modalDetailsOpen ? "rotate-90" : ""}`}>
                      ›
                    </span>
                    補充說明（選填）
                    {hasDetails && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
                    )}
                  </button>
                  {modalDetailsOpen && (
                    <div className="space-y-2 pl-3 border-l-2 border-gray-100">
                      <textarea
                        value={modalWhy}
                        onChange={(e) => setModalWhy(e.target.value)}
                        placeholder="為什麼要做？"
                        rows={2}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none resize-none"
                      />
                      <textarea
                        value={modalOutcome}
                        onChange={(e) => setModalOutcome(e.target.value)}
                        placeholder="預期成效"
                        rows={2}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none resize-none"
                      />
                      <textarea
                        value={modalNotes}
                        onChange={(e) => setModalNotes(e.target.value)}
                        placeholder="備註"
                        rows={2}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none resize-none"
                      />
                    </div>
                  )}
                  {modalErrorMsg && (
                    <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                      {modalErrorMsg}
                    </div>
                  )}
                  <button
                    onClick={handleAnalyze}
                    disabled={!modalTitle.trim()}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isQuickMode ? "AI 評估" : "完整分析"}
                  </button>
                </div>
              )}

              {modalStatus === "confirm" && modalAnalysis && (
                <div className="space-y-3">
                  {/* Score + title */}
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center bg-indigo-50 rounded-xl px-3 py-2 shrink-0">
                      <span className="text-2xl font-bold font-mono text-indigo-600">
                        {modalAnalysis.finalScore.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-gray-400">綜合</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 leading-snug">{modalTitle}</p>
                  </div>

                  {/* Summary */}
                  {modalAnalysis.summary && (
                    <div className="bg-indigo-50 rounded-xl px-3 py-2.5 text-xs text-indigo-700 leading-relaxed">
                      {modalAnalysis.summary}
                    </div>
                  )}

                  {/* Per-objective breakdown */}
                  <div className="space-y-2">
                    {modalAnalysis.objectiveScores.map((os) => {
                      const obj = objectives.find((o) => o.id === os.objectiveId);
                      const desc = obj?.description || os.objectiveDescription;
                      return (
                        <div key={os.objectiveId} className="bg-gray-50 rounded-lg border border-gray-100 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700 truncate">{os.objectiveTitle}</p>
                              {desc && <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{desc}</p>}
                            </div>
                            <span className={`text-sm font-bold font-mono shrink-0 ${
                              os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-400"
                            }`}>
                              {os.overallScore.toFixed(1)}
                            </span>
                          </div>
                          {os.reasoning && (
                            <p className="text-[11px] text-gray-500">{os.reasoning}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {modalAnalysis.risks.length > 0 && (
                    <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                      <span className="font-medium">風險：</span>
                      {modalAnalysis.risks.join("；")}
                    </div>
                  )}
                  {modalErrorMsg && (
                    <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                      {modalErrorMsg}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleSave("deleted", "todo")}
                      className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50"
                    >
                      放棄
                    </button>
                    <button
                      onClick={() => handleSave("shelved", "todo")}
                      className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-amber-50 hover:border-amber-200"
                    >
                      暫存
                    </button>
                    <button
                      onClick={() => handleSave(undefined, "todo")}
                      className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                    >
                      加入清單
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">想法</h1>
          <p className="text-xs text-gray-400 mt-0.5">AI 幫你判斷哪個最值得做</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/okr" className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 rounded-xl hover:bg-gray-100 transition-colors">
            判斷標準
          </Link>
          <button
            onClick={openNewModal}
            className="text-sm font-medium px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            + 新增
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {([
          { key: "tasks", label: "任務", count: pendingItems.length + evaluated.length },
          { key: "shelved", label: "暫存", count: shelved.length },
          { key: "deleted", label: "刪除", count: deleted.length },
        ] as const).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === key
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                activeTab === key ? "bg-gray-100 text-gray-500" : "bg-gray-200 text-gray-400"
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* No objectives banner */}
      {objectives.length === 0 && activeTab === "tasks" && (
        <Link
          href="/okr"
          className="block bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700 hover:bg-amber-100 transition-colors"
        >
          先設定你的目標，AI 才能判斷想法是否值得做 →
        </Link>
      )}

      {/* Tasks tab */}
      {activeTab === "tasks" && (
        <>
          {/* Pending evaluation */}
          {pendingItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  待評估
                </h2>
                <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">
                  {pendingItems.length}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                點「AI 評估」讓 AI 根據你的目標判斷這件事值不值得做
              </p>
              {pendingItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-amber-100 px-4 py-3"
                >
                  <p className="text-sm text-gray-800 mb-3 leading-snug">{item.title}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => openAnalyzeInbox(item)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium transition-colors"
                    >
                      AI 評估
                    </button>
                    {item.ideaStatus === "inbox" && (
                      <button
                        onClick={() => promoteToTask(item)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        直接轉任務
                      </button>
                    )}
                    <button
                      onClick={() => archiveIdea(item)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors"
                    >
                      存起來
                    </button>
                    <button
                      onClick={() => deleteIdea(item)}
                      className="text-xs text-gray-300 hover:text-red-400 ml-auto transition-colors"
                    >
                      刪除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Evaluated ranked list */}
          {evaluated.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                AI 評分排行
              </h2>
              <div className="space-y-1.5">
                {evaluated.map((idea) => {
                  const isExpanded = expandedIds.has(idea.id);
                  const isDone = idea.taskStatus === "done";
                  return (
                    <div
                      key={idea.id}
                      className={`bg-white rounded-xl border transition-all ${
                        isDone
                          ? "border-gray-100 opacity-60"
                          : isExpanded
                          ? "border-indigo-100"
                          : "border-gray-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 px-4 py-3">
                        <button
                          onClick={() => toggleExpand(idea.id)}
                          className="flex-1 text-left min-w-0"
                        >
                          <p
                            className={`text-sm font-medium truncate ${
                              isDone ? "line-through text-gray-400" : "text-gray-800"
                            }`}
                          >
                            {idea.title}
                          </p>
                        </button>
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
                        <div className="flex gap-1 shrink-0">
                          {(["todo", "in-progress", "done"] as TaskStatus[]).map((s) => (
                            <button
                              key={s}
                              onClick={() => setTaskStatus(idea.id, s)}
                              className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap transition-colors ${
                                idea.taskStatus === s
                                  ? TASK_STATUS_STYLE[s] + " font-medium"
                                  : "text-gray-300 hover:text-gray-500"
                              }`}
                            >
                              {TASK_STATUS_LABEL[s]}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => toggleExpand(idea.id)}
                          className="text-gray-300 text-xs shrink-0 ml-1"
                        >
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t border-gray-50 space-y-2">
                          {/* Summary */}
                          {idea.analysis!.summary && (
                            <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-2.5 py-1.5 leading-relaxed">
                              {idea.analysis!.summary}
                            </p>
                          )}
                          {/* Per-objective */}
                          {idea.analysis!.objectiveScores.map((os) => {
                            const obj = objectives.find((o) => o.id === os.objectiveId);
                            const desc = obj?.description || os.objectiveDescription;
                            return (
                              <div key={os.objectiveId} className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-600 truncate">{os.objectiveTitle}</p>
                                  {desc && <p className="text-[11px] text-gray-400 leading-snug">{desc}</p>}
                                  {os.reasoning && <p className="text-[11px] text-gray-500 mt-0.5">{os.reasoning}</p>}
                                </div>
                                <span className={`text-xs font-bold font-mono shrink-0 mt-0.5 ${
                                  os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-400"
                                }`}>
                                  {os.overallScore.toFixed(1)}
                                </span>
                              </div>
                            );
                          })}
                          <div className="flex gap-3 pt-1 border-t border-gray-50">
                            <button
                              onClick={() => archiveIdea(idea)}
                              className="text-xs text-gray-400 hover:text-gray-600"
                            >
                              存起來
                            </button>
                            <button
                              onClick={() => deleteIdea(idea)}
                              className="text-xs text-gray-300 hover:text-red-400"
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {evaluated.length === 0 && pendingItems.length === 0 && (
            <div className="text-center py-20">
              <div className="text-4xl mb-3 text-gray-200">◎</div>
              <p className="text-sm text-gray-500">還沒有想法</p>
              <p className="text-xs text-gray-400 mt-1 mb-5">
                輸入一個想法，AI 會幫你判斷值不值得做
              </p>
              <button
                onClick={openNewModal}
                className="text-sm text-indigo-500 hover:text-indigo-700"
              >
                新增第一個想法 →
              </button>
            </div>
          )}
        </>
      )}

      {/* Shelved tab */}
      {activeTab === "shelved" && (
        <div className="space-y-2">
          {shelved.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-sm text-gray-400">沒有暫存的想法</p>
            </div>
          ) : (
            shelved.map((item) => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                <p className="text-sm text-gray-500 flex-1 truncate">{item.title}</p>
                <button
                  onClick={() => restoreIdea(item)}
                  className="text-xs text-indigo-500 hover:text-indigo-700 shrink-0"
                >
                  恢復
                </button>
                <button
                  onClick={() => deleteIdea(item)}
                  className="text-xs text-gray-300 hover:text-red-400 shrink-0"
                >
                  刪除
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Deleted tab */}
      {activeTab === "deleted" && (
        <div className="space-y-2">
          {deleted.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-sm text-gray-400">沒有刪除的想法</p>
            </div>
          ) : (
            deleted.map((item) => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                <p className="text-sm text-gray-400 flex-1 truncate line-through">{item.title}</p>
                <button
                  onClick={() => restoreIdea(item)}
                  className="text-xs text-gray-400 hover:text-indigo-600 shrink-0"
                >
                  恢復
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
