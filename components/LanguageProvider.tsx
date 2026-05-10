"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { Lang, Vars, translate } from "@/lib/i18n";
import { getSettings, saveSettings } from "@/lib/storage";

interface LanguageContextValue {
  language: Lang;
  setLanguage: (lang: Lang) => void;
  t: (key: string, vars?: Vars) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "zh-TW",
  setLanguage: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLangState] = useState<Lang>("zh-TW");

  useEffect(() => {
    const stored = getSettings().language as Lang | undefined;
    if (stored === "en" || stored === "zh-TW") setLangState(stored);
  }, []);

  const setLanguage = useCallback((lang: Lang) => {
    setLangState(lang);
    const s = getSettings();
    saveSettings({ ...s, language: lang });
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => translate(language, key, vars),
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
