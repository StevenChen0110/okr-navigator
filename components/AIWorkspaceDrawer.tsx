"use client";

import { useState, useEffect, useRef } from "react";
import { Objective } from "@/lib/types";
import { callAI } from "@/lib/ai-client";
import { fetchObjectives } from "@/lib/db";
import { getChatHistory, saveChatHistory } from "@/lib/storage";
import { useAuth } from "./AuthProvider";
import { useLanguage } from "./LanguageProvider";
import { useAIWorkspace } from "./AIWorkspaceContext";

interface ChatMsg { role: "user" | "assistant"; content: string; }

const STORAGE_KEY = "aiWorkspaceChat";

export default function AIWorkspaceDrawer() {
  const { isOpen, close, pageContext } = useAIWorkspace();
  const { user } = useAuth();
  const { language } = useLanguage();
  const zh = language === "zh-TW";

  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Trigger CSS transition after first paint
  useEffect(() => { setMounted(true); }, []);

  // Load objectives and chat history when first opened
  useEffect(() => {
    if (!isOpen) return;
    const stored = getChatHistory(STORAGE_KEY) as ChatMsg[];
    if (stored.length) {
      setMessages(stored);
    } else {
      setMessages([{
        role: "assistant",
        content: pageContext
          ? (zh
            ? `你好！我已載入【${pageContext.label}】的資料，可以直接問我相關問題。`
            : `Hi! I've loaded context from "${pageContext.label}". Ask me anything about it.`)
          : (zh
            ? "你好！我是你的 AI 教練。可以問我任何關於目標設定、任務優先順序或週計劃的問題。"
            : "Hi! I'm your AI coach. Ask me anything about goal setting, task priorities, or weekly planning."),
      }]);
    }
    if (user) {
      fetchObjectives().then(setObjectives).catch(() => setObjectives([]));
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset chat with context-aware greeting when page context changes while open
  useEffect(() => {
    if (!isOpen || !pageContext) return;
    setMessages([{
      role: "assistant",
      content: zh
        ? `已切換到【${pageContext.label}】的資料。有什麼想問的嗎？`
        : `Switched to "${pageContext.label}" context. What would you like to know?`,
    }]);
    saveChatHistory(STORAGE_KEY, []);
  }, [pageContext?.label]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    const updated: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const result = await callAI<{ content: string }>("chat", {
        messages: updated,
        objectives,
        groups: [],
        mode: "optimize",
        // Pass page context as extra system context if available
        ...(pageContext ? { evaluationContext: pageContext.systemContext } : {}),
      });
      const next: ChatMsg[] = [...updated, { role: "assistant", content: result.content }];
      setMessages(next);
      saveChatHistory(STORAGE_KEY, next);
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: zh ? "出現錯誤，請重試。" : "An error occurred. Please try again.",
      }]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    const greeting: ChatMsg = {
      role: "assistant",
      content: pageContext
        ? (zh
          ? `已清除對話。目前載入【${pageContext.label}】的資料。`
          : `Chat cleared. Currently loaded: "${pageContext.label}".`)
        : (zh ? "對話已清除。" : "Chat cleared."),
    };
    setMessages([greeting]);
    saveChatHistory(STORAGE_KEY, []);
  }

  return (
    <>
      {/* Backdrop — mobile only, fades in/out */}
      <div
        className={`md:hidden fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          isOpen && mounted ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={close}
      />

      {/* Drawer — slides in from right */}
      <div
        className={`fixed top-0 right-0 bottom-0 w-full max-w-sm bg-white border-l border-gray-200 z-50 flex flex-col shadow-xl transition-transform duration-300 ease-in-out ${
          isOpen && mounted ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {zh ? "AI 工作區" : "AI Workspace"}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {pageContext
                ? (zh ? `目前資料：${pageContext.label}` : `Context: ${pageContext.label}`)
                : (zh ? "OKR 教練・目標對話" : "OKR Coach · Goal Chat")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className="text-[11px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
            >
              {zh ? "清除" : "Clear"}
            </button>
            <button
              onClick={close}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 text-lg"
            >
              ×
            </button>
          </div>
        </div>

        {/* No auth state */}
        {!user && (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="space-y-2">
              <p className="text-2xl">🔒</p>
              <p className="text-sm font-medium text-gray-700">
                {zh ? "需要登入才能使用 AI 教練" : "Sign in to use the AI Coach"}
              </p>
              <p className="text-xs text-gray-400">
                {zh ? "AI 教練需要讀取你的目標才能提供個人化建議" : "AI Coach needs your goals to give personalized advice"}
              </p>
            </div>
          </div>
        )}

        {/* Chat area */}
        {user && (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                    <span className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-gray-100 shrink-0">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleSend()}
                  placeholder={
                    pageContext
                      ? (zh ? `問 AI 關於「${pageContext.label}」的問題…` : `Ask about "${pageContext.label}"…`)
                      : (zh ? "問 AI 教練任何問題…" : "Ask the AI coach anything…")
                  }
                  disabled={loading}
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 shrink-0"
                >
                  {zh ? "送出" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
