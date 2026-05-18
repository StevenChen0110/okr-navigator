import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code, redirectUri } = await req.json();
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Notion integration not configured" }, { status: 503 });
  }

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return NextResponse.json({ error: `Notion token exchange failed: ${err}` }, { status: 400 });
  }

  const token = await tokenRes.json();
  const supabase = createServerSupabase(jwt);

  const { error } = await supabase.from("user_integrations").upsert({
    id: uuidv4(),
    provider: "notion",
    access_token: token.access_token,
    workspace_name: token.workspace_name ?? null,
    created_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ workspaceName: token.workspace_name ?? "Notion" });
}
