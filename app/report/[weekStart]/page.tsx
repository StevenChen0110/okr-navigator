"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { AlignmentReport, LogItem, StoredMessage } from "@/lib/types";
import { fetchReport, fetchLogItems } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import ScoreRing from "@/components/ScoreRing";

function weekLabel(weekStart: string): string {
  const d = new Date(weekStart);
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const fmt = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}`;
  return `${d.getFullYear()}年 ${fmt(d)}–${fmt(end)}`;
}

export default function ReportPage() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const weekStart = params.weekStart as string;
  const zh = language === "zh-TW";

  const [report, setReport] = useState<AlignmentReport | null>(null);
  const [logItems, setLogItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    if (!user || !weekStart) return;
    fetchReport(weekStart)
      .then(async (r) => {
        if (!r) { router.replace("/report"); return; }
        setReport(r);
        const items = await fetchLogItems(r.logId);
        setLogItems(items);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.id, weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleChat() {
    const text = chatInput.trim();
    if (!text || chatLoading || !report) return;
    setChatInput("");
    const next: StoredMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setChatLoading(true);
    try {
      const { content } = await callAI<{ content: string }>("chatPlanCoach", {
        messages: next,
        context: {
          type: "plan",
          overallAssessment: report.aiInsight,
          suggestions: report.suggestions.join("\n"),
        },
        objectives: [],
      });
      setMessages([...next, { role: "assistant", content }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: String(e) }]);
    } finally {
      setChatLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 flex justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!report) return null;

  const planned = logItems.filter((i) => i.isPlanned);
  const unplanned = logItems.filter((i) => !i.isPlanned);
  const alignPct = logItems.length > 0 ? Math.round((planned.length / logItems.length) * 100) : 0;

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-4">

      {/* Back + header */}
      <div>
        <button
          onClick={() => router.push("/report")}
          className="text-xs text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {zh ? "報告歷史" : "Report History"}
        </button>
        <h1 className="text-xl font-semibold text-gray-900">{weekLabel(weekStart)}</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {zh ? "方向對齊報告" : "Direction Alignment Report"}
        </p>
      </div>

      {/* Score card — horizontal layout with stats */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-5">
          <ScoreRing score={report.alignmentScore} scale="0-100" size={80} />
          <div className="flex-1 space-y-3">
            <p className="text-xs text-gray-400">{zh ? "方向對齊率" : "Alignment Score"}</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xl font-bold text-indigo-600">{planned.length}</p>
                <p className="text-[11px] text-gray-400">{zh ? "對齊目標" : "On-goal"}</p>
              </div>
              <div>
                <p className="text-xl font-bold text-gray-400">{unplanned.length}</p>
                <p className="text-[11px] text-gray-400">{zh ? "計劃外" : "Off-goal"}</p>
              </div>
              <div>
                <p className="text-xl font-bold text-gray-700">{logItems.length}</p>
                <p className="text-[11px] text-gray-400">{zh ? "總行動" : "Total"}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Insight card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-2">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
          {zh ? "AI 觀察" : "Insight"}
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">{report.aiInsight}</p>
      </div>

      {/* Suggestions — visual numbered cards */}
      {report.suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest px-1">
            {zh ? "可以考慮的方向" : "Directions to Consider"}
          </p>
          {report.suggestions.map((s, i) => (
            <div key={i} className="bg-indigo-50 rounded-2xl border border-indigo-100 p-4 flex gap-3 items-start">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <p className="text-sm text-indigo-900 leading-relaxed flex-1">{s}</p>
            </div>
          ))}
        </div>
      )}

      {/* CTAs */}
      <div className="flex gap-3">
        <button
          onClick={() => router.push("/okr")}
          className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          {zh ? "調整目標方向" : "Adjust Goals"}
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          {chatOpen
            ? (zh ? "收起" : "Close")
            : (zh ? "跟 AI 討論" : "Discuss with AI")}
        </button>
      </div>

      {/* Chat */}
      {chatOpen && (
        <div className="rounded-2xl border border-gray-100 overflow-hidden">
          <div className="max-h-60 overflow-y-auto p-3 space-y-2 bg-gray-50">
            {messages.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">
                {zh ? "對這份報告有什麼想聊的？" : "Anything you want to discuss about this report?"}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-indigo-600 text-white" : "bg-white text-gray-700 border border-gray-100"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-100 rounded-xl px-3 py-2">
                  <span className="inline-flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2 p-2 border-t border-gray-100 bg-white">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleChat()}
              placeholder={zh ? "輸入想法…" : "Type a message…"}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={handleChat}
              disabled={!chatInput.trim() || chatLoading}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-40 hover:bg-indigo-700 transition-colors"
            >
              →
            </button>
          </div>
        </div>
      )}

      {/* Log Items Breakdown */}
      {logItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
              {zh ? "本週行動明細" : "Weekly Actions"}
            </p>
            <p className="text-xs text-gray-400">{alignPct}% {zh ? "對齊" : "aligned"}</p>
          </div>

          {/* Alignment bar */}
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${alignPct}%` }}
            />
          </div>

          {/* Planned items */}
          {planned.length > 0 && (
            <div className="space-y-2">
              {planned.map((item) => (
                <div key={item.id} className="flex items-start gap-3 p-3 rounded-xl bg-indigo-50 border border-indigo-100">
                  <span className="mt-0.5 text-indigo-500 shrink-0 text-base">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 leading-snug">{item.content}</p>
                    {item.krTitle && (
                      <span className="inline-block mt-1.5 text-[11px] bg-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                        {item.krTitle}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Unplanned items */}
          {unplanned.length > 0 && (
            <div className="space-y-2">
              {unplanned.map((item) => (
                <div key={item.id} className="flex items-start gap-3 p-3 rounded-xl bg-white border border-gray-100">
                  <span className="mt-0.5 text-gray-300 shrink-0 text-base">○</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-600 leading-snug">{item.content}</p>
                    <span className="inline-block mt-1.5 text-[11px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">
                      {zh ? "計劃外" : "Off-goal"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
