"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { Objective, Milestone, MilestoneSuggestion } from "@/lib/types";
import { fetchObjectives } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import { getObjectiveRoadmap, saveObjectiveRoadmap, getChatHistory, saveChatHistory } from "@/lib/storage";

interface UIMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: MilestoneSuggestion;
  isLoading?: boolean;
}

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

export default function RoadmapPage() {
  const { user, requireAuth } = useAuth();
  const { t, language } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [objective, setObjective] = useState<Objective | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [appliedIndices, setAppliedIndices] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<"milestones" | "chat">("milestones");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) { requireAuth(); router.replace("/"); return; }
    fetchObjectives().then((objs) => {
      const obj = objs.find((o) => o.id === id);
      if (!obj) { router.replace("/okr"); return; }
      setObjective(obj);
      setMilestones(getObjectiveRoadmap(id));
      const stored = getChatHistory(`roadmap_${id}`);
      setMessages(stored.map((m) => ({ role: m.role, content: m.content })));
    }).catch(console.error);
  }, [user, id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0) return;
    saveChatHistory(`roadmap_${id}`, messages.filter((m) => !m.isLoading).map((m) => ({ role: m.role, content: m.content })));
  }, [messages, id]);

  async function handleGenerate() {
    if (!objective || generating) return;
    setGenerating(true);
    try {
      const result = await callAI<Milestone[]>("generateRoadmap", { objective });
      setMilestones(result.map((m, i) => ({ ...m, id: m.id || uuid(), order: m.order ?? i + 1 })));
      setSaved(false);
    } catch (e) { console.error(e); }
    finally { setGenerating(false); }
  }

  function handleSave() {
    saveObjectiveRoadmap(id, milestones);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateMilestone(mid: string, field: "title" | "timeframe", value: string) {
    setMilestones((prev) => prev.map((m) => m.id === mid ? { ...m, [field]: value } : m));
    setSaved(false);
  }

  function removeMilestone(mid: string) {
    setMilestones((prev) => prev.filter((m) => m.id !== mid));
    setSaved(false);
  }

  function addMilestone() {
    setMilestones((prev) => [...prev, { id: uuid(), title: "", timeframe: "", order: prev.length + 1 }]);
    setSaved(false);
  }

  function applyMilestoneSuggestion(s: MilestoneSuggestion, idx: number) {
    setMilestones((prev) => {
      let next = [...prev];
      for (const item of s.milestones) {
        if (item.action === "add") {
          next.push({ id: uuid(), title: item.title, timeframe: item.timeframe, order: item.order ?? next.length + 1 });
        } else if (item.action === "update" && item.id) {
          next = next.map((m) => m.id === item.id ? { ...m, title: item.title, timeframe: item.timeframe ?? m.timeframe, order: item.order ?? m.order } : m);
        } else if (item.action === "remove" && item.id) {
          next = next.filter((m) => m.id !== item.id);
        }
      }
      return next.sort((a, b) => a.order - b.order);
    });
    setAppliedIndices((prev) => new Set([...prev, idx]));
    setSaved(false);
  }

  async function sendChat(text: string) {
    if (!objective || chatLoading) return;
    const userMsg: UIMessage = { role: "user", content: text };
    const history = messages.filter((m) => !m.isLoading);
    const newHistory = [...history, userMsg];
    setMessages([...newHistory, { role: "assistant", content: "", isLoading: true }]);
    setChatLoading(true);
    try {
      const apiMessages = newHistory.map((m) => ({ role: m.role, content: m.content }));
      const result = await callAI<{ content: string; suggestion?: MilestoneSuggestion }>("chatRoadmap", {
        messages: apiMessages, objective, milestones,
      });
      setMessages([...newHistory, { role: "assistant", content: sanitize(result.content), suggestion: result.suggestion }]);
    } catch {
      setMessages([...newHistory, { role: "assistant", content: language === "zh-TW" ? "發生錯誤，請再試一次。" : "An error occurred. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleChatSend() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput("");
    sendChat(text);
  }

  if (!objective) {
    return <div className="flex items-center justify-center h-screen text-sm text-gray-400">載入中…</div>;
  }

  const milestonesPanel = (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-xl transition-colors"
        >
          {generating ? t("roadmap.generating") : t("roadmap.generateBtn")}
        </button>
        <button
          onClick={handleSave}
          disabled={milestones.length === 0}
          className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-4 py-2 rounded-xl disabled:opacity-40 transition-colors"
        >
          {saved ? t("roadmap.saved") : t("roadmap.save")}
        </button>
      </div>

      {milestones.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-gray-400">{t("roadmap.empty")}</p>
          <p className="text-xs text-gray-300 mt-1">{t("roadmap.emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {milestones.map((m, i) => (
            <div key={m.id} className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
              <span className="text-xs text-gray-300 font-mono mt-2.5 shrink-0 w-5 text-right">{i + 1}</span>
              <div className="flex-1 space-y-1.5 min-w-0">
                <input
                  value={m.title}
                  onChange={(e) => updateMilestone(m.id, "title", e.target.value)}
                  placeholder={t("roadmap.placeholder")}
                  className="w-full text-sm text-gray-800 bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1 -mx-1"
                />
                <input
                  value={m.timeframe ?? ""}
                  onChange={(e) => updateMilestone(m.id, "timeframe", e.target.value)}
                  placeholder={t("roadmap.timeframePlaceholder")}
                  className="w-full text-xs text-gray-400 bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded px-1 -mx-1"
                />
              </div>
              <button onClick={() => removeMilestone(m.id)} className="text-gray-200 hover:text-red-400 text-xl leading-none shrink-0 mt-1 transition-colors">×</button>
            </div>
          ))}
        </div>
      )}

      <button onClick={addMilestone} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
        {t("roadmap.addMilestone")}
      </button>
    </div>
  );

  const chatPanel = (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">{t("roadmap.chat.welcome")}</p>
        )}
        {messages.map((msg, idx) => (
          <div key={idx}>
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${msg.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-800"}`}>
                {msg.isLoading
                  ? <span className="text-xs opacity-50 animate-pulse">{language === "zh-TW" ? "思考中…" : "Thinking…"}</span>
                  : <p className="whitespace-pre-wrap">{msg.content}</p>
                }
              </div>
            </div>
            {msg.suggestion && !msg.isLoading && (
              <div className="mt-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                <p className="text-[11px] font-medium text-indigo-500 mb-2">{t("roadmap.suggestion")}</p>
                <div className="space-y-1">
                  {msg.suggestion.milestones.map((item, gi) => (
                    <p key={gi} className={`text-xs ${item.action === "remove" ? "text-red-400 line-through" : "text-indigo-700"}`}>
                      {item.action === "remove" ? `— ${item.title || "(remove)"}` : `${item.action === "add" ? "+" : "~"} ${item.title}${item.timeframe ? ` (${item.timeframe})` : ""}`}
                    </p>
                  ))}
                </div>
                <button
                  onClick={() => applyMilestoneSuggestion(msg.suggestion!, idx)}
                  disabled={appliedIndices.has(idx)}
                  className="mt-3 w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
                >
                  {appliedIndices.has(idx) ? t("roadmap.applied") : t("roadmap.apply")}
                </button>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="shrink-0 px-3 pb-3 pt-2 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleChatSend(); }}
            placeholder={language === "zh-TW" ? "輸入訊息…" : "Type a message…"}
            disabled={chatLoading}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
          <button
            onClick={handleChatSend}
            disabled={!chatInput.trim() || chatLoading}
            className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {language === "zh-TW" ? "送出" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 px-4 py-4 md:px-6">
        <Link href="/okr" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">{t("roadmap.back")}</Link>
        <h1 className="text-lg font-semibold text-gray-800 mt-1 truncate">{objective.title}</h1>
        <div className="mt-1.5 space-y-0.5">
          {objective.keyResults.map((kr) => (
            <p key={kr.id} className="text-xs text-gray-400">— {kr.title}</p>
          ))}
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden shrink-0 flex border-b border-gray-100">
        {(["milestones", "chat"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === tab ? "text-indigo-600 border-b-2 border-indigo-600" : "text-gray-400"}`}
          >
            {tab === "milestones" ? (language === "zh-TW" ? "里程碑" : "Milestones") : (language === "zh-TW" ? "AI 討論" : "AI Chat")}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Milestones — full width on mobile, left column on desktop */}
        <div className={`flex-1 min-w-0 overflow-y-auto px-4 py-5 md:px-6 ${activeTab !== "milestones" ? "hidden lg:block" : ""}`}>
          {milestonesPanel}
        </div>

        {/* Chat — hidden on mobile unless tab active, right panel on desktop */}
        <div className={`lg:w-[380px] lg:shrink-0 lg:border-l lg:border-gray-100 flex flex-col min-h-0 ${activeTab !== "chat" ? "hidden lg:flex" : "flex flex-1"}`}>
          {chatPanel}
        </div>
      </div>
    </div>
  );
}
