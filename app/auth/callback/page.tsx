"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      // Implicit flow: supabase-js picks up the token from the URL hash automatically
      router.replace("/");
      return;
    }

    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        setError(error.message);
      } else {
        router.replace("/");
      }
    });
  }, [router]);

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl border border-red-200 p-6 max-w-sm w-full text-center space-y-3">
          <p className="text-sm text-red-600">驗證失敗：{error}</p>
          <button
            onClick={() => router.replace("/")}
            className="text-sm text-indigo-600 hover:underline"
          >
            返回首頁
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-50">
      <span className="text-sm text-gray-400">驗證中，請稍候…</span>
    </div>
  );
}
