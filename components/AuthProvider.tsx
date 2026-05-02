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
  openLogin: () => void;
  requireAuth: () => void; // shows "need login" gate modal
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  signOut: async () => {},
  openLogin: () => {},
  requireAuth: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [showAuthGate, setShowAuthGate] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Auto-close modals when user authenticates
  useEffect(() => {
    if (user) { setShowLogin(false); setShowAuthGate(false); }
  }, [user]);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-50">
        <span className="text-sm text-gray-400">載入中…</span>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        signOut: async () => { await supabase.auth.signOut(); },
        openLogin: () => setShowLogin(true),
        requireAuth: () => setShowAuthGate(true),
      }}
    >
      {children}

      {/* Full login form modal */}
      {showLogin && !user && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setShowLogin(false); }}
        >
          <div className="w-full max-w-sm py-6">
            <LoginContent onClose={() => setShowLogin(false)} />
          </div>
        </div>
      )}

      {/* Auth gate — lightweight "need to login" prompt */}
      {showAuthGate && !user && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAuthGate(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-6 space-y-4 text-center">
            <div className="text-3xl">🔒</div>
            <div>
              <p className="text-sm font-semibold text-gray-800">需要登入</p>
              <p className="text-xs text-gray-400 mt-1">請先登入才能使用此功能</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAuthGate(false)}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => { setShowAuthGate(false); setShowLogin(true); }}
                className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                前往登入
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

function LoginContent({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setError(error.message);
      else setDone(true);
    }
    setBusy(false);
  }

  async function signInWithGoogle() {
    setGoogleBusy(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    setGoogleBusy(false);
  }

  return (
    <div className="w-full">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white text-xl mb-4">◎</div>
        <h1 className="text-2xl font-semibold tracking-tight">OKR Navigator</h1>
        <p className="text-sm text-gray-400 mt-1">決策導航系統</p>
      </div>

      {done ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-sm text-green-700 text-center">
          確認信已寄出，請檢查信箱並點擊連結完成註冊。
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="space-y-2">
            <OAuthButton label="使用 Google 繼續" busy={googleBusy} onClick={signInWithGoogle}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              }
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">或用 Email</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
              {(["login", "signup"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === m ? "bg-white shadow-sm text-gray-900" : "text-gray-400"}`}>
                  {m === "login" ? "登入" : "註冊"}
                </button>
              ))}
            </div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="Email"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="密碼（至少 6 位）"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors" />
            {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={busy}
              className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {busy ? "處理中…" : mode === "login" ? "登入" : "建立帳號"}
            </button>
          </form>

          <p className="text-center text-xs text-gray-300">
            使用即代表同意{" "}
            <Link href="/privacy" className="text-gray-400 hover:underline">隱私政策</Link>
          </p>
        </div>
      )}

      <button onClick={onClose} className="mt-4 w-full text-xs text-gray-400 hover:text-gray-600 text-center py-2">
        先預覽，稍後再登入
      </button>
    </div>
  );
}

function OAuthButton({ label, icon, busy, onClick }: { label: string; icon: ReactNode; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
      {busy ? <span className="text-xs text-gray-400">跳轉中…</span> : <>{icon}{label}</>}
    </button>
  );
}
