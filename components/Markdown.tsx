import React from "react";

interface Props {
  children: string;
  className?: string;
}

/**
 * Lightweight markdown renderer supporting:
 * - **bold**, *italic*, ~~strikethrough~~
 * - Bullet lists (- or *)
 * - Numbered lists (1. 2. …)
 * - Blank lines as paragraph breaks
 */
export default function Markdown({ children, className = "" }: Props) {
  const lines = children.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line → paragraph break (skip)
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Bullet list
    if (/^[\-\*]\s/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[\-\*]\s/, ""));
        i++;
      }
      elements.push(
        <ul key={i} className="list-disc pl-5 space-y-1 my-1">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={i} className="list-decimal pl-5 space-y-1 my-1">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="my-0.5">
        {renderInline(line.trim())}
      </p>
    );
    i++;
  }

  return <div className={className}>{elements}</div>;
}

function renderInline(text: string): React.ReactNode[] {
  // Patterns: **bold**, *italic*, ~~strikethrough~~
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^~~[^~]+~~$/.test(part))
      return <s key={i}>{part.slice(2, -2)}</s>;
    return part;
  });
}
