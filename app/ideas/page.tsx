"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import { fetchIdeas } from "@/lib/db";
import type { Idea, IdeaDecision } from "@/lib/types";

function scoreColor(score: number): string {
  if (score >= 7) return "text-green-600";
  if (score >= 4) return "text-amber-500";
  return "text-red-400";
}

function decisionBadge(decision: IdeaDecision | undefined, zh: boolean) {
  switch (decision) {
    case "pursue":
      return <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium border border-indigo-100">{zh ? "追求中" : "Pursuing"}</span>;
    case "shelve":
      return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium border border-amber-100">{zh ? "擱置" : "Shelved"}</span>;
    case "abandon":
      return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium border border-gray-200">{zh ? "放棄" : "Abandoned"}</span>;
    default:
      return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200">{zh ? "未決定" : "Undecided"}</span>;
  }
}

export default function IdeasPage() {
  const { user, requireAuth } = useAuth();
  const { t, language } = useLanguage();
  const router = useRouter();
  const zh = language === "zh-TW";

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { requireAuth(); return; }
    fetchIdeas()
      .then((all) => {
        // Only show ideas that went through the validation flow (have a validationReport)
        const validated = all.filter((i) => i.validationReport);
        validated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setIdeas(validated);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const pursued = ideas.filter((i) => i.decision === "pursue");
  const shelved = ideas.filter((i) => i.decision === "shelve");
  const abandoned = ideas.filter((i) => i.decision === "abandon");
  const undecided = ideas.filter((i) => !i.decision);

  const shelvedOld = shelved.filter((i) => {
    const days = (Date.now() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return days >= 30;
  });

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">←</button>
          <span className="text-sm font-semibold text-gray-700">{t("ideas.archive.title")}</span>
        </div>
        <Link
          href="/ideas/new"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          {t("ideas.archive.new")}
        </Link>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {loading && (
          <div className="py-16 text-center text-sm text-gray-400">
            <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-2" />
            {zh ? "載入中…" : "Loading…"}
          </div>
        )}

        {!loading && ideas.length === 0 && (
          <div className="py-16 text-center space-y-4">
            <p className="text-4xl">💡</p>
            <p className="text-sm text-gray-400">{t("ideas.archive.empty")}</p>
            <Link
              href="/ideas/new"
              className="inline-block mt-2 px-5 py-2.5 rounded-2xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
            >
              {t("ideas.archive.new")}
            </Link>
          </div>
        )}

        {/* Shelved reminder banner */}
        {shelvedOld.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-amber-700">
              {t("ideas.archive.shelvedReminder").replace("{n}", String(shelvedOld.length))}
            </p>
            <button
              onClick={() => document.getElementById("section-shelved")?.scrollIntoView({ behavior: "smooth" })}
              className="text-xs font-semibold text-amber-700 hover:text-amber-800 whitespace-nowrap"
            >
              {t("ideas.archive.reviewShelved")}
            </button>
          </div>
        )}

        {/* Pursuing */}
        {pursued.length > 0 && (
          <Section
            title={t("ideas.archive.pursued")}
            dot="bg-indigo-400"
            ideas={pursued}
            zh={zh}
            onOpen={(id) => router.push(`/ideas/${id}`)}
          />
        )}

        {/* Shelved */}
        {shelved.length > 0 && (
          <Section
            id="section-shelved"
            title={t("ideas.archive.shelved")}
            dot="bg-amber-400"
            ideas={shelved}
            zh={zh}
            onOpen={(id) => router.push(`/ideas/${id}`)}
          />
        )}

        {/* Abandoned */}
        {abandoned.length > 0 && (
          <Section
            title={t("ideas.archive.abandoned")}
            dot="bg-gray-300"
            ideas={abandoned}
            zh={zh}
            muted
            onOpen={(id) => router.push(`/ideas/${id}`)}
          />
        )}

        {/* Undecided */}
        {undecided.length > 0 && (
          <Section
            title={zh ? "尚未決定" : "Undecided"}
            dot="bg-gray-200"
            ideas={undecided}
            zh={zh}
            onOpen={(id) => router.push(`/ideas/${id}`)}
          />
        )}

      </div>
    </div>
  );
}

function Section({
  id, title, dot, ideas, zh, muted, onOpen,
}: {
  id?: string;
  title: string;
  dot: string;
  ideas: Idea[];
  zh: boolean;
  muted?: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div id={id} className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          {title} · {ideas.length}
        </span>
      </div>
      {ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} zh={zh} muted={muted} onClick={() => onOpen(idea.id)} />
      ))}
    </div>
  );
}

function IdeaCard({ idea, zh, muted, onClick }: { idea: Idea; zh: boolean; muted?: boolean; onClick: () => void }) {
  const overall = idea.validationReport?.ikigai.overallScore;
  const date = new Date(idea.createdAt).toLocaleDateString(zh ? "zh-TW" : "en-US", { month: "short", day: "numeric" });

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border px-4 py-3.5 space-y-1.5 transition-colors hover:border-indigo-200 hover:bg-indigo-50/10 ${
        muted ? "border-gray-100 bg-gray-50/50" : "border-gray-100 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-medium leading-snug flex-1 ${muted ? "text-gray-400" : "text-gray-800"}`}>
          {idea.title}
        </p>
        {decisionBadge(idea.decision, zh)}
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>{date}</span>
        {overall !== undefined && (
          <span className={`font-semibold font-mono ${scoreColor(overall)}`}>
            {overall.toFixed(1)}/10
          </span>
        )}
        {idea.validationReport && (
          <span className="opacity-50">
            {zh ? "查看報告 →" : "View report →"}
          </span>
        )}
      </div>
    </button>
  );
}
