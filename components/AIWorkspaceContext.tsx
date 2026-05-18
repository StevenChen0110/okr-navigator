"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface PageContext {
  label: string;         // short label shown in drawer header e.g. "驗證想法"
  systemContext: string; // injected into AI system prompt
}

interface AIWorkspaceContextType {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  pageContext: PageContext | null;
  setPageContext: (ctx: PageContext | null) => void;
}

const AIWorkspaceContext = createContext<AIWorkspaceContextType>({
  isOpen: false,
  toggle: () => {},
  open: () => {},
  close: () => {},
  pageContext: null,
  setPageContext: () => {},
});

export function useAIWorkspace() {
  return useContext(AIWorkspaceContext);
}

export function AIWorkspaceProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pageContext, setPageContextState] = useState<PageContext | null>(null);

  const setPageContext = useCallback((ctx: PageContext | null) => {
    setPageContextState(ctx);
  }, []);

  return (
    <AIWorkspaceContext.Provider value={{
      isOpen,
      toggle: () => setIsOpen((v) => !v),
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      pageContext,
      setPageContext,
    }}>
      {children}
    </AIWorkspaceContext.Provider>
  );
}
