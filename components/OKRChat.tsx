"use client";

import { useState, useEffect, useRef } from "react";
import { Objective, ObjGroup, GoalSuggestion } from "@/lib/types";
import { callAI } from "@/lib/ai-client";
import { useLanguage } from "./LanguageProvider";
import { getChatHistory, saveChatHistory, clearChatHistory } from "@/lib/storage";

interface UIMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: GoalSuggestion;
  isLoading?: boolean;
}

interface Props {
  objectives: Objective[];
  groups: ObjGroup[];
  onApplySuggestion: (suggestion: GoalSuggestion) => void;
  mode: "goalBuilder" | "optimize";
  className?: string;
  onClose?: () => void;
}

function sanitizeContent(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}([\s\S]*?)`{1,3}/g, "$1")
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .trim();
}

export default function OKRChat({ objectives, groups, onApplySuggestion, mode, className = "", onClose }: Props) {
  const { t, language } = useLanguage();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [appliedIndices, setAppliedIndices] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const didAutoTrigger = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load stored messages on mount; auto-trigger optimize only if no history
  useEffect(() => {
    const stored = getChatHistory(mode);
    if (stored.length > 0) {
      setMessages(stored.map((m) => ({ role: m.role, content: m.content })));
    } else if (mode === "optimize" && !didAutoTrigger.current) {
      didAutoTrigger.current = true;
      const prompt = language === "zh-TW"
        ? "請分析我的現有目標，給我具體的優化建議。"
        : "Please analyze my existing goals and give me specific improvement suggestions.";
      sendMsg(prompt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount — chatKey remount handles mode switches

  // Save messages to localStorage whenever they change (skip loading bubbles)
  useEffect(() => {
    if (messages.length === 0) return;
    const toStore = messages
      .filter((m) => !m.isLoading)
      .map((m) => ({ role: m.role, content: m.content }));
    saveChatHistory(mode, toStore);
  }, [messages, mode]);

  async function sendMsg(text: string) {
    if (loading) return;
    const userMsg: UIMessage = { role: "user", content: text };
    const history = messages.filter((m) => !m.isLoading);
    const newHistory = [...history, userMsg];
    setMessages([...newHistory, { role: "assistant", content: "", isLoading: true }]);
    setLoading(true);
    try {
      const apiMessages = newHistory.map((m) => ({ role: m.role, content: m.content }));
      const result = await callAI<{ content: string; suggestion?: GoalSuggestion }>("chat", {
        messages: apiMessages,
        objectives,
        groups,
        mode,
      });
      setMessages([...newHistory, {
        role: "assistant",
        content: sanitizeContent(result.content),
        suggestion: result.suggestion,
      }]);
    } catch {
      setMessages([...newHistory, { role: "assistant", content: t("chat.error") }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    sendMsg(text);
  }

  function handleClear() {
    clearChatHistory(mode);
    setMessages([]);
    setAppliedIndices(new Set());
    didAutoTrigger.current = false;
  }

  function handleApply(suggestion: GoalSuggestion, idx: number) {
    onApplySuggestion(suggestion);
    setAppliedIndices((prev) => new Set([...prev, idx]));
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <span className="text-sm font-semibold text-gray-800">{t("chat.title")}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full">
            {mode === "goalBuilder" ? t("chat.goalBuilder") : t("chat.optimize")}
          </span>
          <button onClick={handleClear} className="text-[10px] text-gray-300 hover:text-gray-500 transition-colors">
            {t("chat.clear")}
          </button>
          {onClose && (
            <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl leading-none transition-colors">×</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !loading && (
          <p className="text-xs text-gray-400 text-center py-6 leading-relaxed">
            {mode === "goalBuilder" ? t("chat.welcome.goalBuilder") : t("chat.welcome.optimize")}
          </p>
        )}

        {messages.map((msg, idx) => (
          <div key={idx}>
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-800"
              }`}>
                {msg.isLoading
                  ? <span className="text-xs opacity-50 animate-pulse">{t("chat.thinking")}</span>
                  : <p className="whitespace-pre-wrap">{msg.content}</p>
                }
              </div>
            </div>

            {msg.suggestion && !msg.isLoading && (
              <div className="mt-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                <p className="text-[11px] font-medium text-indigo-500 mb-2">{t("chat.suggestion")}</p>
                <div className="space-y-2">
                  {msg.suggestion.goals.map((g, gi) => (
                    <div key={gi} className="text-xs">
                      {g.action === "remove" ? (
                        <p className="text-red-400 line-through opacity-70">{g.title || "(remove)"}</p>
                      ) : (
                        <>
                          <p className="font-medium text-indigo-900">{g.title}</p>
                          {g.krs.map((kr, ki) => (
                            <p key={ki} className="text-indigo-600 pl-2 mt-0.5">— {kr}</p>
                          ))}
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => handleApply(msg.suggestion!, idx)}
                  disabled={appliedIndices.has(idx)}
                  className="mt-3 w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
                >
                  {appliedIndices.has(idx) ? t("chat.applied") : t("chat.apply")}
                </button>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 pb-3 pt-2 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSend(); }}
            placeholder={t("chat.placeholder")}
            disabled={loading}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {t("chat.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
