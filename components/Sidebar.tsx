"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

const navItems: { href: string; label: string; icon: string; exact?: boolean }[] = [
  { href: "/", label: "總覽", icon: "⊞", exact: true },
  { href: "/ideas", label: "想法庫", icon: "◈" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  return (
    <aside className="hidden md:flex w-56 flex-col border-r border-gray-200 bg-white shrink-0">
      <div className="px-5 py-5 border-b border-gray-100">
        <span className="font-semibold text-base tracking-tight">LOCO</span>
        <p className="text-xs text-gray-400 mt-0.5">Log-on to your Core</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
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
