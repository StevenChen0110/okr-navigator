"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Idea, Objective } from "@/lib/types";
import { fetchIdeas, fetchObjectives, removeIdea } from "@/lib/db";
import ScoreBar from "@/components/ScoreBar";

type SortKey = "score" | "date";

export default function DashboardPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [sort, setSort] = useState<SortKey>("score");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchIdeas().then(setIdeas).catch(console.error);
    fetchObjectives().then(setObjectives).catch(console.error);
  }, []);

  function handleDelete(id: string) {
    if (!confirm("確定要刪除這個 Idea？")) return;
    removeIdea(id).catch(console.error);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  const sorted = [...ideas].sort((a, b) => {
    if (sort === "score") {
      return (b.analysis?.finalScore ?? -1) - (a.analysis?.finalScore ?? -1);
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const totalKRs = objectives.reduce((acc, o) => acc + o.keyResults.length, 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-10">
      {/* OKR Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="目標數 (O)" value={objectives.length} />
        <StatCard label="量化指標 (KR)" value={totalKRs} />
        <StatCard label="已分析 Ideas" value={ideas.filter((i) => i.analysis).length} />
      </div>

      {/* Ideas */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-base">Ideas 排行榜</h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(["score", "date"] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                sort === k ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
              }`}
            >
              {k === "score" ? "依優先分" : "依時間"}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <div className="text-4xl mb-3">💡</div>
          <p className="text-sm text-gray-500 mb-4">還沒有 Idea，開始分析你的第一個想法</p>
          <Link
            href="/idea/new"
            className="inline-block px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          >
            + 新增 Idea
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((idea, idx) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              rank={idx + 1}
              expanded={expandedId === idea.id}
              onToggle={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
              onDelete={() => handleDelete(idea.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-2xl font-bold text-indigo-600">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function IdeaCard({
  idea,
  rank,
  expanded,
  onToggle,
  onDelete,
}: {
  idea: Idea;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const score = idea.analysis?.finalScore;
  const scoreColor =
    score === undefined
      ? "text-gray-400"
      : score >= 7
      ? "text-indigo-600"
      : score >= 4
      ? "text-amber-500"
      : "text-red-500";

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-center gap-4"
      >
        <span className="text-sm font-bold text-gray-300 w-5 shrink-0">#{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{idea.title}</div>
          <div className="text-xs text-gray-400 truncate mt-0.5">{idea.description}</div>
        </div>
        {score !== undefined ? (
          <span className={`text-xl font-bold shrink-0 ${scoreColor}`}>
            {score.toFixed(1)}
          </span>
        ) : (
          <span className="text-xs text-gray-300 shrink-0">未分析</span>
        )}
        <span className="text-gray-300 text-sm">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && idea.analysis && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {idea.analysis.objectiveScores.map((os) => (
            <div key={os.objectiveId}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-gray-700">{os.objectiveTitle}</span>
                <span
                  className={`text-xs font-bold ${
                    os.overallScore >= 7
                      ? "text-indigo-600"
                      : os.overallScore >= 4
                      ? "text-amber-500"
                      : "text-red-500"
                  }`}
                >
                  {os.overallScore.toFixed(1)}
                </span>
              </div>
              <div className="space-y-1 pl-2">
                {os.keyResultScores.map((krs) => (
                  <ScoreBar key={krs.keyResultId} score={krs.score} label={krs.keyResultTitle} />
                ))}
              </div>
            </div>
          ))}

          {idea.analysis.risks.length > 0 && (
            <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
              <span className="font-medium">風險：</span>
              {idea.analysis.risks.join("；")}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={onDelete}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              刪除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
