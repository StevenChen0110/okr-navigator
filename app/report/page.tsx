"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlignmentReport } from "@/lib/types";
import { fetchReports } from "@/lib/db";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";

function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function weekLabel(weekStart: string): string {
  const d = new Date(weekStart);
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const fmt = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}`;
  return `${d.getFullYear()} ${fmt(d)}–${fmt(end)}`;
}

function AlignmentBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-indigo-500" : score >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-600 w-8 text-right">{score}%</span>
    </div>
  );
}

export default function ReportListPage() {
  const { user, requireAuth } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const [reports, setReports] = useState<AlignmentReport[]>([]);
  const [loading, setLoading] = useState(true);

  const currentWeek = getWeekStart();

  useEffect(() => {
    if (!user) return;
    fetchReports()
      .then(setReports)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasCurrentWeek = reports.some((r) => r.weekStart === currentWeek);

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {language === "zh-TW" ? "對齊報告" : "Alignment Reports"}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {language === "zh-TW"
            ? "每週行動與目標的對齊程度"
            : "How well your weekly actions aligned with your goals"}
        </p>
      </div>

      {!hasCurrentWeek && (
        <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50 px-4 py-5 space-y-3">
          <p className="text-sm text-indigo-700 font-medium">
            {language === "zh-TW" ? "本週尚無報告" : "No report for this week yet"}
          </p>
          <p className="text-xs text-indigo-500">
            {language === "zh-TW"
              ? "記錄這週做了什麼，產出你的方向對齊報告"
              : "Log what you did this week to generate your alignment report"}
          </p>
          <button
            onClick={() => router.push("/tasks")}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            {language === "zh-TW" ? "開始本週記錄 →" : "Start this week's log →"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          {language === "zh-TW" ? "還沒有任何報告" : "No reports yet"}
        </p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => user ? router.push(`/report/${r.weekStart}`) : requireAuth()}
              className="w-full text-left rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">{weekLabel(r.weekStart)}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <AlignmentBar score={r.alignmentScore} />
              <p className="text-xs text-gray-500 line-clamp-1">{r.aiInsight}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
