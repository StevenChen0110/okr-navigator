"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

interface AuthContextType {
  user: User | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <span className="text-sm text-gray-400">載入中…</span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <AuthContext.Provider value={{ user, signOut: () => supabase.auth.signOut() }}>
      {children}
    </AuthContext.Provider>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setDone(true);
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold">OKR Navigator</h1>
          <p className="text-sm text-gray-400 mt-1">決策導航系統</p>
        </div>

        {done ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-sm text-green-700 text-center">
            確認信已寄出，請檢查信箱並點擊連結完成註冊。
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="bg-white rounded-xl border border-gray-200 p-6 space-y-4"
          >
            <h2 className="text-base font-medium">
              {mode === "login" ? "登入" : "建立帳號"}
            </h2>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">密碼</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 rounded-lg p-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {busy ? "處理中…" : mode === "login" ? "登入" : "註冊"}
            </button>

            <p className="text-center text-xs text-gray-400">
              {mode === "login" ? (
                <>
                  還沒帳號？{" "}
                  <button
                    type="button"
                    onClick={() => setMode("signup")}
                    className="text-indigo-500 hover:underline"
                  >
                    註冊
                  </button>
                </>
              ) : (
                <>
                  已有帳號？{" "}
                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className="text-indigo-500 hover:underline"
                  >
                    登入
                  </button>
                </>
              )}
            </p>

            <p className="text-center text-xs text-gray-300">
              使用即代表同意{" "}
              <Link href="/privacy" className="hover:underline">
                隱私政策
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
