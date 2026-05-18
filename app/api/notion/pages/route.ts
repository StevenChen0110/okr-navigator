import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServerSupabase(jwt);
  const { data, error } = await supabase
    .from("user_integrations")
    .select("access_token")
    .eq("provider", "notion")
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Notion not connected" }, { status: 404 });

  const searchRes = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.access_token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filter: { value: "page", property: "object" }, page_size: 50 }),
  });

  if (!searchRes.ok) return NextResponse.json({ error: "Failed to fetch Notion pages" }, { status: 400 });

  const result = await searchRes.json();
  const pages = (result.results ?? []).map((page: Record<string, unknown>) => {
    const props = page.properties as Record<string, unknown>;
    const titleProp = (props?.title ?? props?.Name ?? props?.name) as Record<string, unknown> | undefined;
    const titleArr = (titleProp?.title ?? titleProp?.rich_text ?? []) as Array<{ plain_text?: string }>;
    const title = titleArr.map((t) => t.plain_text ?? "").join("") || "Untitled";
    return { id: page.id, title, url: page.url };
  });

  return NextResponse.json({ pages });
}
