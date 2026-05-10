import React from "react";

function parseInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*.+?\*\*|~~.+?~~|!!.+?!!)/);
  return tokens.map((token, i) => {
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4)
      return <strong key={i}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("~~") && token.endsWith("~~") && token.length > 4)
      return <s key={i}>{token.slice(2, -2)}</s>;
    if (token.startsWith("!!") && token.endsWith("!!") && token.length > 4)
      return <span key={i} className="text-red-500">{token.slice(2, -2)}</span>;
    return token;
  });
}

type Block =
  | { type: "bullet"; items: string[] }
  | { type: "numbered"; items: string[] }
  | { type: "text"; content: string };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];

  for (const line of lines) {
    if (/^[-*] /.test(line)) {
      const last = blocks[blocks.length - 1];
      if (last?.type === "bullet") last.items.push(line.slice(2));
      else blocks.push({ type: "bullet", items: [line.slice(2)] });
    } else if (/^\d+\. /.test(line)) {
      const item = line.replace(/^\d+\. /, "");
      const last = blocks[blocks.length - 1];
      if (last?.type === "numbered") last.items.push(item);
      else blocks.push({ type: "numbered", items: [item] });
    } else {
      blocks.push({ type: "text", content: line });
    }
  }

  return blocks;
}

interface Props {
  text: string;
  className?: string;
}

export default function RichTextDisplay({ text, className = "" }: Props) {
  if (!text) return null;

  const blocks = parseBlocks(text);

  return (
    <div className={`space-y-1 leading-relaxed ${className}`}>
      {blocks.map((block, i) => {
        if (block.type === "bullet") {
          return (
            <ul key={i} className="space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-current opacity-40" />
                  <span>{parseInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "numbered") {
          return (
            <ol key={i} className="space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex items-start gap-1.5">
                  <span className="shrink-0 font-mono text-[11px] opacity-50 mt-0.5 min-w-[1.25rem] text-right">{j + 1}.</span>
                  <span>{parseInline(item)}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (block.content === "") return <div key={i} className="h-0.5" />;
        return <p key={i}>{parseInline(block.content)}</p>;
      })}
    </div>
  );
}
