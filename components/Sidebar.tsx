"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

export default function Sidebar() {
  const { user, signOut } = useAuth();

  return (
    <aside className="hidden md:flex w-56 flex-col border-r border-gray-200 bg-white shrink-0">
      <div className="px-5 py-5 border-b border-gray-100">
        <span className="font-semibold text-base tracking-tight">LOCO</span>
        <p className="text-xs text-gray-400 mt-0.5">Log-on to your Core</p>
      </div>
      <div className="flex-1" />
      <div className="border-t border-gray-100 px-4 py-4">
        <Link href="/okr" className="text-xs text-gray-400 hover:text-gray-600 block mb-3">
          目標設定 →
        </Link>
        <p className="text-xs text-gray-400 truncate mb-2">{user?.email}</p>
        <button
          onClick={signOut}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          登出
        </button>
      </div>
    </aside>
  );
}
