"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Objective, ObjGroup, GroupSequencePhase, GroupSequenceSuggestion } from "@/lib/types";
import { fetchObjectives } from "@/lib/db";
import { callAI } from "@/lib/ai-client";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import { getObjGroups, getGroupRoadmap, saveGroupRoadmap, getChatHistory, saveChatHistory } from "@/lib/storage";

interface UIMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: GroupSequenceSuggestion;
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

export default function GroupRoadmapPage() {
  const { user, requireAuth } = useAuth();
  const { t, language } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const groupId = params.groupId as string;

  const [group, setGroup] = useState<ObjGroup | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [phases, setPhases] = useState<GroupSequencePhase[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [appliedIndices, setAppliedIndices] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<"phases" | "chat">("phases");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) { requireAuth(); router.replace("/"); return; }
    const groups = getObjGroups();
    const g = groups.find((x) => x.id === groupId);
    if (!g) { router.replace("/okr"); return; }
    setGroup(g);
    fetchObjectives().then((objs) => {
      const active = objs.filter((o) => o.meta?.groupId === groupId && (!o.status || o.status === "active"));
      setObjectives(active);
      setPhases(getGroupRoadmap(groupId));
      const stored = getChatHistory(`groupRoadmap_${groupId}`);
      setMessages(stored.map((m) => ({ role: m.role, content: m.content })));
    }).catch(console.error);
  }, [user, groupId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0) return;
    saveChatHistory(`groupRoadmap_${groupId}`, messages.filter((m) => !m.isLoading).map((m) => ({ role: m.role, content: m.content })));
  }, [messages, groupId]);

  async function handleAnalyze() {
    if (!group || analyzing) return;
    setAnalyzing(true);
    const prompt = language === "zh-TW" ? "請分析這些目標的依賴關係，建議最佳執行順序。" : "Please analyze the dependencies between these goals and suggest the best execution order.";
    const userMsg: UIMessage = { role: "user", content: prompt };
    const newHistory = [userMsg];
    setMessages([...newHistory, { role: "assistant", content: "", isLoading: true }]);
    try {
      const result = await callAI<{ content: string; suggestion?: GroupSequenceSuggestion }>("chatGroupRoadmap", {
        messages: newHistory.map((m) => ({ role: m.role, content: m.content })),
        group, objectives, currentPhases: phases,
      });
      const assistantMsg: UIMessage = { role: "assistant", content: sanitize(result.content), suggestion: result.suggestion };
      setMessages([userMsg, assistantMsg]);
      if (result.suggestion) {
        setPhases(result.suggestion.phases);
        setSaved(false);
      }
    } catch {
      setMessages([userMsg, { role: "assistant", content: language === "zh-TW" ? "發生錯誤，請再試一次。" : "An error occurred." }]);
    } finally {
      setAnalyzing(false);
    }
  }

  function handleSave() {
    saveGroupRoadmap(groupId, phases);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function applyGroupSuggestion(s: GroupSequenceSuggestion, idx: number) {
    setPhases(s.phases);
    setAppliedIndices((prev) => new Set([...prev, idx]));
    setSaved(false);
  }

  async function sendChat(text: string) {
    if (!group || chatLoading) return;
    const userMsg: UIMessage = { role: "user", content: text };
    const history = messages.filter((m) => !m.isLoading);
    const newHistory = [...history, userMsg];
    setMessages([...newHistory, { role: "assistant", content: "", isLoading: true }]);
    setChatLoading(true);
    try {
      const apiMessages = newHistory.map((m) => ({ role: m.role, content: m.content }));
      const result = await callAI<{ content: string; suggestion?: GroupSequenceSuggestion }>("chatGroupRoadmap", {
        messages: apiMessages, group, objectives, currentPhases: phases,
      });
      setMessages([...newHistory, { role: "assistant", content: sanitize(result.content), suggestion: result.suggestion }]);
    } catch {
      setMessages([...newHistory, { role: "assistant", content: language === "zh-TW" ? "發生錯誤，請再試一次。" : "An error occurred." }]);
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

  const objMap = new Map(objectives.map((o) => [o.id, o]));

  const phasesPanel = (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleAnalyze}
          disabled={analyzing || objectives.length === 0}
          className="text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-xl transition-colors"
        >
          {analyzing ? t("groupRoadmap.analyzing") : t("groupRoadmap.analyzeBtn")}
        </button>
        {phases.length > 0 && (
          <button
            onClick={handleSave}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-4 py-2 rounded-xl transition-colors"
          >
            {saved ? t("groupRoadmap.saved") : t("groupRoadmap.save")}
          </button>
        )}
      </div>

      {objectives.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t("groupRoadmap.empty")}</p>
      ) : phases.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 mb-3">{language === "zh-TW" ? "所有目標（尚未排序）" : "All goals (not yet sequenced)"}</p>
          {objectives.map((o) => (
            <div key={o.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-sm text-gray-800">{o.title}</p>
              <p className="text-xs text-gray-400 mt-1">{o.keyResults.map((kr) => kr.title).join(" · ")}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {phases.map((phase) => {
            const phaseObjs = phase.objectiveIds.map((oid) => objMap.get(oid)).filter(Boolean) as Objective[];
            return (
              <div key={phase.phase} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">{t("groupRoadmap.phase")} {phase.phase}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${phase.canParallel ? "bg-green-50 text-green-600 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                    {phase.canParallel ? t("groupRoadmap.parallel") : t("groupRoadmap.sequential")}
                  </span>
                  {phase.note && <span className="text-xs text-gray-400">{phase.note}</span>}
                </div>
                <div className={`space-y-2 ${phase.canParallel ? "pl-3 border-l-2 border-green-100" : "pl-3 border-l-2 border-gray-100"}`}>
                  {phaseObjs.map((o) => (
                    <div key={o.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                      <p className="text-sm text-gray-800">{o.title}</p>
                      <p className="text-xs text-gray-400 mt-1">{o.keyResults.map((kr) => kr.title).join(" · ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const chatPanel = (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">{t("groupRoadmap.chat.welcome")}</p>
        )}
        {messages.map((msg, idx) => (
          <div key={idx}>
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${msg.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-800"}`}>
                {msg.isLoading
                  ? <span className="text-xs opacity-50 animate-pulse">{language === "zh-TW" ? "分析中…" : "Analyzing…"}</span>
                  : <p className="whitespace-pre-wrap">{msg.content}</p>
                }
              </div>
            </div>
            {msg.suggestion && !msg.isLoading && (
              <div className="mt-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                <p className="text-[11px] font-medium text-indigo-500 mb-1">{t("groupRoadmap.suggestion")}</p>
                <p className="text-xs text-indigo-700">{msg.suggestion.phases.length} {language === "zh-TW" ? "個階段" : "phases"}</p>
                <button
                  onClick={() => applyGroupSuggestion(msg.suggestion!, idx)}
                  disabled={appliedIndices.has(idx)}
                  className="mt-2 w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
                >
                  {appliedIndices.has(idx) ? t("groupRoadmap.applied") : t("groupRoadmap.apply")}
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

  if (!group) return <div className="flex items-center justify-center h-screen text-sm text-gray-400">載入中…</div>;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 px-4 py-4 md:px-6">
        <Link href="/okr" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">{t("roadmap.back")}</Link>
        <h1 className="text-lg font-semibold text-gray-800 mt-1">{group.name} — {t("groupRoadmap.title")}</h1>
        <p className="text-xs text-gray-400 mt-0.5">{objectives.length} {language === "zh-TW" ? "個目標" : "goals"}</p>
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden shrink-0 flex border-b border-gray-100">
        {(["phases", "chat"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${activeTab === tab ? "text-indigo-600 border-b-2 border-indigo-600" : "text-gray-400"}`}
          >
            {tab === "phases" ? (language === "zh-TW" ? "執行順序" : "Sequence") : (language === "zh-TW" ? "AI 討論" : "AI Chat")}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        <div className={`flex-1 min-w-0 overflow-y-auto px-4 py-5 md:px-6 ${activeTab !== "phases" ? "hidden lg:block" : ""}`}>
          {phasesPanel}
        </div>
        <div className={`lg:w-[380px] lg:shrink-0 lg:border-l lg:border-gray-100 flex flex-col min-h-0 ${activeTab !== "chat" ? "hidden lg:flex" : "flex flex-1"}`}>
          {chatPanel}
        </div>
      </div>
    </div>
  );
}
