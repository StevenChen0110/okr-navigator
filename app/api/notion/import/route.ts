import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

type RichTextItem = { plain_text?: string };
type Block = { type: string; [key: string]: unknown };

function extractText(block: Block): string {
  const type = block.type as string;
  const data = block[type] as { rich_text?: RichTextItem[] } | undefined;
  const text = (data?.rich_text ?? []).map((t) => t.plain_text ?? "").join("");
  if (type.startsWith("heading")) return `\n## ${text}\n`;
  if (type === "bulleted_list_item" || type === "numbered_list_item") return `- ${text}`;
  return text;
}

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { pageId } = await req.json();
  if (!pageId) return NextResponse.json({ error: "Missing pageId" }, { status: 400 });

  const supabase = createServerSupabase(jwt);
  const { data, error } = await supabase
    .from("user_integrations")
    .select("access_token")
    .eq("provider", "notion")
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Notion not connected" }, { status: 404 });

  const headers = {
    Authorization: `Bearer ${data.access_token}`,
    "Notion-Version": "2022-06-28",
  };

  const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers });
  if (!blocksRes.ok) return NextResponse.json({ error: "Failed to fetch page content" }, { status: 400 });

  const blocksData = await blocksRes.json();
  const lines: string[] = [];
  for (const block of (blocksData.results ?? []) as Block[]) {
    const line = extractText(block);
    if (line.trim()) lines.push(line);
  }
  const content = lines.join("\n").slice(0, 8000);

  return NextResponse.json({ content });
}
