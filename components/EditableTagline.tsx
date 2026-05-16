"use client";

import { useState, useEffect, useRef } from "react";

export default function EditableTagline({ storageKey, defaultText, className = "" }: {
  storageKey: string;
  defaultText: string;
  className?: string;
}) {
  const [text, setText] = useState(defaultText);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(defaultText);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) { setText(saved); setDraft(saved); }
  }, [storageKey]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() { setDraft(text); setEditing(true); }

  function save() {
    const trimmed = draft.trim() || defaultText;
    setText(trimmed);
    setDraft(trimmed);
    localStorage.setItem(storageKey, trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); } }}
        className={`text-xs text-gray-400 bg-transparent border-b border-gray-300 focus:outline-none focus:border-indigo-400 transition-colors min-w-0 w-full max-w-xs ${className}`}
        placeholder={defaultText}
      />
    );
  }

  return (
    <p
      onClick={startEdit}
      className={`text-xs text-gray-400 mt-0.5 truncate cursor-pointer hover:text-gray-500 group select-none ${className}`}
      title="點擊編輯"
    >
      {text}
      <span className="ml-1 opacity-0 group-hover:opacity-50 text-[10px]">✎</span>
    </p>
  );
}
