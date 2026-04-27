"use client";

import { useState, useRef, useEffect } from "react";
import { v4 as uuid } from "uuid";
import { saveIdea } from "@/lib/db";
import { Idea } from "@/lib/types";

export default function CaptureFAB() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function capture() {
    const title = text.trim();
    if (!title || saving) return;
    setSaving(true);
    const idea: Idea = {
      id: uuid(),
      title,
      description: "",
      analysis: null,
      createdAt: new Date().toISOString(),
      ideaStatus: "inbox",
    };
    try {
      await saveIdea(idea);
      setText("");
      setOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-black/40 absolute inset-0" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 z-10">
            <p className="text-xs text-gray-400 mb-3 font-medium">腦倒 → 收件匣</p>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") capture(); }}
              placeholder="現在腦袋裡有什麼？"
              className="w-full text-base border-0 outline-none placeholder-gray-300 text-gray-900 bg-transparent"
            />
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-300">Enter 儲存 · Esc 取消</span>
              <button
                onClick={capture}
                disabled={!text.trim() || saving}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {saving ? "…" : "儲存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 md:bottom-8 md:right-8 w-13 h-13 w-[52px] h-[52px] rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 active:scale-95 transition-all z-30 flex items-center justify-center text-xl font-light"
        title="腦倒（快速捕捉）"
      >
        ＋
      </button>
    </>
  );
}
