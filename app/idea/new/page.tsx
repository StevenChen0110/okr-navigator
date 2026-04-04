"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Objective, Idea } from "@/lib/types";
import { getObjectives, getSettings, upsertIdea } from "@/lib/storage";
import { analyzeIdea } from "@/lib/claude";
import ScoreBar from "@/components/ScoreBar";
import Link from "next/link";

type Status = "idle" | "analyzing" | "done" | "error";

export default function NewIdeaPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [idea, setIdea] = useState<Idea | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    setObjectives(getObjectives());
  }, []);

  async function handleAnalyze() {
    if (!title.trim() || !description.trim()) return;
    const settings = getSettings();
    if (!settings.claudeApiKey) {
      setErrorMsg("請先在設定頁輸入 Claude API Key");
      setStatus("error");
      return;
    }
    if (objectives.length === 0) {
      setErrorMsg("請先在「OKR 目標」頁面建立至少一個目標");
      setStatus("error");
      return;
    }

    setStatus("analyzing");
    setErrorMsg("");

    try {
      const analysis = await analyzeIdea(
        settings.claudeApiKey,
        settings.claudeModel,
        title,
        description,
        objectives
      );
      const newIdea: Idea = {
        id: uuid(),
        title,
        description,
        analysis,
        createdAt: new Date().toISOString(),
      };
      upsertIdea(newIdea);
      setIdea(newIdea);
      setStatus("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "分析失敗，請確認 API Key 是否正確");
      setStatus("error");
    }
  }

  if (status === "done" && idea?.analysis) {
    const { analysis } = idea;
    return (
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{idea.title}</h1>
            <p className="text-sm text-gray-500 mt-1">{idea.description}</p>
          </div>
          <div className="flex flex-col items-center bg-white border border-gray-200 rounded-xl px-4 py-3 shrink-0 ml-4">
            <span className="text-3xl font-bold text-indigo-600">{analysis.finalScore.toFixed(1)}</span>
            <span className="text-xs text-gray-400 mt-0.5">綜合優先分</span>
          </div>
        </div>

        {/* Objective Scores */}
        <div className="space-y-4">
          {analysis.objectiveScores.map((os) => (
            <div key={os.objectiveId} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-sm">{os.objectiveTitle}</h3>
                <span className={`text-sm font-bold ${os.overallScore >= 7 ? "text-indigo-600" : os.overallScore >= 4 ? "text-amber-500" : "text-red-500"}`}>
                  {os.overallScore.toFixed(1)} / 10
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-4">{os.reasoning}</p>
              <div className="space-y-2">
                {os.keyResultScores.map((krs) => (
                  <div key={krs.keyResultId}>
                    <ScoreBar score={krs.score} label={krs.keyResultTitle} />
                    <p className="text-xs text-gray-400 mt-0.5 pl-0">{krs.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Risks */}
        {analysis.risks.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <h3 className="text-sm font-medium text-red-700 mb-2">⚠ 風險與副作用</h3>
            <ul className="space-y-1">
              {analysis.risks.map((r, i) => (
                <li key={i} className="text-xs text-red-600 flex gap-2">
                  <span>•</span><span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Suggestions */}
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

        <div className="flex gap-3 pt-2">
          <Link
            href="/"
            className="flex-1 py-2 text-center rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            回到 Dashboard
          </Link>
          <button
            onClick={() => {
              setStatus("idle");
              setIdea(null);
              setTitle("");
              setDescription("");
            }}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            再分析一個
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-10">
      <h1 className="text-xl font-semibold mb-1">新增 Idea</h1>
      <p className="text-sm text-gray-500 mb-8">描述你的想法，AI 將分析它對 OKR 的貢獻</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Idea 標題</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="用一句話描述你的想法"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">詳細描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="這個想法的細節、動機、預期效果…"
            rows={5}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        {status === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600">
            {errorMsg}
          </div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={status === "analyzing" || !title.trim() || !description.trim()}
          className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "analyzing" ? "AI 分析中…" : "分析 Idea"}
        </button>

        {status === "analyzing" && (
          <p className="text-center text-xs text-gray-400 animate-pulse">
            正在向 Claude 請求分析，通常需要 5-15 秒…
          </p>
        )}
      </div>
    </div>
  );
}
