"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import {
  Idea,
  Objective,
  IdeaAnalysis,
  IdeaKRLink,
  TaskStatus,
  IdeaStatus,
  EvaluationProfile,
  ObjGroup,
} from "@/lib/types";
import {
  fetchIdeas,
  fetchObjectives,
  saveIdea,
  updateIdeaTaskStatus,
  updateIdeaStatus,
  removeIdea,
} from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
import { getEvaluationProfile, getObjGroups } from "@/lib/storage";
import {
  buildEvaluationPrompt,
  DEFAULT_EVALUATION_PROFILE,
} from "@/lib/evaluation-prompt";
import { useLanguage } from "@/components/LanguageProvider";

type ModalStatus = "idle" | "clarifying" | "analyzing" | "confirm" | "saving";

interface SuggestedLink {
  objectiveId: string;
  objectiveTitle: string;
  krId: string;
  krTitle: string;
  score: number;
}

export default function HomePage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const { user, openLogin, requireAuth } = useAuth();
  const { t } = useLanguage();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"tasks" | "shelved" | "deleted">("tasks");
  const [filterValue, setFilterValue] = useState("");
  const [reanalyzingIds, setReanalyzingIds] = useState<Set<string>>(new Set());
  const autoReanalyzeDone = useRef(false);

  const [evalProfile, setEvalProfile] = useState<EvaluationProfile>(DEFAULT_EVALUATION_PROFILE);
  const [groups, setGroups] = useState<ObjGroup[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalStatus, setModalStatus] = useState<ModalStatus>("idle");
  const [modalTitle, setModalTitle] = useState("");
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
    setEvalProfile(getEvaluationProfile());
    setGroups(getObjGroups());
  }, []);

  useEffect(() => {
    if (!user) {
      setIdeas([]);
      setObjectives([]);
      autoReanalyzeDone.current = false;
      return;
    }
    let cancelled = false;

    Promise.all([fetchIdeas(), fetchObjectives()])
      .then(([loadedIdeas, loadedObjectives]) => {
        if (cancelled) return;
        setIdeas(loadedIdeas);
        setObjectives(loadedObjectives);

        if (autoReanalyzeDone.current) return;
        const toReanalyze = loadedIdeas.filter(
          (i) => i.needsReanalysis && i.analysis && (i.ideaStatus ?? "active") === "active"
        );
        if (toReanalyze.length === 0) return;

        autoReanalyzeDone.current = true;
        setReanalyzingIds(new Set(toReanalyze.map((i) => i.id)));

        const currentProfile = getEvaluationProfile();
        (async () => {
          for (const item of toReanalyze) {
            if (cancelled) break;
            try {
              const analysis = await callAI<IdeaAnalysis>("analyzeIdea", {
                ideaTitle: item.title,
                ideaNotes: item.description || "",
                objectives: loadedObjectives,
                evaluationContext: buildEvaluationPrompt(currentProfile),
                groups: getObjGroups(),
              });
              const updated: Idea = { ...item, analysis, needsReanalysis: false };
              await saveIdea(updated);
              if (!cancelled) setIdeas((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
            } catch (e) {
              console.error("auto re-analysis failed:", item.title, e);
            } finally {
              if (!cancelled)
                setReanalyzingIds((prev) => {
                  const s = new Set(prev);
                  s.delete(item.id);
                  return s;
                });
            }
          }
        })();
      })
      .catch(console.error);

    return () => { cancelled = true; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isQuickMode = !modalNotes.trim();

  function openNewModal() {
    if (!user) { requireAuth(); return; }
    setPendingInboxId(null);
    setModalTitle("");
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
    if (!user) { requireAuth(); return; }
    setPendingInboxId(item.id);
    setModalTitle(item.title);
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
        ideaNotes: combinedNotes,
        objectives,
        evaluationContext: buildEvaluationPrompt(evalProfile),
        groups,
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
      setModalErrorMsg(e instanceof Error ? e.message : t("modal.analyzing"));
      setModalStatus("idle");
    }
  }

  async function handleAnalyze() {
    if (!modalTitle.trim()) return;
    if (objectives.length === 0) {
      setModalErrorMsg(t("error.noObjectives"));
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
          setModalErrorMsg(e instanceof Error ? e.message : t("modal.saving"));
          setModalStatus("confirm");
        }
      }
    } else {
      const descParts: string[] = [];
      if (modalNotes.trim()) descParts.push(modalNotes.trim());
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
        setModalErrorMsg(e instanceof Error ? e.message : t("modal.saving"));
        setModalStatus("confirm");
      }
    }
  }

  async function promoteToTask(item: Idea) {
    if (!user) { requireAuth(); return; }
    const updated: Idea = { ...item, ideaStatus: "active", taskStatus: "todo" };
    setIdeas((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    await saveIdea(updated).catch(console.error);
  }

  async function archiveIdea(item: Idea) {
    if (!user) { requireAuth(); return; }
    setIdeas((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, ideaStatus: "shelved" as IdeaStatus } : i))
    );
    await updateIdeaStatus(item.id, "shelved").catch(console.error);
  }

  async function deleteIdea(item: Idea) {
    if (!user) { requireAuth(); return; }
    setIdeas((prev) => prev.map((i) => (i.id === item.id ? { ...i, ideaStatus: "deleted" as IdeaStatus } : i)));
    await updateIdeaStatus(item.id, "deleted").catch(console.error);
  }

  async function restoreIdea(item: Idea) {
    if (!user) { requireAuth(); return; }
    setIdeas((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, ideaStatus: "active" as IdeaStatus } : i))
    );
    await updateIdeaStatus(item.id, "active").catch(console.error);
  }

  function setTaskStatus(ideaId: string, status: TaskStatus) {
    if (!user) { requireAuth(); return; }
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

  const selectedObjId = filterValue.startsWith("g:") || filterValue === "" ? null : filterValue;
  const selectedGroupId = filterValue.startsWith("g:") ? filterValue.slice(2) : null;

  const evaluated = ideas
    .filter((i) => (i.ideaStatus ?? "active") === "active" && i.analysis)
    .sort((a, b) => {
      const aDone = a.taskStatus === "done" ? 1 : 0;
      const bDone = b.taskStatus === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      if (selectedObjId) {
        const aScore = a.analysis!.objectiveScores.find((os) => os.objectiveId === selectedObjId)?.overallScore ?? 0;
        const bScore = b.analysis!.objectiveScores.find((os) => os.objectiveId === selectedObjId)?.overallScore ?? 0;
        return bScore - aScore;
      }
      if (selectedGroupId) {
        const groupObjIds = new Set(objectives.filter((o) => o.meta?.groupId === selectedGroupId).map((o) => o.id));
        const avg = (idea: typeof a) => {
          const scores = idea.analysis!.objectiveScores.filter((os) => groupObjIds.has(os.objectiveId));
          return scores.length ? scores.reduce((s, os) => s + os.overallScore, 0) / scores.length : 0;
        };
        return avg(b) - avg(a);
      }
      return (b.analysis!.finalScore ?? 0) - (a.analysis!.finalScore ?? 0);
    });

  const taskStatusLabel: Record<TaskStatus, string> = {
    todo: t("status.todo"),
    "in-progress": t("status.inProgress"),
    done: t("status.done"),
  };
  const taskStatusStyle: Record<TaskStatus, string> = {
    todo: "bg-gray-100 text-gray-500",
    "in-progress": "bg-amber-50 text-amber-600",
    done: "bg-green-50 text-green-600",
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">
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
                  {pendingInboxId ? t("modal.evaluateTask") : t("modal.newTask")}
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
                    {modalStatus === "saving" ? t("modal.saving") : t("modal.analyzing")}
                  </p>
                </div>
              )}

              {modalStatus === "clarifying" && clarifyQuestion && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700 font-medium">{clarifyQuestion}</p>
                  <textarea
                    value={clarifyAnswer}
                    onChange={(e) => setClarifyAnswer(e.target.value)}
                    placeholder={t("modal.notesPlaceholder")}
                    rows={3}
                    autoFocus
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => runAnalysis()}
                      className="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
                    >
                      {t("modal.skip")}
                    </button>
                    <button
                      onClick={() => runAnalysis(clarifyAnswer.trim() || undefined)}
                      disabled={!clarifyAnswer.trim()}
                      className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {t("modal.continue")}
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
                    placeholder={t("modal.taskPlaceholder")}
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
                    {t("modal.addNotes")}
                    {modalNotes.trim() && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
                    )}
                  </button>
                  {modalDetailsOpen && (
                    <div className="pl-3 border-l-2 border-gray-100">
                      <textarea
                        value={modalNotes}
                        onChange={(e) => setModalNotes(e.target.value)}
                        placeholder={t("modal.notesPlaceholder")}
                        rows={3}
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
                    {isQuickMode ? t("modal.aiEval") : t("modal.fullAnalysis")}
                  </button>
                </div>
              )}

              {modalStatus === "confirm" && modalAnalysis && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center bg-indigo-50 rounded-xl px-3 py-2 shrink-0">
                      <span className="text-2xl font-bold font-mono text-indigo-600">
                        {modalAnalysis.finalScore.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-gray-400">{t("modal.overall")}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 leading-snug">{modalTitle}</p>
                  </div>

                  {modalAnalysis.summary && (
                    <div className="bg-indigo-50 rounded-xl px-3 py-2.5 text-xs text-indigo-700 leading-relaxed">
                      {modalAnalysis.summary}
                    </div>
                  )}

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
                      <span className="font-medium">{t("modal.risks")}</span>
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
                      {t("modal.discard")}
                    </button>
                    <button
                      onClick={() => handleSave("shelved", "todo")}
                      className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-amber-50 hover:border-amber-200"
                    >
                      {t("modal.shelve")}
                    </button>
                    <button
                      onClick={() => handleSave(undefined, "todo")}
                      className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                    >
                      {t("modal.addToList")}
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
          <h1 className="text-xl font-semibold">{t("tasks.title")}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {t("tasks.subtitle")}
            <span className="ml-1.5 text-gray-300">·</span>
            <span className="ml-1.5 text-indigo-400">{t(`mode.${evalProfile.mode}`)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!user && (
            <button
              onClick={openLogin}
              className="text-xs font-medium px-3 py-2 rounded-xl border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              {t("tasks.signIn")}
            </button>
          )}
          <button
            onClick={openNewModal}
            className="text-sm font-medium px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {t("tasks.add")}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {([
          { key: "tasks", labelKey: "tab.tasks", count: pendingItems.length + evaluated.length },
          { key: "shelved", labelKey: "tab.shelved", count: shelved.length },
          { key: "deleted", labelKey: "tab.deleted", count: deleted.length },
        ] as const).map(({ key, labelKey, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === key
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {t(labelKey)}
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

      {/* Re-analysis in progress banner */}
      {reanalyzingIds.size > 0 && activeTab === "tasks" && (
        <div className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <span className="animate-pulse">◎</span>
          {t("reanalyzing", { n: reanalyzingIds.size })}
        </div>
      )}

      {/* Objective / group filter dropdown */}
      {activeTab === "tasks" && evaluated.length > 0 && objectives.length > 0 && (
        <div className="relative">
          <select
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-3 py-2 pr-8 text-sm text-gray-700 focus:outline-none focus:border-gray-400"
          >
            <option value="">{t("filter.all")}</option>
            {groups.length > 0 && (() => {
              const activeObjs = objectives.filter((o) => !o.status || o.status === "active");
              const ungrouped = activeObjs.filter((o) => !o.meta?.groupId);
              return (
                <>
                  {groups
                    .slice()
                    .sort((a, b) => a.priority - b.priority)
                    .map((g) => {
                      const gObjs = activeObjs
                        .filter((o) => o.meta?.groupId === g.id)
                        .sort((a, b) => (a.meta?.priority ?? 2) - (b.meta?.priority ?? 2));
                      if (gObjs.length === 0) return null;
                      return (
                        <optgroup key={g.id} label={`▸ ${g.name}`}>
                          <option value={`g:${g.id}`}>{t("filter.groupAll", { name: g.name })}</option>
                          {gObjs.map((o) => (
                            <option key={o.id} value={o.id}>　{o.title}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  {ungrouped.length > 0 && (
                    <optgroup label={`▸ ${t("goals.ungrouped")}`}>
                      {ungrouped
                        .sort((a, b) => (a.meta?.priority ?? 2) - (b.meta?.priority ?? 2))
                        .map((o) => (
                          <option key={o.id} value={o.id}>　{o.title}</option>
                        ))}
                    </optgroup>
                  )}
                </>
              );
            })()}
            {groups.length === 0 && objectives
              .filter((o) => !o.status || o.status === "active")
              .sort((a, b) => (a.meta?.priority ?? 2) - (b.meta?.priority ?? 2))
              .map((o) => (
                <option key={o.id} value={o.id}>{o.title}</option>
              ))}
          </select>
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </div>
      )}

      {/* Tasks tab */}
      {activeTab === "tasks" && (
        <>
          {pendingItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("pending.title")}
                </h2>
                <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">
                  {pendingItems.length}
                </span>
              </div>
              <p className="text-xs text-gray-400">{t("pending.hint")}</p>
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
                      {t("pending.aiEval")}
                    </button>
                    {item.ideaStatus === "inbox" && (
                      <button
                        onClick={() => promoteToTask(item)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        {t("pending.addToTodo")}
                      </button>
                    )}
                    <button
                      onClick={() => archiveIdea(item)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors"
                    >
                      {t("pending.shelve")}
                    </button>
                    <button
                      onClick={() => deleteIdea(item)}
                      className="text-xs text-gray-300 hover:text-red-400 ml-auto transition-colors"
                    >
                      {t("pending.delete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {evaluated.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t("evaluated.title")}</h2>
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span className="text-indigo-500 font-medium">7+</span><span>{t("evaluated.high")}</span>
                  <span className="text-amber-500 font-medium">4–7</span><span>{t("evaluated.mid")}</span>
                  <span className="text-gray-400 font-medium">&lt;4</span><span>{t("evaluated.low")}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {evaluated.map((idea) => {
                  const isExpanded = expandedIds.has(idea.id);
                  const isDone = idea.taskStatus === "done";
                  const displayScore = selectedObjId
                    ? (idea.analysis!.objectiveScores.find((os) => os.objectiveId === selectedObjId)?.overallScore ?? idea.analysis!.finalScore)
                    : idea.analysis!.finalScore;
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
                          {reanalyzingIds.has(idea.id) && (
                            <span className="text-[10px] text-indigo-400 animate-pulse">{t("reanalyzingItem")}</span>
                          )}
                        </button>
                        <span
                          className={`text-xs font-bold font-mono px-2 py-0.5 rounded-lg shrink-0 ${
                            displayScore >= 7
                              ? "bg-indigo-50 text-indigo-600"
                              : displayScore >= 4
                              ? "bg-amber-50 text-amber-600"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {displayScore.toFixed(1)}
                        </span>
                        <select
                          value={idea.taskStatus ?? "todo"}
                          onChange={(e) => setTaskStatus(idea.id, e.target.value as TaskStatus)}
                          onClick={(e) => e.stopPropagation()}
                          className={`text-xs px-2 py-0.5 rounded-lg font-medium shrink-0 border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-300 ${taskStatusStyle[idea.taskStatus ?? "todo"]}`}
                        >
                          {(["todo", "in-progress", "done"] as TaskStatus[]).map((s) => (
                            <option key={s} value={s}>{taskStatusLabel[s]}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => toggleExpand(idea.id)}
                          className="text-gray-300 text-xs shrink-0 ml-1"
                        >
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t border-gray-50 space-y-2">
                          {idea.analysis!.summary && (
                            <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-2.5 py-1.5 leading-relaxed">
                              {idea.analysis!.summary}
                            </p>
                          )}
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
                              {t("action.shelve")}
                            </button>
                            <button
                              onClick={() => deleteIdea(idea)}
                              className="text-xs text-gray-300 hover:text-red-400"
                            >
                              {t("action.delete")}
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
            objectives.length === 0 ? (
              <div className="py-10 space-y-4">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wider text-center">{t("onboarding.title")}</p>
                {[
                  { step: "1", titleKey: "onboarding.step1.title", descKey: "onboarding.step1.desc", href: "/okr", ctaKey: "onboarding.step1.cta", active: true },
                  { step: "2", titleKey: "onboarding.step2.title", descKey: "onboarding.step2.desc", href: null, ctaKey: null, active: false },
                  { step: "3", titleKey: "onboarding.step3.title", descKey: "onboarding.step3.desc", href: null, ctaKey: null, active: false },
                ].map(({ step, titleKey, descKey, href, ctaKey, active }) => (
                  <div key={step} className={`flex gap-4 items-start rounded-xl border px-4 py-3 ${active ? "bg-indigo-50 border-indigo-100" : "bg-white border-gray-100 opacity-50"}`}>
                    <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${active ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-400"}`}>
                      {step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${active ? "text-indigo-800" : "text-gray-500"}`}>{t(titleKey)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t(descKey)}</p>
                    </div>
                    {href && ctaKey && (
                      <Link href={href} className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 mt-0.5">
                        {t(ctaKey)}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="text-4xl mb-3 text-gray-200">◎</div>
                <p className="text-sm text-gray-500">{t("noTasks.title")}</p>
                <p className="text-xs text-gray-400 mt-1 mb-5">{t("noTasks.hint")}</p>
                <button onClick={openNewModal} className="text-sm text-indigo-500 hover:text-indigo-700">
                  {t("noTasks.addFirst")}
                </button>
              </div>
            )
          )}
        </>
      )}

      {/* Shelved tab */}
      {activeTab === "shelved" && (
        <div className="space-y-2">
          {shelved.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-sm text-gray-400">{t("shelved.empty")}</p>
            </div>
          ) : (
            shelved.map((item) => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                <p className="text-sm text-gray-500 flex-1 truncate">{item.title}</p>
                <button
                  onClick={() => restoreIdea(item)}
                  className="text-xs text-indigo-500 hover:text-indigo-700 shrink-0"
                >
                  {t("action.restore")}
                </button>
                <button
                  onClick={() => deleteIdea(item)}
                  className="text-xs text-gray-300 hover:text-red-400 shrink-0"
                >
                  {t("action.delete")}
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
              <p className="text-sm text-gray-400">{t("deleted.empty")}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between pb-1">
                <p className="text-xs text-gray-400">{t("deleted.count", { n: deleted.length })}</p>
                <button
                  onClick={async () => {
                    const toDelete = [...deleted];
                    setIdeas((prev) => prev.filter((i) => i.ideaStatus !== "deleted"));
                    await Promise.all(toDelete.map((i) => removeIdea(i.id).catch(console.error)));
                  }}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  {t("action.clearAll")}
                </button>
              </div>
              {deleted.map((item) => (
                <div key={item.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                  <p className="text-sm text-gray-400 flex-1 truncate line-through">{item.title}</p>
                  <button onClick={() => restoreIdea(item)} className="text-xs text-gray-400 hover:text-indigo-600 shrink-0 transition-colors">{t("action.restore")}</button>
                  <button
                    onClick={async () => {
                      setIdeas((prev) => prev.filter((i) => i.id !== item.id));
                      await removeIdea(item.id).catch(console.error);
                    }}
                    className="text-xs text-red-300 hover:text-red-500 shrink-0 transition-colors"
                  >
                    {t("action.permanentDelete")}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
