import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServerSupabase(jwt);
  const { data, error } = await supabase
    .from("user_integrations")
    .select("access_token")
    .eq("provider", "gdrive")
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Google Drive not connected" }, { status: 404 });

  // List Docs + plain text files, ordered by modified time
  const query = encodeURIComponent(
    "(mimeType='application/vnd.google-apps.document' or mimeType='text/plain' or mimeType='text/markdown') and trashed=false"
  );
  const fields = encodeURIComponent("files(id,name,mimeType,webViewLink,modifiedTime)");
  const filesRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime+desc&pageSize=50`,
    { headers: { Authorization: `Bearer ${data.access_token}` } }
  );

  if (!filesRes.ok) return NextResponse.json({ error: "Failed to fetch Drive files" }, { status: 400 });

  const result = await filesRes.json();
  return NextResponse.json({ files: result.files ?? [] });
}
