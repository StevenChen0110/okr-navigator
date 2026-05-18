import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileId, mimeType } = await req.json();
  if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });

  const supabase = createServerSupabase(jwt);
  const { data, error } = await supabase
    .from("user_integrations")
    .select("access_token")
    .eq("provider", "gdrive")
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Google Drive not connected" }, { status: 404 });

  const headers = { Authorization: `Bearer ${data.access_token}` };
  let content = "";

  if (mimeType === "application/vnd.google-apps.document") {
    // Export Google Docs as plain text
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
      { headers }
    );
    if (!exportRes.ok) return NextResponse.json({ error: "Failed to export Google Doc" }, { status: 400 });
    content = await exportRes.text();
  } else {
    // Download plain text / markdown file directly
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers }
    );
    if (!dlRes.ok) return NextResponse.json({ error: "Failed to download file" }, { status: 400 });
    content = await dlRes.text();
  }

  return NextResponse.json({ content: content.slice(0, 8000) });
}
