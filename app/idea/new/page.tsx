"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, KeyResult, Idea, IdeaKRLink, IdeaAnalysis } from "@/lib/types";
import { fetchObjectives, saveIdea } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import ScoreBar from "@/components/ScoreBar";
import Markdown from "@/components/Markdown";
import Link from "next/link";

type Status = "idle" | "clarifying" | "analyzing" | "confirm" | "saving" | "done" | "error";

interface SuggestedLink {
  objectiveId: string;
  objectiveTitle: string;
  krId: string;
  krTitle: string;
  score: number;
}

function calcKRCompletion(kr: KeyResult): number | undefined {
  if (!kr.targetValue) return undefined;
  if (kr.krType === "milestone") return kr.currentValue ? 100 : 0;
  return Math.min(100, ((kr.currentValue ?? 0) / kr.targetValue) * 100);
}

function buildProgressContext(objectives: Objective[]): string {
  return objectives.map((o) => {
    const krLines = o.keyResults.map((kr) => {
      const pct = calcKRCompletion(kr);
      const pctStr = pct !== undefined ? ` (${Math.round(pct)}% complete)` : "";
      return `    - ${kr.title}${pctStr}`;
    }).join("\n");
    return `${o.title}:\n${krLines}`;
  }).join("\n\n");
}

export default function NewIdeaPage() {
  const searchParams = useSearchParams();
  const preselectedKrId = searchParams.get("krId") ?? undefined;
  const preselectedObjectiveId = searchParams.get("objectiveId") ?? undefined;

  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [analysis, setAnalysis] = useState<IdeaAnalysis | null>(null);
  const [suggestedLinks, setSuggestedLinks] = useState<SuggestedLink[]>([]);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState("");
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");

  useEffect(() => {
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  const hasDetails = why.trim() || outcome.trim() || notes.trim();
  const isQuickMode = !hasDetails;

  async function runAnalysis(extraNotes?: string) {
    setStatus("analyzing");
    setErrorMsg("");

    try {
      const progressContext = buildProgressContext(objectives);
      const combinedNotes = [notes, extraNotes].filter(Boolean).join("\n");

      const result = await callAI<IdeaAnalysis>("analyzeIdea", {
        ideaTitle: title, ideaWhy: why, ideaOutcome: outcome, ideaNotes: combinedNotes,
        objectives, progressContext,
      });
      setAnalysis(result);

      const links: SuggestedLink[] = [];
      for (const os of result.objectiveScores) {
        for (const krs of os.keyResultScores) {
          if (krs.score >= 5) {
            links.push({
              objectiveId: os.objectiveId,
              objectiveTitle: os.objectiveTitle,
              krId: krs.keyResultId,
              krTitle: krs.keyResultTitle,
              score: krs.score,
            });
          }
        }
      }
      links.sort((a, b) => b.score - a.score);

      // Force-include the KR that was preselected from the OKR page (if not already in list)
      if (preselectedKrId && preselectedObjectiveId) {
        const obj = objectives.find((o) => o.id === preselectedObjectiveId);
        const kr = obj?.keyResults.find((k) => k.id === preselectedKrId);
        if (kr && !links.some((l) => l.krId === preselectedKrId)) {
          links.push({
            objectiveId: preselectedObjectiveId,
            objectiveTitle: obj!.title,
            krId: preselectedKrId,
            krTitle: kr.title,
            score: 0,
          });
        }
      }

      setSuggestedLinks(links);
      const initialSelected = new Set(links.filter((l) => l.score >= 7).map((l) => l.krId));
      if (preselectedKrId) initialSelected.add(preselectedKrId);
      setSelectedLinkIds(initialSelected);
      setStatus("confirm");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "分析失敗，請確認 API Key 是否正確");
      setStatus("error");
    }
  }

  async function handleAnalyze() {
    if (!title.trim()) return;
    if (objectives.length === 0) { setErrorMsg("請先建立至少一個 OKR 目標"); setStatus("error"); return; }

    setErrorMsg("");

    // In quick mode, run clarification gate first
    if (isQuickMode) {
      setStatus("clarifying");
      try {
        const { shouldClarify, question } = await callAI<{ shouldClarify: boolean; question: string }>(
          "clarifyIdea", { ideaTitle: title, objectives }
        );
        if (shouldClarify && question) {
          setClarifyQuestion(question);
          setClarifyAnswer("");
          return; // wait for user to answer
        }
      } catch {
        // Clarification failed — proceed directly
      }
    }

    await runAnalysis();
  }

  async function handleConfirm() {
    if (!analysis) return;
    setStatus("saving");

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
      quickAnalysis: isQuickMode,
    };

    try {
      await saveIdea(newIdea);
      setStatus("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "儲存失敗");
      setStatus("confirm");
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
    setStatus("idle");
    setAnalysis(null);
    setSuggestedLinks([]);
    setSelectedLinkIds(new Set());
    setClarifyQuestion(""); setClarifyAnswer("");
    setTitle(""); setWhy(""); setOutcome(""); setNotes(""); setDetailsOpen(false);
  }

  // ── Clarification gate ───────────────────────────────────────────────────────

  if (status === "clarifying" && clarifyQuestion) {
    return (
      <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10">
        <h1 className="text-xl font-semibold mb-1">快速評估</h1>
        <p className="text-sm text-gray-500 mb-6">{title}</p>
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">{clarifyQuestion}</p>
            <textarea
              value={clarifyAnswer}
              onChange={(e) => setClarifyAnswer(e.target.value)}
              placeholder="簡單說明即可…"
              rows={3}
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => runAnalysis()}
              className="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors"
            >
              跳過
            </button>
            <button
              onClick={() => runAnalysis(clarifyAnswer.trim() || undefined)}
              disabled={!clarifyAnswer.trim()}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              繼續分析
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Waiting for clarifyIdea response (question not yet received)
  if (status === "clarifying" && !clarifyQuestion) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 text-center">
        <div className="text-4xl mb-4 animate-pulse">◎</div>
        <p className="text-sm text-gray-500">思考中…</p>
      </div>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────────

  if (status === "done") {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 text-center space-y-4">
        <div className="text-4xl">✓</div>
        <h1 className="text-lg font-semibold">Idea 已儲存</h1>
        <p className="text-sm text-gray-500">{title}</p>
        <div className="flex gap-3 pt-4">
          <Link href="/" className="flex-1 py-2.5 text-center rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
            回到 Dashboard
          </Link>
          <button onClick={resetForm} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
            再分析一個
          </button>
        </div>
      </div>
    );
  }

  // ── Confirm step (analysis + KR links) ───────────────────────────────────────

  if (status === "confirm" && analysis) {
    const isOffTrack = analysis.objectiveScores.length > 0 &&
      analysis.objectiveScores.every((os) => os.overallScore < 3);

    return (
      <div className="max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-6">
        {isOffTrack && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
            這個 Idea 與你目前所有 OKR 的關聯度都很低，確定現在要投入嗎？
          </div>
        )}

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-sm text-gray-400 mt-1">分析結果</p>
          </div>
          <div className="flex flex-col items-center bg-white border border-gray-200 rounded-xl px-4 py-3 shrink-0 ml-4">
            <span className="text-3xl font-bold text-indigo-600">{analysis.finalScore.toFixed(1)}</span>
            <span className="text-xs text-gray-400 mt-0.5">綜合優先分</span>
          </div>
        </div>

        <div className="space-y-4">
          {analysis.objectiveScores.map((os) => (
            <div key={os.objectiveId} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm">{os.objectiveTitle}</h3>
                <span className={`text-sm font-bold ${os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-500"}`}>
                  {os.overallScore.toFixed(1)} / 10
                </span>
              </div>
              <Markdown className="text-xs text-gray-500 mb-3">{os.reasoning}</Markdown>
              <div className="space-y-2">
                {os.keyResultScores.map((krs) => (
                  <div key={krs.keyResultId}>
                    <ScoreBar score={krs.score} label={krs.keyResultTitle} />
                    <Markdown className="text-xs text-gray-400 mt-0.5">{krs.reasoning}</Markdown>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {analysis.risks.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <h3 className="text-sm font-medium text-red-700 mb-2">風險與副作用</h3>
            <ul className="space-y-1">
              {analysis.risks.map((r, i) => (
                <li key={i} className="text-xs text-red-600 flex gap-2"><span>•</span><span>{r}</span></li>
              ))}
            </ul>
          </div>
        )}

        {analysis.executionSuggestions.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
            <h3 className="text-sm font-medium text-indigo-700 mb-2">執行建議</h3>
            <ol className="space-y-1">
              {analysis.executionSuggestions.map((s, i) => (
                <li key={i} className="text-xs text-indigo-600 flex gap-2">
                  <span className="font-semibold shrink-0">{i + 1}.</span><span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {suggestedLinks.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-medium text-gray-700 mb-1">連結至 KR</h3>
            <p className="text-xs text-gray-400 mb-3">AI 建議此 Idea 對以下 KR 有貢獻，確認或調整</p>
            <div className="space-y-2">
              {suggestedLinks.map((l) => (
                <label key={l.krId} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedLinkIds.has(l.krId)}
                    onChange={() => toggleLink(l.krId)}
                    className="mt-0.5 accent-indigo-600 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700">{l.krTitle}</p>
                    <p className="text-xs text-gray-400">{l.objectiveTitle}</p>
                  </div>
                  <span className={`text-xs font-bold shrink-0 ${l.score >= 7 ? "text-indigo-600" : "text-amber-500"}`}>
                    {l.score.toFixed(1)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600">{errorMsg}</div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={resetForm}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ← 重新輸入
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            確認並儲存 →
          </button>
        </div>
      </div>
    );
  }

  // ── Saving ────────────────────────────────────────────────────────────────────

  if (status === "saving") {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 text-center">
        <div className="text-4xl mb-4 animate-pulse">◎</div>
        <p className="text-sm text-gray-500">儲存中…</p>
      </div>
    );
  }

  // ── Input form ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-xl font-semibold mb-1">新增 Idea</h1>
      <p className="text-sm text-gray-500 mb-8">描述你的想法，AI 將分析它對 OKR 的貢獻</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">名稱</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="用一句話描述你的想法"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Collapsible details */}
        <div>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <span className={`transition-transform ${detailsOpen ? "rotate-90" : ""}`}>›</span>
            補充說明（選填）
            {hasDetails && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
          </button>

          {detailsOpen && (
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  為什麼要做？
                </label>
                <textarea
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  placeholder="背景、問題、動機…"
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  預期成效
                </label>
                <textarea
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  placeholder="做了之後會有什麼改變…"
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  備註
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="其他補充…"
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {status === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600">{errorMsg}</div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={status === "analyzing" || !title.trim()}
          className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "analyzing" ? "AI 分析中…" : isQuickMode ? "快速評估" : "完整分析"}
        </button>

        {status === "analyzing" && (
          <p className="text-center text-xs text-gray-400 animate-pulse">正在向 Claude 請求分析，通常需要 5-15 秒…</p>
        )}
      </div>
    </div>
  );
}
