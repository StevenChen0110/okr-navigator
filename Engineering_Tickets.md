# OKR Navigator — Engineering Ticket 清單

**對應版本**：PRD v2.0 / Roadmap v2  
**日期**：2026-04-18  
**優先順序**：Phase 1（P0 阻塞）> Phase 1（核心功能）> Phase 2 > Phase 3

---

## 🔴 Phase 0 — 安全阻塞（上線前必須完成）

---

### [SEC-01] 將 Claude API Key 移至後端 Proxy

**問題**：`NEXT_PUBLIC_CLAUDE_API_KEY` 暴露於瀏覽器，任何人打開 DevTools 都能取得。

**影響範圍**：
- `lib/claude.ts` — 所有 `getClient(apiKey)` 呼叫
- `lib/gemini.ts` — 同上
- `app/okr/new/page.tsx` — 取用 `process.env.NEXT_PUBLIC_CLAUDE_API_KEY`
- `app/idea/new/page.tsx` — 同上

**做法**：
1. 建立 `app/api/claude/route.ts`（Next.js Route Handler），在伺服器端持有 `CLAUDE_API_KEY`（非 NEXT_PUBLIC）
2. `lib/claude.ts` 的所有函數改為呼叫 `/api/claude` endpoint，不再直接建立 Anthropic client
3. 移除所有頁面中 `process.env.NEXT_PUBLIC_CLAUDE_API_KEY` 的引用
4. `.env.local` 中將 `NEXT_PUBLIC_CLAUDE_API_KEY` 更名為 `CLAUDE_API_KEY`

**驗收**：瀏覽器 Network tab 中看不到 API Key；伺服器 log 可見 API 呼叫成功。

---

### [SEC-02] 確認 Supabase RLS 政策已啟用

**問題**：`lib/db.ts` 的 `uid()` 只在 JS 層做 user_id 過濾，若 Supabase RLS 未啟用，任何已登入用戶可查詢他人資料。

**影響範圍**：Supabase Dashboard（非程式碼）+ `lib/db.ts` 驗證

**做法**：
1. 在 Supabase Dashboard → Authentication → Policies，確認 `objectives`、`ideas`、`user_backgrounds` 三張表均已啟用 RLS
2. 每張表加入 Policy：`SELECT/INSERT/UPDATE/DELETE` 只允許 `auth.uid() = user_id`
3. 在 `lib/db.ts` 中移除冗餘的手動 user_id 過濾（RLS 啟用後 Supabase 自動處理）
4. 寫一個測試：用 User A 的 token 嘗試查詢 User B 的資料，應回傳空陣列

**驗收**：跨用戶資料隔離測試通過。

---

## 🟠 Phase 1 — 核心功能（Dashboard 改版）

---

### [FEAT-01] 新增 Objective 優先級欄位

**PRD 對應**：5.2

**影響範圍**：
- `lib/types.ts` — `OKRMeta` 介面新增 `priority?: 1 | 2 | 3`
- `lib/db.ts` — `saveObjective` / `fetchObjectives` 讀寫 `meta.priority`
- `app/okr/new/page.tsx` — 建立 Objective 時加入優先級選擇 UI
- `app/okr/[id]/page.tsx`（若存在）或 OKR 列表頁 — 顯示優先級並支援直接修改

**具體修改**：

```typescript
// lib/types.ts
export interface OKRMeta {
  okrType?: "committed" | "aspirational";
  timeframe?: string;
  motivation?: string;
  snapshot?: string;
  priority?: 1 | 2 | 3; // 新增
}
```

OKR 列表頁每個 Objective 旁加入優先級選擇器（三個按鈕：1 / 2 / 3），點擊後呼叫 `saveObjective` 更新，不需進入編輯頁。

**驗收**：
- 建立 Objective 時可選優先級，預設 2
- OKR 列表頁可直接修改，儲存後資料庫確認更新
- 修改優先級後 Dashboard 排序即時變化（需 FEAT-02 完成後驗收）

---

### [FEAT-02] Dashboard 改版：Idea 加權貢獻排行榜

**PRD 對應**：5.3

**影響範圍**：
- `app/page.tsx` — 大幅重構 Dashboard 區塊

**核心計算邏輯**（前端，不需 API 呼叫）：

```typescript
function calcWeightedScore(idea: Idea, objectives: Objective[]): number {
  if (!idea.analysis) return -1; // 未分析排最後

  const objMap = Object.fromEntries(objectives.map(o => [o.id, o]));
  let weightedSum = 0;
  let weightSum = 0;

  for (const objScore of idea.analysis.objectiveScores) {
    const obj = objMap[objScore.objectiveId];
    if (!obj) continue;
    const priority = obj.meta?.priority ?? 2;
    weightedSum += objScore.overallScore * priority;
    weightSum += priority;
  }

  return weightSum > 0 ? weightedSum / weightSum : 0;
}
```

**畫面結構**：
- 移除現有的多 Tab 結構（優先順序 / 指派 / 進度）
- 改為單一清單，每列顯示：Idea 標題、加權分數（一位小數）、展開鍵（`›`）
- 展開後顯示：`analysis.reasoning` 或新版帶進度脈絡的理由（FEAT-04 完成後替換）
- done 狀態的 Task Idea 排在最後，視覺灰階
- 未分析的 Idea 排在 done 之前，顯示「待評估」badge

**驗收**：
- 所有已分析 Idea 依加權分數排序
- 修改目標優先級後，排序 1 秒內更新（狀態 re-render，不需 API）
- 展開/收合理由，頁面不跳動（高度動畫或 `min-height` 預留）
- 完成 Task 後該 Idea 即時移至底部

---

### [FEAT-03] Idea 輸入簡化：快速評估模式

**PRD 對應**：5.4

**影響範圍**：
- `app/idea/new/page.tsx` — 重構輸入流程

**修改邏輯**：
1. 頁面進入時只顯示標題輸入框
2. 標題輸入後出現「快速評估」按鈕
3. 「為什麼要做」、「預期成效」、「備註」三個欄位移入可展開的「補充說明（選填）」區塊，預設收合
4. 點擊「快速評估」→ 以純標題呼叫 `analyzeIdea`（why/outcome/notes 傳空字串）
5. 若已填補充說明，按鈕文字改為「完整分析」

在 `Idea` 型別或分析結果中標記是否為快速評估：

```typescript
// lib/types.ts，Idea 介面新增：
quickAnalysis?: boolean; // true = 只用標題分析
```

**驗收**：
- 只填標題可完成分析並儲存
- 快速評估結果在 3 秒內顯示（從點擊到看到分數）
- 補充說明區塊展開/收合流暢
- 已儲存的快速評估 Idea，詳情頁顯示「此評估基於標題，補充說明可提升精準度」提示

---

### [FEAT-04] Idea 分析理由帶入目標進度脈絡

**PRD 對應**：5.5

**影響範圍**：
- `lib/claude.ts` — `analyzeIdea` 函數的 prompt 修改
- `app/idea/new/page.tsx` — 傳入 objectives 時帶上 KR 進度資訊（已有）

**修改 `analyzeIdea` 的 OKR context 組裝邏輯**：

```typescript
// 在 okrContext 組裝中加入進度資訊
const okrContext = objectives.map((o) => {
  const completion = calcOCompletion(o); // 複用現有計算邏輯
  return `Objective ID: ${o.id}
Objective: ${o.title}
Priority: ${o.meta?.priority ?? 2} (scale 1-3, higher = more important now)
Current completion: ${completion !== undefined ? `${completion}%` : 'no progress yet'}
Key Results:
${o.keyResults.map((kr) => {
  const krCompletion = calcKRCompletion(kr);
  return `  - KR ID: ${kr.id}
    KR: ${kr.title}
    Progress: ${krCompletion !== undefined ? `${krCompletion}%` : 'not started'}`;
}).join('\n')}`;
}).join('\n\n');
```

**修改 system prompt**，要求理由帶入進度脈絡：
```
When explaining your reasoning for each objective score, mention:
1. The objective's current completion percentage if available
2. Why this specific moment (given current progress) makes this idea high or low priority
3. Be specific: "This objective is at 15% completion, making this idea high leverage right now" not "This idea is relevant to your goal"
```

**驗收**：
- 理由中包含目標完成百分比（若有進度資料）
- 目標完成度 0% 時，理由說明「尚未起步，此行動可開啟進展」
- 目標完成度 ≥80% 時，理由說明「目標接近完成，此行動可衝刺收尾」
- 目標無任何 KR 進度時，理由改為說明貢獻路徑，不出現百分比

---

## 🟡 Phase 2 — 體驗深化

---

### [FEAT-05] AI 教練：模糊 Idea 單問介入

**PRD 對應**：5.9

**影響範圍**：
- `lib/claude.ts` — 新增 `clarifyIdea` 函數
- `app/idea/new/page.tsx` — 新增「AI 問題」中間狀態

**新增函數**：

```typescript
export async function clarifyIdea(
  apiKey: string,
  model: string,
  language: "zh-TW" | "en",
  ideaTitle: string,
  objectives: Objective[]
): Promise<{ shouldClarify: boolean; question?: string }> {
  // 若 shouldClarify = true，顯示 question 給用戶回答
  // 若 shouldClarify = false，直接進行分析
}
```

**流程修改**：
1. 快速評估送出後，先呼叫 `clarifyIdea`
2. 若 `shouldClarify = true`，顯示問題文字 + 輸入框 + 「跳過，直接評估」按鈕
3. 用戶回答後，將回答附加至 Idea 描述，呼叫 `analyzeIdea`
4. 若跳過，直接以原標題呼叫 `analyzeIdea`

**驗收**：
- 輸入「提升自己」等模糊標題，觸發釐清問題
- 輸入「每天跑步 30 分鐘」等具體標題，不觸發問題（直接分析）
- 跳過功能正常，不阻擋儲存
- 釐清後的分析理由比原始分析更具體（人工 QA）

---

### [FEAT-06] KR 進度更新後觸發 Idea 重新評估提示

**PRD 對應**：5.10

**影響範圍**：
- `app/page.tsx` — Dashboard Idea 卡片新增「需重新評估」狀態
- `lib/types.ts` — `Idea` 新增 `needsReanalysis?: boolean`
- `lib/db.ts` — `updateIdeaCompletion` 後觸發相關 Idea 標記

**邏輯**：
1. KR Check-In 或 Task 完成後，找出所有連結此 KR 的 Idea（透過 `linkedKRs`）
2. 將這些 Idea 的 `needsReanalysis` 設為 true（本地 state 更新，不需 DB 欄位——或加 DB 欄位視跨裝置需求）
3. Dashboard 中這些 Idea 卡片顯示「進度已更新，重新評估？」badge
4. 點擊 badge 觸發重新分析，完成後清除 badge

**驗收**：
- 完成連結某 KR 的 Task 後，相關 Idea 出現「重新評估」提示
- 點擊後觸發分析，新理由帶入最新進度
- 未點擊時舊分數不變

---

### [FEAT-07] AI 引導式 OKR 建立（Guided 流程）

**PRD 對應**：5.11

**影響範圍**：
- `app/okr/new/page.tsx` — 新增「AI 幫我想」入口
- `lib/claude.ts` — `refineObjective`、`suggestKeyResults`、`generateSnapshot` 已存在，串接為流程

**三階段 UI 流程**：
1. 用戶輸入一句話 → 呼叫 `refineObjective` → 顯示建議的 title / motivation / okrType / timeframe，用戶確認或修改
2. 確認後 → 呼叫 `suggestKeyResults` → 顯示 3–5 個建議 KR，用戶勾選或修改
3. 確認 KR → 呼叫 `generateSnapshot` → 顯示 snapshot，用戶確認後儲存

**驗收**：
- 三階段流程可完整走完
- 每個階段用戶可修改 AI 建議再繼續
- 最終儲存結果與手動建立的 Objective 資料結構相同

---

### [FEAT-08] KR 信心度標記 UI

**PRD 對應**：5.12

**影響範圍**：
- `app/okr/[id]/page.tsx` 或 KR 編輯元件 — 加入信心度選擇 UI
- `lib/claude.ts` — `analyzeConfidenceDrop` 已存在，加入呼叫入口

**修改**：
- 每個 KR 旁加入信心度 badge：🟢 on-track / 🟡 at-risk / 🔴 needs-rethink
- 點擊 badge 切換狀態，切換至 at-risk / needs-rethink 後顯示 AI 建議（呼叫 `analyzeConfidenceDrop`）
- AI 建議以 popover 或展開區塊顯示，不跳頁

**驗收**：
- 信心度標記儲存至 Supabase（`key_results` JSONB 中 `confidence` 欄位已定義）
- 標記 at-risk 後，AI 建議 2 秒內顯示
- 建議文字包含「下一步具體行動」

---

## 🟢 Phase 3 — 回顧功能

---

### [FEAT-09] 季度評分 UI

**PRD 對應**：5.13

**影響範圍**：
- 新增 `app/okr/[id]/quarter-review/page.tsx`
- `lib/claude.ts` — `getQuarterRecommendation` 已存在

**頁面內容**：
- 列出 Objective 下所有 KR，每個 KR 有一個 0.0–1.0 的滑桿或數字輸入
- 填完後點「獲得 AI 建議」→ 呼叫 `getQuarterRecommendation`
- 顯示 verdict（continue / complete / reset）與 reasoning
- 用戶確認後，Objective status 更新為 completed 或維持 active

**驗收**：
- 所有 KR 填分後才能點擊獲取建議
- verdict 以視覺化方式呈現（顏色 / icon）
- 選擇「complete」後 Objective 狀態更新，從 Dashboard 消失

---

## 附錄：不做的技術工作（護欄）

| 項目 | 原因 |
|------|------|
| Deadline 作為評分係數 | 用戶變化性太大，降低分數可信度 |
| 目標優先級拖拉排序介面 | 1–3 三級制已足夠，拖拉在手機摩擦高 |
| Dashboard 使用時長最大化功能 | 產品定位是 30 秒決策，不是滯留工具 |
| AI 教練在 OKR 設定流程開頭出現 | 時機錯誤，用戶動機低、摩擦感最強 |
| 離線模式 | 完全依賴 Supabase + Claude API，v3 前不考慮 |

---

## 🔴 Phase 0 補充 — Bug 修復

---

### [BUG-01] Google OAuth 回調失敗

**問題**：用戶點擊 Google 登入後回調失敗，無法完成登入流程。

**已完成的程式碼修復**（`app/auth/callback/page.tsx`）：
1. 新增 `?error=` / `?error_description=` 參數處理，Google 拒絕授權時顯示明確錯誤訊息
2. 隱式/PKCE 無 `?code=` 路徑改為等待 supabase-js 處理 session 後再 redirect，而非立即跳轉

**仍需手動設定（Supabase Dashboard）**：
1. Authentication → URL Configuration → **Site URL**：設為正式網域（或 `http://localhost:3000` 開發環境）
2. Authentication → URL Configuration → **Redirect URLs**：加入 `[domain]/auth/callback`（含 Vercel preview URL wildcard：`https://*-[team].vercel.app/auth/callback`）
3. Google Cloud Console → OAuth 2.0 憑證 → **授權重新導向 URI**：加入 `https://[supabase-project-ref].supabase.co/auth/v1/callback`

**驗收**：Google 登入完整流程走通；Google 拒絕授權時頁面顯示可讀錯誤訊息而非白屏。

---

## 🟠 Phase 1 補充 — 新功能

---

### [FEAT-A] Onboarding 步驟說明卡 + 過場動畫

**優先**：P0（新用戶第一印象）  
**工程量**：S（1–2 天）

**問題**：Onboarding wizard（`app/onboarding/page.tsx`，6 步驟）缺乏步驟引導，用戶不清楚每一步要做什麼。

**範圍**：
- 每個步驟頂部加入步驟說明卡（圖示 + 一句說明 + 小提示）
- 步驟切換加淡入動畫（`opacity` + `translateY` CSS transition）
- Step 2（intent input）與 Step 3（OKR confirm）的主輸入框加 `ring-2 ring-indigo-400` focus glow
- Progress bar 改為有百分比填色的橫條（替換現有進度點）

**影響檔案**：`app/onboarding/page.tsx`、`lib/i18n.ts`

**驗收**：每個步驟有明確說明；步驟切換有動畫；輸入框有視覺焦點提示。

---

### [FEAT-B] AI 工作區正式化（AIWorkspaceDrawer）

**優先**：P1  
**工程量**：M（3–4 天）

**問題**：AI 功能分散在各頁面（tasks 的 Idea Validator、OKR 頁的 OKRChat），用戶無法在任意頁面快速召喚 AI。

**範圍**：
- 新建 `components/AIWorkspaceDrawer.tsx`（右側滑入 drawer，含 OKR Coach / Idea quick-validate / Plan analyzer）
- `components/Sidebar.tsx` 加 AI Workspace 觸發按鈕
- `components/BottomNav.tsx` 加手機版 AI 入口
- 各頁現有 AI 功能原位保留（Drawer 是補充入口）

**影響檔案**：新建 `components/AIWorkspaceDrawer.tsx`、`components/Sidebar.tsx`、`components/BottomNav.tsx`

**驗收**：任何頁面可開啟 Drawer；Drawer 內 OKR Coach 可正常對話；不影響各頁現有 AI 功能。

---

### [FEAT-C] 產品定位凸顯（未登入 Hero + Guest 試用）

**優先**：P1  
**工程量**：S（1–2 天）

**問題**：未登入訪客看不到產品核心價值；首頁直接顯示空白 dashboard，失去轉換機會。

**範圍**：
- `app/page.tsx` 未登入狀態顯示 hero section：主標題「30 秒知道哪個想法最值得做」、副標題、Guest 試用 CTA
- Guest 試用：允許一次 idea validation，不儲存結果，完成後提示登入以保存
- Onboarding Step 1 文案更新：強調「不是 OKR 工具，是決策加速器」

**影響檔案**：`app/page.tsx`、`app/onboarding/page.tsx`、`lib/i18n.ts`

**驗收**：未登入訪客可試用 idea validation；登入後首頁正常顯示 dashboard。

---

### [FEAT-D] AI 理解用戶（User Profile + 輸入重述）

**優先**：P1  
**工程量**：M（3–5 天）

**問題**：AI 對用戶背景一無所知，分析缺乏個人化；用戶輸入模糊時（如「我想變得更好」）AI 無法有效引導。

**範圍**：
1. **User Profile 建立**（Onboarding Step 6 擴充）：加入「用一句話形容你的狀態」輸入，存至 `user_backgrounds` 表（schema 已存在）
2. **AI 輸入重述**：Idea Validator 輸入後，若字數 < 20 字且語意模糊，AI 先輸出「你的意思是：[重述]，對嗎？」供用戶確認或修改，確認版本作為分析輸入
3. **AI 上下文注入**：`lib/evaluation-prompt.ts` 的系統 prompt 加入 user background

**新增函數**：`lib/claude.ts` → `rephraseInput()`  
**新增 API action**：`app/api/ai/route.ts` → `rephraseInput`  
**影響檔案**：`app/onboarding/page.tsx`、`lib/evaluation-prompt.ts`、`lib/claude.ts`、`app/api/ai/route.ts`

**驗收**：新用戶完成 onboarding 有 profile；模糊輸入觸發 AI 重述；AI 分析有個人化語氣（人工 QA）。

---

## 🟡 Phase 2 補充 — 外部整合

---

### [FEAT-E] 外部文字批次匯入

**優先**：P2  
**工程量**：M（3–5 天）

**問題**：用戶的靈感、任務清單散落在外部文件（Notion、Google Docs、會議記錄），目前只能手動逐一輸入，摩擦高。

**範圍（MVP）**：
- Idea Validator 旁加「批次匯入」入口
- 用戶貼入純文字（≤ 500 字），AI 解析成多個 ideas，每個可勾選後加入 Inbox
- 不做 OAuth 整合，純 copy-paste

**新增函數**：`lib/claude.ts` → `parseDocumentToIdeas(text, objectives)`  
**新增 API action**：`app/api/ai/route.ts` → `parseDocument`  
**影響檔案**：`app/tasks/page.tsx`、`lib/claude.ts`、`app/api/ai/route.ts`

**驗收**：貼入 500 字以內文字可解析出 3+ ideas；解析結果可勾選加入 Inbox；解析失敗有友善提示。

---

## 設計討論區（尚未入 ticket）

### 更多人生管理概念

**前提問題**（需先討論才能立 ticket）：
1. Life Domain 如何定義？（健康 / 工作 / 關係 / 學習？還是用戶自定義？）
2. 與現有 Objective 的關係：是 tag 還是獨立層？
3. 跨 domain 的 idea 如何做加權計算？
4. 與 TICKETS.md T02 Identity 層的關係？

**建議**：等 T02（Identity 層）完成後，觀察用戶行為再反推需求。

---

*Ticket 清單對應 PRD v2.0，最後更新 2026-05-16*
