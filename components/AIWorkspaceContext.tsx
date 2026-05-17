"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface AIWorkspaceContextType {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

const AIWorkspaceContext = createContext<AIWorkspaceContextType>({
  isOpen: false,
  toggle: () => {},
  open: () => {},
  close: () => {},
});

export function useAIWorkspace() {
  return useContext(AIWorkspaceContext);
}

export function AIWorkspaceProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <AIWorkspaceContext.Provider value={{
      isOpen,
      toggle: () => setIsOpen((v) => !v),
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    }}>
      {children}
    </AIWorkspaceContext.Provider>
  );
}
