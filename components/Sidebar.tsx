"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "./LanguageProvider";

const NAV_ITEMS = [
  {
    href: "/tasks",
    labelKey: "nav.tasks",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/report",
    labelKey: "nav.report",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="9" width="2.5" height="5" rx="1" fill="currentColor" />
        <rect x="6.5" y="6" width="2.5" height="8" rx="1" fill="currentColor" />
        <rect x="11" y="3" width="2.5" height="11" rx="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/okr",
    labelKey: "nav.goals",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="8" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    exact: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <aside className="hidden md:flex w-52 flex-col border-r border-gray-200 bg-white shrink-0">
      <div className="px-5 py-5 border-b border-gray-100">
        <span className="font-semibold text-base tracking-tight">{t("brand")}</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              }`}
            >
              <span className={active ? "text-indigo-500" : "text-gray-400"}>{item.icon}</span>
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
