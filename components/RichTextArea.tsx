"use client";

import { useRef } from "react";
import { useLanguage } from "./LanguageProvider";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

export default function RichTextArea({ value, onChange, placeholder, rows = 3, className = "" }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { language } = useLanguage();

  function wrapSelection(open: string, close: string) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const selected = value.slice(s, e) || (language === "en" ? "text" : "文字");
    const next = value.slice(0, s) + open + selected + close + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + open.length, s + open.length + selected.length);
    });
  }

  function toggleLinePrefix(getPrefix: (lineIndex: number) => string, testPrefix: RegExp) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;

    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const lineEndIdx = value.indexOf("\n", e);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;

    const chunk = value.slice(lineStart, lineEnd);
    const lines = chunk.split("\n");

    const allHave = lines.every((l) => testPrefix.test(l));
    const newLines = allHave
      ? lines.map((l) => l.replace(testPrefix, ""))
      : lines.map((l, i) => (testPrefix.test(l) ? l : getPrefix(i) + l));

    const next = value.slice(0, lineStart) + newLines.join("\n") + value.slice(lineEnd);
    onChange(next);
    requestAnimationFrame(() => ta.focus());
  }

  const tools: { icon: React.ReactNode; title: string; action: () => void }[] = [
    {
      icon: <span className="font-bold">B</span>,
      title: language === "en" ? "Bold" : "粗體",
      action: () => wrapSelection("**", "**"),
    },
    {
      icon: <span className="line-through">S</span>,
      title: language === "en" ? "Strikethrough" : "刪除線",
      action: () => wrapSelection("~~", "~~"),
    },
    {
      icon: <span className="text-red-500 font-semibold">A</span>,
      title: language === "en" ? "Red text" : "紅字",
      action: () => wrapSelection("!!", "!!"),
    },
    {
      icon: <span>•</span>,
      title: language === "en" ? "Bullet list" : "圓點列點",
      action: () => toggleLinePrefix(() => "- ", /^[-*] /),
    },
    {
      icon: <span className="font-mono text-[10px]">1.</span>,
      title: language === "en" ? "Numbered list" : "數字列點",
      action: () => toggleLinePrefix((i) => `${i + 1}. `, /^\d+\. /),
    },
  ];

  return (
    <div className={`rounded-lg border border-gray-200 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent ${className}`}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50">
        {tools.map((tool, i) => (
          <button
            key={i}
            type="button"
            title={tool.title}
            onMouseDown={(e) => { e.preventDefault(); tool.action(); }}
            className="w-6 h-6 rounded text-xs flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition-colors"
          >
            {tool.icon}
          </button>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 text-sm focus:outline-none resize-none bg-white"
      />
    </div>
  );
}
