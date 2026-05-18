"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function NotionCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error");

    if (oauthError || !code) {
      setError(oauthError ?? "Missing authorization code");
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setError("Not logged in"); return; }

      const redirectUri = `${window.location.origin}/auth/notion/callback`;
      const res = await fetch("/api/notion/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code, redirectUri }),
      });

      if (!res.ok) {
        const msg = await res.json().then((j) => j.error).catch(() => "Connection failed");
        setError(msg);
        return;
      }

      router.replace("/profile?connected=notion");
    });
  }, [router]);

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl border border-red-200 p-6 max-w-sm w-full text-center space-y-3">
          <p className="text-sm text-red-600">Notion 連接失敗：{error}</p>
          <button onClick={() => router.replace("/profile")} className="text-sm text-indigo-600 hover:underline">
            返回知識庫
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-50">
      <span className="text-sm text-gray-400">連接 Notion 中，請稍候…</span>
    </div>
  );
}
