"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems: { href: string; label: string; icon: string; exact?: boolean }[] = [
  { href: "/", label: "總覽", icon: "⊞", exact: true },
  { href: "/ideas", label: "想法庫", icon: "◈" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex md:hidden z-20">
      {navItems.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${
              active ? "text-indigo-600" : "text-gray-400"
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
