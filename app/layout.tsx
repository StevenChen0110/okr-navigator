import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import CaptureFAB from "@/components/CaptureFAB";
import AuthProvider from "@/components/AuthProvider";
import { LanguageProvider } from "@/components/LanguageProvider";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "記錄指針",
  description: "記錄指針",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW" className={geist.variable}>
      <body className="flex h-screen bg-gray-50 text-gray-900 antialiased">
        <AuthProvider>
          <LanguageProvider>
            <Sidebar />
            <main className="flex-1 overflow-y-auto pb-36 md:pb-10">
              {children}
            </main>
            <BottomNav />
            <CaptureFAB />
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
