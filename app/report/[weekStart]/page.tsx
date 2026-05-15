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

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push("/report")}
          className="text-xs text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {language === "zh-TW" ? "報告歷史" : "Report History"}
        </button>
        <h1 className="text-xl font-semibold text-gray-900">{weekLabel(weekStart)}</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {language === "zh-TW" ? "方向對齊報告" : "Direction Alignment Report"}
        </p>
      </div>

      {/* Score */}
      <div className="flex flex-col items-center py-6 bg-white rounded-2xl border border-gray-100">
        <ScoreRing score={report.alignmentScore} scale="0-100" size={96} />
        <p className="text-sm font-medium text-gray-600 mt-3">
          {language === "zh-TW" ? "方向對齊率" : "Alignment Score"}
        </p>
      </div>

      {/* AI Insight */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {language === "zh-TW" ? "觀察" : "Insight"}
        </h2>
        <p className="text-sm text-gray-700 leading-relaxed">{report.aiInsight}</p>
      </div>

      {/* Suggestions */}
      {report.suggestions.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {language === "zh-TW" ? "可以考慮的方向" : "Directions to Consider"}
          </h2>
          <ul className="space-y-2">
            {report.suggestions.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="text-indigo-400 shrink-0">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTAs */}
      <div className="flex gap-3">
        <button
          onClick={() => router.push("/okr")}
          className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          {language === "zh-TW" ? "調整目標方向" : "Adjust Goals"}
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          {chatOpen
            ? (language === "zh-TW" ? "收起討論" : "Close Chat")
            : (language === "zh-TW" ? "跟 AI 討論" : "Discuss with AI")}
        </button>
      </div>

      {/* Chat */}
      {chatOpen && (
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <div className="max-h-60 overflow-y-auto p-3 space-y-2 bg-gray-50">
            {messages.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-2">
                {language === "zh-TW"
                  ? "對這週的報告有什麼想聊的嗎？"
                  : "Want to discuss anything about this report?"}
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
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
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
              placeholder={language === "zh-TW" ? "輸入想法…" : "Type a message…"}
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
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {language === "zh-TW" ? "本週行動明細" : "Weekly Actions"}
          </h2>
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {[...planned, ...unplanned].map((item) => (
              <div key={item.id} className="flex items-start gap-2 px-3 py-2.5">
                <span className={`mt-0.5 text-sm shrink-0 ${item.isPlanned ? "text-indigo-500" : "text-gray-300"}`}>
                  {item.isPlanned ? "✓" : "○"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{item.content}</p>
                  {item.krTitle && (
                    <p className="text-xs text-indigo-400 mt-0.5 truncate">→ {item.krTitle}</p>
                  )}
                  {!item.isPlanned && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {language === "zh-TW" ? "計劃外" : "Off-goal"}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
