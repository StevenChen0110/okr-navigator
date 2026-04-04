"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard", icon: "⊞" },
  { href: "/okr", label: "OKR 目標", icon: "◎" },
  { href: "/idea/new", label: "新增 Idea", icon: "＋" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 flex-col border-r border-gray-200 bg-white shrink-0">
      <div className="px-5 py-5 border-b border-gray-100">
        <span className="font-semibold text-base tracking-tight">OKR Navigator</span>
        <p className="text-xs text-gray-400 mt-0.5">決策導航系統</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
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
    </aside>
  );
}
