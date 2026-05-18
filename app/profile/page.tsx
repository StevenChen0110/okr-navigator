"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import { supabase } from "@/lib/supabase";
import {
  fetchUserDocuments,
  saveUserDocument,
  deleteUserDocument,
} from "@/lib/db";
import { saveUserDocumentContext } from "@/lib/storage";
import type { UserDocument, DocumentSource, NotionPage, DriveFile } from "@/lib/types";

type Tab = "paste" | "upload" | "notion" | "gdrive";

interface Integration {
  provider: string;
  workspaceName: string | null;
}

function sourceLabel(source: DocumentSource, zh: boolean): string {
  const map: Record<DocumentSource, [string, string]> = {
    paste: ["貼上", "Pasted"],
    upload: ["上傳", "Uploaded"],
    notion: ["Notion", "Notion"],
    gdrive: ["Google Drive", "Google Drive"],
  };
  return map[source][zh ? 0 : 1];
}

function SourceBadge({ source }: { source: DocumentSource }) {
  const colors: Record<DocumentSource, string> = {
    paste: "bg-gray-100 text-gray-500",
    upload: "bg-blue-50 text-blue-600",
    notion: "bg-slate-100 text-slate-600",
    gdrive: "bg-green-50 text-green-600",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors[source]}`}>
      {source === "paste" ? "貼上" : source === "upload" ? "檔案" : source === "notion" ? "Notion" : "Drive"}
    </span>
  );
}

export default function ProfilePage() {
  const { user, requireAuth } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const zh = language === "zh-TW";

  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("paste");
  const [showAddSheet, setShowAddSheet] = useState(false);

  // Paste tab state
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");

  // Upload tab state
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notion tab state
  const [notionPages, setNotionPages] = useState<NotionPage[]>([]);
  const [notionLoading, setNotionLoading] = useState(false);
  const [notionSelected, setNotionSelected] = useState<Set<string>>(new Set());
  const [notionImporting, setNotionImporting] = useState(false);

  // Google Drive tab state
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveSelected, setDriveSelected] = useState<Set<string>>(new Set());
  const [driveImporting, setDriveImporting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { requireAuth(); router.replace("/"); return; }
    loadAll();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show add sheet after OAuth connect redirect
  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected === "notion" || connected === "gdrive") {
      setActiveTab(connected as Tab);
      setShowAddSheet(true);
    }
  }, [searchParams]);

  async function loadAll() {
    setLoading(true);
    const [docs, { data: intRows }] = await Promise.all([
      fetchUserDocuments(),
      supabase.from("user_integrations").select("provider, workspace_name"),
    ]);
    setDocuments(docs);
    setIntegrations((intRows ?? []).map((r) => ({ provider: r.provider, workspaceName: r.workspace_name })));
    syncDocumentContext(docs);
    setLoading(false);
  }

  function syncDocumentContext(docs: UserDocument[]) {
    const previews = docs.slice(0, 5).map((d) => ({
      title: d.title,
      preview: d.content.slice(0, 600),
    }));
    saveUserDocumentContext(previews);
  }

  async function getJwt(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  // ── Paste ─────────────────────────────────────────────────────────────────

  async function savePaste() {
    if (!pasteTitle.trim() || !pasteContent.trim()) return;
    setSaving(true);
    const doc: UserDocument = {
      id: uuidv4(),
      title: pasteTitle.trim(),
      content: pasteContent.trim().slice(0, 8000),
      source: "paste",
      createdAt: new Date().toISOString(),
    };
    await saveUserDocument(doc);
    const updated = [doc, ...documents];
    setDocuments(updated);
    syncDocumentContext(updated);
    setPasteTitle(""); setPasteContent("");
    setSaving(false);
    setShowAddSheet(false);
  }

  // ── File Upload ───────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFileName(file.name);
    setUploadTitle(file.name.replace(/\.[^.]+$/, ""));
    const reader = new FileReader();
    reader.onload = (ev) => setUploadContent((ev.target?.result as string) ?? "");
    reader.readAsText(file, "utf-8");
  }

  async function saveUpload() {
    if (!uploadTitle.trim() || !uploadContent.trim()) return;
    setSaving(true);
    const doc: UserDocument = {
      id: uuidv4(),
      title: uploadTitle.trim(),
      content: uploadContent.trim().slice(0, 8000),
      source: "upload",
      createdAt: new Date().toISOString(),
    };
    await saveUserDocument(doc);
    const updated = [doc, ...documents];
    setDocuments(updated);
    syncDocumentContext(updated);
    setUploadTitle(""); setUploadContent(""); setUploadFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSaving(false);
    setShowAddSheet(false);
  }

  // ── Notion ────────────────────────────────────────────────────────────────

  function connectNotion() {
    const clientId = process.env.NEXT_PUBLIC_NOTION_CLIENT_ID;
    if (!clientId) { alert(zh ? "Notion Client ID 未設定" : "NEXT_PUBLIC_NOTION_CLIENT_ID not set"); return; }
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/notion/callback`);
    window.location.href = `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${redirectUri}`;
  }

  async function loadNotionPages() {
    setNotionLoading(true);
    const jwt = await getJwt();
    if (!jwt) return;
    const res = await fetch("/api/notion/pages", { headers: { Authorization: `Bearer ${jwt}` } });
    if (res.ok) {
      const { pages } = await res.json();
      setNotionPages(pages ?? []);
    }
    setNotionLoading(false);
  }

  async function importNotionPages() {
    if (!notionSelected.size) return;
    setNotionImporting(true);
    const jwt = await getJwt();
    if (!jwt) { setNotionImporting(false); return; }

    const newDocs: UserDocument[] = [];
    for (const pageId of notionSelected) {
      const page = notionPages.find((p) => p.id === pageId);
      if (!page) continue;
      const res = await fetch("/api/notion/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) continue;
      const { content } = await res.json();
      const doc: UserDocument = {
        id: uuidv4(),
        title: page.title,
        content,
        source: "notion",
        sourceUrl: page.url,
        createdAt: new Date().toISOString(),
      };
      await saveUserDocument(doc);
      newDocs.push(doc);
    }
    const updated = [...newDocs, ...documents];
    setDocuments(updated);
    syncDocumentContext(updated);
    setNotionSelected(new Set());
    setNotionImporting(false);
    setShowAddSheet(false);
  }

  // ── Google Drive ──────────────────────────────────────────────────────────

  function connectGDrive() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) { alert(zh ? "Google Client ID 未設定" : "NEXT_PUBLIC_GOOGLE_CLIENT_ID not set"); return; }
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/gdrive/callback`);
    const scope = encodeURIComponent("https://www.googleapis.com/auth/drive.readonly");
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
  }

  async function loadDriveFiles() {
    setDriveLoading(true);
    const jwt = await getJwt();
    if (!jwt) return;
    const res = await fetch("/api/gdrive/files", { headers: { Authorization: `Bearer ${jwt}` } });
    if (res.ok) {
      const { files } = await res.json();
      setDriveFiles(files ?? []);
    }
    setDriveLoading(false);
  }

  async function importDriveFiles() {
    if (!driveSelected.size) return;
    setDriveImporting(true);
    const jwt = await getJwt();
    if (!jwt) { setDriveImporting(false); return; }

    const newDocs: UserDocument[] = [];
    for (const fileId of driveSelected) {
      const file = driveFiles.find((f) => f.id === fileId);
      if (!file) continue;
      const res = await fetch("/api/gdrive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ fileId, mimeType: file.mimeType }),
      });
      if (!res.ok) continue;
      const { content } = await res.json();
      const doc: UserDocument = {
        id: uuidv4(),
        title: file.name,
        content,
        source: "gdrive",
        sourceUrl: file.webViewLink,
        createdAt: new Date().toISOString(),
      };
      await saveUserDocument(doc);
      newDocs.push(doc);
    }
    const updated = [...newDocs, ...documents];
    setDocuments(updated);
    syncDocumentContext(updated);
    setDriveSelected(new Set());
    setDriveImporting(false);
    setShowAddSheet(false);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    await deleteUserDocument(id);
    const updated = documents.filter((d) => d.id !== id);
    setDocuments(updated);
    syncDocumentContext(updated);
    setDeleteConfirm(null);
  }

  // ── Notion connected? ─────────────────────────────────────────────────────

  const notionConnected = integrations.some((i) => i.provider === "notion");
  const gdriveConnected = integrations.some((i) => i.provider === "gdrive");

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {zh ? "個人知識庫" : "Personal Knowledge Base"}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {zh
            ? "AI 會閱讀這些文件，更深入了解你的背景與目標"
            : "AI reads these to better understand your background and goals"}
        </p>
      </div>

      {/* Add button */}
      <button
        onClick={() => setShowAddSheet(true)}
        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
      >
        {zh ? "+ 新增文件" : "+ Add Document"}
      </button>

      {/* Document list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center space-y-2">
          <p className="text-2xl">📄</p>
          <p className="text-sm text-gray-500">
            {zh ? "還沒有任何文件" : "No documents yet"}
          </p>
          <p className="text-xs text-gray-400">
            {zh
              ? "加入你的日記、筆記、目標文件，AI 就能更了解你"
              : "Add journals, notes, or goal docs so AI can understand you better"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="rounded-xl border border-gray-100 bg-white px-4 py-3 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <SourceBadge source={doc.source} />
                  <span className="text-sm font-medium text-gray-800 truncate">{doc.title}</span>
                </div>
                {deleteConfirm === doc.id ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      {zh ? "確認刪除" : "Confirm"}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      {zh ? "取消" : "Cancel"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(doc.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors shrink-0 text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 line-clamp-2 leading-snug">{doc.content}</p>
              <p className="text-[10px] text-gray-300">
                {sourceLabel(doc.source, zh)} · {new Date(doc.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Add Document Sheet */}
      {showAddSheet && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddSheet(false); }}
        >
          <div className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-2xl max-h-[90vh] flex flex-col">
            {/* Sheet header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <p className="text-sm font-semibold text-gray-900">
                {zh ? "新增文件" : "Add Document"}
              </p>
              <button
                onClick={() => setShowAddSheet(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 text-lg"
              >×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 shrink-0">
              {(["paste", "upload", "notion", "gdrive"] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    if (tab === "notion" && notionConnected && !notionPages.length) loadNotionPages();
                    if (tab === "gdrive" && gdriveConnected && !driveFiles.length) loadDriveFiles();
                  }}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                    activeTab === tab
                      ? "border-indigo-500 text-indigo-600"
                      : "border-transparent text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {tab === "paste" ? (zh ? "貼上文字" : "Paste")
                    : tab === "upload" ? (zh ? "上傳檔案" : "Upload")
                    : tab === "notion" ? "Notion"
                    : "Google Drive"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

              {/* Paste tab */}
              {activeTab === "paste" && (
                <>
                  <input
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder={zh ? "文件標題" : "Document title"}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <textarea
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    placeholder={zh
                      ? "貼上你的筆記、日記、目標規劃…\nAI 會閱讀這些來了解你"
                      : "Paste your notes, journal, goals…\nAI will read these to understand you"}
                    rows={10}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                  />
                  <button
                    onClick={savePaste}
                    disabled={!pasteTitle.trim() || !pasteContent.trim() || saving}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {saving ? (zh ? "儲存中…" : "Saving…") : (zh ? "儲存" : "Save")}
                  </button>
                </>
              )}

              {/* Upload tab */}
              {activeTab === "upload" && (
                <>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
                  >
                    <p className="text-2xl mb-2">📄</p>
                    <p className="text-sm text-gray-600 font-medium">
                      {uploadFileName || (zh ? "點擊選擇檔案" : "Click to select file")}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">.txt · .md</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,text/plain,text/markdown"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                  {uploadContent && (
                    <>
                      <input
                        value={uploadTitle}
                        onChange={(e) => setUploadTitle(e.target.value)}
                        placeholder={zh ? "文件標題" : "Document title"}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                      <p className="text-xs text-gray-400">
                        {zh ? "已讀取" : "Read"} {uploadContent.length.toLocaleString()} {zh ? "字元" : "chars"}
                        {uploadContent.length > 8000 && (zh ? "（將截斷至 8000 字元）" : " (will be truncated to 8000)")}
                      </p>
                      <button
                        onClick={saveUpload}
                        disabled={!uploadTitle.trim() || saving}
                        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {saving ? (zh ? "儲存中…" : "Saving…") : (zh ? "儲存" : "Save")}
                      </button>
                    </>
                  )}
                </>
              )}

              {/* Notion tab */}
              {activeTab === "notion" && (
                <>
                  {!notionConnected ? (
                    <div className="text-center space-y-4 py-4">
                      <div className="w-12 h-12 rounded-2xl bg-gray-900 text-white text-xl flex items-center justify-center mx-auto font-bold">N</div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{zh ? "連接 Notion" : "Connect Notion"}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {zh ? "授權後可直接匯入 Notion 頁面" : "Authorize to import Notion pages directly"}
                        </p>
                      </div>
                      <button
                        onClick={connectNotion}
                        className="px-6 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700"
                      >
                        {zh ? "授權連接 Notion" : "Connect Notion"}
                      </button>
                      <p className="text-[11px] text-gray-300">
                        {zh ? "需要設定 NEXT_PUBLIC_NOTION_CLIENT_ID 環境變數" : "Requires NEXT_PUBLIC_NOTION_CLIENT_ID env var"}
                      </p>
                    </div>
                  ) : notionLoading ? (
                    <div className="space-y-2">
                      {[1,2,3].map((i) => <div key={i} className="h-10 rounded-xl bg-gray-100 animate-pulse" />)}
                    </div>
                  ) : notionPages.length === 0 ? (
                    <div className="text-center py-8 space-y-3">
                      <p className="text-sm text-gray-500">{zh ? "沒有找到頁面" : "No pages found"}</p>
                      <button onClick={loadNotionPages} className="text-sm text-indigo-600 hover:underline">
                        {zh ? "重新載入" : "Reload"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400">{zh ? "選擇要匯入的頁面" : "Select pages to import"}</p>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {notionPages.map((page) => (
                          <button
                            key={page.id}
                            onClick={() => setNotionSelected((s) => {
                              const next = new Set(s);
                              next.has(page.id) ? next.delete(page.id) : next.add(page.id);
                              return next;
                            })}
                            className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors flex items-center gap-2 ${
                              notionSelected.has(page.id)
                                ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
                                : "bg-gray-50 hover:bg-gray-100 text-gray-700"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 text-[10px] font-bold ${
                              notionSelected.has(page.id) ? "bg-indigo-500 border-indigo-500 text-white" : "border-gray-300"
                            }`}>
                              {notionSelected.has(page.id) && "✓"}
                            </span>
                            {page.title}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={importNotionPages}
                        disabled={!notionSelected.size || notionImporting}
                        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {notionImporting
                          ? (zh ? "匯入中…" : "Importing…")
                          : (zh ? `匯入 ${notionSelected.size} 個頁面` : `Import ${notionSelected.size} page(s)`)}
                      </button>
                    </>
                  )}
                </>
              )}

              {/* Google Drive tab */}
              {activeTab === "gdrive" && (
                <>
                  {!gdriveConnected ? (
                    <div className="text-center space-y-4 py-4">
                      <div className="w-12 h-12 rounded-2xl bg-white border border-gray-200 flex items-center justify-center mx-auto">
                        <svg viewBox="0 0 87.3 78" className="w-7 h-7" xmlns="http://www.w3.org/2000/svg">
                          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                          <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                          <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                          <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                          <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                          <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{zh ? "連接 Google Drive" : "Connect Google Drive"}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {zh ? "授權後可匯入 Google Docs 或文字檔案" : "Authorize to import Google Docs or text files"}
                        </p>
                      </div>
                      <button
                        onClick={connectGDrive}
                        className="px-6 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50"
                      >
                        {zh ? "授權連接 Google Drive" : "Connect Google Drive"}
                      </button>
                      <p className="text-[11px] text-gray-300">
                        {zh ? "需要設定 NEXT_PUBLIC_GOOGLE_CLIENT_ID 環境變數" : "Requires NEXT_PUBLIC_GOOGLE_CLIENT_ID env var"}
                      </p>
                    </div>
                  ) : driveLoading ? (
                    <div className="space-y-2">
                      {[1,2,3].map((i) => <div key={i} className="h-10 rounded-xl bg-gray-100 animate-pulse" />)}
                    </div>
                  ) : driveFiles.length === 0 ? (
                    <div className="text-center py-8 space-y-3">
                      <p className="text-sm text-gray-500">{zh ? "沒有找到檔案" : "No files found"}</p>
                      <button onClick={loadDriveFiles} className="text-sm text-indigo-600 hover:underline">
                        {zh ? "重新載入" : "Reload"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400">{zh ? "選擇要匯入的檔案" : "Select files to import"}</p>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {driveFiles.map((file) => (
                          <button
                            key={file.id}
                            onClick={() => setDriveSelected((s) => {
                              const next = new Set(s);
                              next.has(file.id) ? next.delete(file.id) : next.add(file.id);
                              return next;
                            })}
                            className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors flex items-center gap-2 ${
                              driveSelected.has(file.id)
                                ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
                                : "bg-gray-50 hover:bg-gray-100 text-gray-700"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 text-[10px] font-bold ${
                              driveSelected.has(file.id) ? "bg-indigo-500 border-indigo-500 text-white" : "border-gray-300"
                            }`}>
                              {driveSelected.has(file.id) && "✓"}
                            </span>
                            <span className="truncate">{file.name}</span>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={importDriveFiles}
                        disabled={!driveSelected.size || driveImporting}
                        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {driveImporting
                          ? (zh ? "匯入中…" : "Importing…")
                          : (zh ? `匯入 ${driveSelected.size} 個檔案` : `Import ${driveSelected.size} file(s)`)}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
