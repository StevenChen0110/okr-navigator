"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchIdeas, saveIdea, updateIdeaStatus, removeIdea } from "@/lib/db";
import { Idea } from "@/lib/types";

export default function InboxPage() {
  const router = useRouter();
  const [items, setItems] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchIdeas()
      .then((all) => setItems(all.filter((i) => i.ideaStatus === "inbox")))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function promoteToTask(item: Idea) {
    const updated: Idea = { ...item, ideaStatus: "active", taskStatus: "todo" };
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await saveIdea(updated).catch(console.error);
  }

  async function archive(item: Idea) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await updateIdeaStatus(item.id, "shelved").catch(console.error);
  }

  async function del(item: Idea) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await updateIdeaStatus(item.id, "deleted").catch(console.error);
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 text-center text-sm text-gray-400">載入中…</div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:px-6 md:py-10 pb-32">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">收件匣</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {items.length > 0 ? `${items.length} 個待澄清` : "收件匣是空的"}
          </p>
        </div>
        {items.length > 0 && (
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-1 font-medium">{items.length}</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm text-gray-400">收件匣清空了，很好！</p>
          <button onClick={() => router.push("/today")}
            className="mt-4 text-sm text-indigo-500 hover:text-indigo-700">← 回到今天</button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 mb-4">
            對每個項目決定：轉成任務執行，還是存起來、刪掉？
          </p>
          {items.map((item) => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-sm text-gray-800 mb-3 leading-snug">{item.title}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => promoteToTask(item)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium transition-colors">
                  轉成任務
                </button>
                <button onClick={() => router.push(`/idea/new?prefill=${encodeURIComponent(item.title)}&inboxId=${item.id}`)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  AI 分析
                </button>
                <button onClick={() => archive(item)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors">
                  存起來
                </button>
                <button onClick={() => del(item)}
                  className="text-xs text-gray-300 hover:text-red-400 ml-auto transition-colors">
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
