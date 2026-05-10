"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLanguage } from "./LanguageProvider";

const NAV_ITEMS = [
  {
    href: "/",
    labelKey: "nav.tasks",
    exact: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="4" width="14" height="2" rx="1" fill="currentColor" />
        <rect x="3" y="9" width="10" height="2" rx="1" fill="currentColor" />
        <rect x="3" y="14" width="7" height="2" rx="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/okr",
    labelKey: "nav.goals",
    exact: false,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    exact: false,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { user, openLogin } = useAuth();
  const { t } = useLanguage();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 flex"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={
              (item.href === "/settings" || item.href === "/okr") && !user
                ? (e) => { e.preventDefault(); openLogin(); }
                : undefined
            }
            className={`flex-1 flex flex-col items-center gap-1 pt-3 pb-2 text-[11px] font-medium transition-colors ${
              active ? "text-indigo-600" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {item.icon}
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
