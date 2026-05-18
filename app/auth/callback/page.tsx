"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error");
    const oauthErrorDescription = params.get("error_description");

    if (oauthError) {
      setError(oauthErrorDescription ?? oauthError);
      return;
    }

    if (!code) {
      // Implicit flow: supabase-js processes the URL hash automatically on load.
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          router.replace("/");
          return;
        }
        // Wait up to 3s for onAuthStateChange to fire (hash token processing)
        let resolved = false;
        const unsub = supabase.auth.onAuthStateChange((_event, s) => {
          if (s && !resolved) {
            resolved = true;
            unsub.data.subscription.unsubscribe();
            router.replace("/");
          }
        });
        setTimeout(() => {
          if (!resolved) {
            unsub.data.subscription.unsubscribe();
            setError("登入逾時，請重試。");
          }
        }, 3000);
      });
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
