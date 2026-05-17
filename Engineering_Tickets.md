# OKR Navigator — Engineering Ticket 清單

**對應版本**：PRD v3.0  
**日期**：2026-05-17  
**優先順序**：MVP → Phase 2 → Phase 3 → Design Review

標籤說明：
- `MVP` — 核心功能，目前衝刺
- `Phase 2` — 體驗深化，下一輪
- `Phase 3` — 長期願景
- `Design Review` — 需先討論設計才能立工程任務

---

## FIX — Bug 修復

---

### [FIX-001] 跨裝置登入回復性（手機 Google 登入失敗） `MVP`

手機瀏覽器限制問題 Google OAuth 登入（iOS Safari / Android Chrome）和其他登入方式（Apple / Google / 帳號密碼）和其他方式（Apple / Google）。

**已完成的程式碼修復**（`app/auth/callback/page.tsx`）：
1. 新增 `?error=` / `?error_description=` 參數處理，Google 拒絕授權時顯示明確錯誤訊息
2. 隱式/PKCE 無 `?code=` 路徑改為等待 `onAuthStateChange` 接收 session 後再 redirect（加 2s fallback）

**仍需手動設定（Supabase Dashboard）**：
1. Authentication → URL Configuration → **Site URL**：設為正式網域（或 `http://localhost:3000`）
2. Authentication → URL Configuration → **Redirect URLs**：加入 `[domain]/auth/callback`（Vercel preview：`https://*-[team].vercel.app/auth/callback`）
3. Google Cloud Console → OAuth 2.0 → **授權重新導向 URI**：加入 `https://[project-ref].supabase.co/auth/v1/callback`

**狀態**：程式碼已實作 ✅，Supabase Dashboard 需手動設定

---

## DISC — 產品定位凸顯入口

---

### [DISC-001] 連結到首頁入口，口號「驅動指針」為核心功能 `MVP`

重新理解用戶需求：達到用戶目標，具體。主題：建立、監控、調整，CTA 驅動「把它記下來，再分析」的用戶。而非 entry point 讓隨意用戶進來就好，不靠 OKR 設定。

**範圍**：
- 未登入首頁顯示 hero section：主標題「30 秒知道哪個想法最值得做」
- 副標題說明差異化（連結你的目標，AI 秒算貢獻度）
- Guest 試用 CTA：允許一次 idea validation 不需帳號
- 登入後首頁正常顯示 dashboard，不干擾主流程

**影響檔案**：`app/page.tsx`、`app/onboarding/page.tsx`、`lib/i18n.ts`

**狀態**：已實作 ✅（FEAT-C）

---

## OB — Onboarding 新手引導

---

### [OB-001] Onboarding 成功用戶故事 `MVP`

用戶文字說明核心流程：驗證想法 → 輸入想法 → AI 分析 → 決策建立加入待辦 → 記錄進度 → 定期生成報告（下一步）知道什麼不重要了。

Onboarding 每一步驟有明確的「成功用戶故事」指引，讓新用戶知道為什麼要做這一步。

**範圍**：
- 每個步驟頂部加入步驟說明卡（圖示 + 一句說明 + 小提示）
- 步驟切換加淡入動畫（`opacity` + `translateY` CSS transition）
- Step 2（intent input）與 Step 3（OKR confirm）主輸入框加 `ring-2 ring-indigo-400` focus glow
- Progress bar 改為有百分比填色的橫條（替換現有進度點）

**影響檔案**：`app/onboarding/page.tsx`、`lib/i18n.ts`

**狀態**：已實作 ✅（FEAT-A）

---

### [OB-002] Onboarding 況域分塊 `MVP`

一次完整可以交互的流程：清單 → 生成真實 OKR，不需要漫長 onboarding 評估，用戶自主試驗。讓用戶在進入 app 後盡快體驗核心循環，而非被卡在設定步驟。

**範圍**：
- 檢視 Onboarding 各步驟是否可省略或重組
- 確保每一步完成後都能感受到「我有產出東西」
- Step 1 文案強調「不是 OKR 工具，是決策加速器」

**影響檔案**：`app/onboarding/page.tsx`、`lib/i18n.ts`

**狀態**：部分實作（Step 1 文案已更新）

---

## PHIL — 設計哲學 | 最小輸入、最大效率

---

### [PHIL-001] "AI 先策略，用戶精緻" 互動 pattern `Design Review`

結構清楚是終：AI 先輸出結果，用戶在輸出後確認，讓後可以改/調整/重新嘗試。AI 先輸出 OKR 設定，先 profile，先 AI 匹配 pattern，再讓用戶細調。

**討論方向**：
- 目前流程是「用戶輸入 → AI 分析」，要轉換為「AI 先給建議 → 用戶確認/修改」
- 影響 Onboarding、Idea Validator、OKR 建立等所有 AI 互動入口
- 需定義「AI 先輸出」的資訊完整度標準（避免 AI 亂猜）

---

### [PHIL-002] 標準輸出設計規範，雙語輸出（或 label 標示）`Design Review`

標準輸出標準：意見 optional，output 帶有 label 的「標準」選項，讓用戶可以選「你確認了嗎？」的 label 型 copy 元素。

**討論方向**：
- 所有 AI 輸出統一格式（建議 / 理由 / 下一步）
- 雙語輸出策略：zh-TW 為主，en 作為 label 標示還是完整翻譯？
- 定義哪些輸出是「標準選項」（可直接 apply），哪些需要用戶確認

---

## INTEL — AI 理解用戶

---

### [INTEL-001] 差異化清楚告知（AI 識清用戶真意圖） `MVP`

用戶輸入模糊或情緒化的想法時，AI 識清真正想表達的事，推導出清晰意圖後分析，告知分類比較與最終建議，參考 AI 功能已知的相關信息，收到具體建議。

**範圍**：
1. **User Profile 建立**（Onboarding Step 6 擴充）：「用一句話形容你的狀態」，存至 localStorage
2. **AI 輸入重述**：輸入 < 20 字且語意模糊時，AI 先輸出「你的意思是：[重述]，對嗎？」供用戶確認或修改
3. **AI 上下文注入**：`lib/evaluation-prompt.ts` 的系統 prompt 加入 user background

**新增函數**：`lib/claude.ts` → `rephraseInput()`  
**新增 API action**：`app/api/ai/route.ts` → `rephraseInput`

**狀態**：已實作 ✅（FEAT-D）

---

### [INTEL-002] 深入分析個人儲案：本地儲案 / Notion / Google Drive `Phase 3`

用戶的個人儲案（工作文件、會議記錄）上傳或連接 Notion workspace / Google Drive 文件，作為「了解個人背景」的資料，讓後續的 AI 分析真正個人化。

**範圍**：
- Notion OAuth 整合：讀取用戶指定的 workspace 或 page
- Google Drive OAuth 整合：讀取指定文件夾
- AI 將個人儲案建立成 user context vector，注入所有分析提示詞
- 定期更新（每週同步一次）

**前置條件**：INTEL-001 完成，DB-001 完成

---

## IDEA — 想法相關功能

---

### [IDEA-001] 想法成長形成（零碎文字輸入） `MVP`

第一大字形：想法起點是 Placeholder，持續讓用戶輸入零碎想法，進而到 AI 演算整合，加入 AI 演進量。

支援批次貼入文字，AI 解析成多個獨立 ideas，可個別勾選加入 Inbox。

**範圍**：
- Idea Validator 旁加「批次匯入文件 ↗」入口
- 用戶貼入純文字（≤ 2000 字），AI 解析成 3–10 個 ideas
- 每個解析出的 idea 可個別勾選加入 Inbox
- 解析失敗時有友善錯誤提示

**新增函數**：`lib/claude.ts` → `parseDocumentToIdeas()`  
**新增 API action**：`app/api/ai/route.ts` → `parseDocument`

**狀態**：已實作 ✅（FEAT-E）

---

### [IDEA-002] AI 連菜評估（邊一難題，可改稿） `MVP`

開始中有文字評估「如果是你自己，你會怎麼做？」個人風格問，提示感 → 讓 AI 帶出想法進入 OKR → 決策支援 → 最終結果。用戶可在評估過程中修改 AI 的輸出。

**範圍**：
- Idea 分析後可「繼續追問」（inline chat，不需跳頁）
- AI 針對分析結果給出「下一步具體建議」
- 用戶可 tag AI 的建議為「我要做」→ 自動建立 Task
- 分析結果可以重新提交（更新補充說明後再分析一次）

**影響檔案**：`app/page.tsx`（Idea Validator 區塊）、`lib/claude.ts`

---

### [IDEA-003] 精確率提升（Iqiai 引擎 / 收集，目前精確率） `Phase 2`

基礎 trigger 判斷，觸發進入 IDEA 邏輯，判斷是不是一個「想法」，改善 label 型 copy，優化輸出質量。

**範圍**：
- 分析前先判斷輸入是否為有效「想法」（vs. 指令、問句、雜訊）
- 若不是想法，提示用戶「這看起來像指令，你是否想說：[重述]？」
- 優化 `buildEvaluationPrompt` 的提示詞，提升分析準確率
- 建立人工 QA 評分機制（至少 20 筆真實用戶輸入 → 驗收準確率 ≥ 80%）

---

### [IDEA-004] 決策圖表（選擇 / 決策 / 錯誤） `Phase 2`

視覺化呈現用戶的決策歷史：哪些想法被採納、哪些被放棄、最終結果如何，讓用戶回頭複盤自己的決策模式。

**範圍**：
- Archive / 歷史頁面：所有已評估 ideas 的時間軸
- 每個 idea 卡片顯示：評估分數、最終決策（做了 / 沒做）、結果（若有關聯 KR 進度）
- 過濾器：按 Objective / 時間範圍 / 決策結果
- 簡易決策統計：「這個月你評估了 X 個想法，其中 Y% 轉化為行動」

**前置條件**：DB-001 完成

---

### [IDEA-005] 提供 OKR 與預設角色，按類 OKR 策略 `Phase 3`

根據用戶的角色（ROLE）和目標類型，AI 提供對應的 OKR 模板和策略建議，降低從零開始設 OKR 的摩擦。

**範圍**：
- 建立 OKR 模板庫（按角色 × 目標類型 × 時間跨度）
- 新用戶完成 ROLE 設定後，AI 推薦 3 個 OKR 方向供選擇
- 用戶可直接套用模板再修改，不需從空白開始

**前置條件**：ROLE-001 完成

---

### [IDEA-006] 想法圖 / Archive `Phase 3`

所有 ideas 的可視化空間，以時間或主題分群顯示，讓用戶感受到「我的想法在成長」。

**範圍**：
- 圖形化 Archive 頁面（非列表，而是 cluster 或 timeline 視圖）
- 相似 ideas 自動分群（AI embedding 相似度）
- 每個 idea 可加標籤、備註、連結至 OKR

---

## WEB — 外部資料分析 / AI 主動搜集

---

### [WEB-001] 廣觀想法分析（自主爬取相關資料） `Phase 2`

廣觀想法分析：AI 自主搜尋相關資料，分析知識背景，判斷想法的適當性，提供更有根據的具體建議（而非純靠用戶的 OKR 列表）。

**範圍**：
- 分析 idea 時，觸發 web search（Bing / Brave / Exa API）
- 搜尋結果摘要注入 prompt（≤ 500 token）
- 分析理由中可引用外部資訊（帶來源標注）
- 可關閉此功能（設定頁）

---

### [WEB-002] 競品況狀研究（社交媒體、公眾資料分析） `Phase 2`

針對商業或創業類想法，AI 搜尋公開資料（如 Reddit、Twitter/X 等），分析市場現狀與競爭格局，讓「個人 AI」了解外部環境。

**範圍**：
- 當想法被分類為「商業 / 創業」時，選擇性觸發競品分析
- 搜尋相關討論、公司、產品，摘要後注入分析 context
- 顯示「市場訊號」區塊（非侵入式，可收合）

---

## AIW — AI 工作區

---

### [AIW-001] 石育連出 AI 對話庫（不換頁直找） `MVP`

在任何頁面不換頁就能召喚 AI 工作區，持續對話，直到目標達成，在整個工作流程中保持 AI context。

**範圍**：
- 新建 `components/AIWorkspaceDrawer.tsx`（右側滑入 drawer）
- 包含：OKR Coach chat、Idea quick-validate 輸入框、Plan analyzer
- `components/Sidebar.tsx` 加 AI Workspace 觸發按鈕（桌面版）
- `components/BottomNav.tsx` 加 AI 按鈕（手機版）
- 各頁面現有 AI 功能原位保留（Drawer 是補充入口）
- Chat history 用 localStorage 存（key: `aiWorkspaceChat`）

**影響檔案**：新建 `components/AIWorkspaceDrawer.tsx`、`components/AIWorkspaceContext.tsx`、`components/Sidebar.tsx`、`components/BottomNav.tsx`、`app/layout.tsx`

**狀態**：已實作 ✅（FEAT-B）

---

### [AIW-004] 長期對話互動：使用 AI 與其時文思想對話模式 `Phase 3`

長期對話互動使用 AI 與其時文思想對話模式，AI 了解成長軌跡、記憶所有工作，建立「個人 AI」的感受。

**範圍**：
- AI 工作區對話歷史長期保存（Supabase，不再純 localStorage）
- AI 可主動回顧過去的對話（「上次你說要...」）
- 建立用戶 AI 記憶層（user memory graph）
- 定期生成「AI 觀察」推送（週報 / 月報形式）

**前置條件**：INTEL-001、DB-001 完成

---

## ROLE — 角色人生

---

### [ROLE-001] Layer 0：預設的角色 + AI 自動培養路線 `MVP`

預設生成 roles（學生、工作者、父母、個人成長等），以身份特質為基礎，定義各 role 的 OKR 方向。AI 自動建議如何強化當前 role。

**範圍**：
- 用戶在 Onboarding 選擇 1–3 個預設 role
- 每個 role 有預設的 OKR 方向建議
- AI 分析 idea 時考慮用戶的 role 權重
- 首頁 dashboard 按 role 分群顯示 OKR

**前置條件**：DB-002 完成

---

### [ROLE-002] Layer 1：月度查查庫（拆解精準 + 「AI 預劃」） `MVP`

月度目標拆解：建立高精準月度清單，針對定目標的 AI 自動分析各 role，生成「這些最好的時機？」或「你想嘗試嗎？」的 AI 預劃建議，以小步快跑入門。

**範圍**：
- 每月初 AI 生成「本月建議聚焦行動」（按 role 分類）
- 用戶可確認、修改、或忽略 AI 建議
- 建議轉化為 Task 後自動關聯至對應 OKR KR
- 月底 AI 回顧：「本月你對各 role 的投入比例」

**前置條件**：ROLE-001 完成

---

### [ROLE-003] Layer 2 或 入口 UX `Phase 2`

月度目標拆解（以用戶選擇超出的比例），達成過去 72% 的比例出現，提供 Layer 2 的進階 UX 入口給成熟用戶。

**範圍**：
- 用戶達成月度目標 ≥ 72% 時，解鎖 Layer 2 功能
- Layer 2：跨 role 的 trade-off 分析（同樣時間，做 A 還是 B 對哪個 role 更有價值？）
- 視覺化 role 平衡雷達圖

**前置條件**：ROLE-002 完成

---

### [ROLE-004] Layer 3：角色個人化設定 `Phase 3`

自訂 roles 名稱 / 圖示 / 顏色 / 權重，高級用戶設定個人化設備，調整各 role 的比重（例如「職業 40%、家庭 40%、個人 20%」）。

**範圍**：
- Role 設定頁：完整 CRUD 操作
- 自訂 role 的 icon、顏色、描述
- 設定各 role 的時間/精力權重
- AI 在分析時根據用戶設定的權重調整建議

**前置條件**：ROLE-002、DB-002 完成

---

## LOOP — 多步驟整合

---

### [LOOP-001] 觸徑優化「確定 OKR」改為「驅動指標」 `Phase 2`

觸徑優化：將 Onboarding → 中心點的 AI 過程整合 → AI 設 OKR → 鏈接 → 任務入口，改為以「驅動指標」（leading indicator）為核心語言，而非 OKR 術語。

**範圍**：
- 評估全站 OKR 術語的替換（哪些改、哪些保留）
- Onboarding 流程重組：以「你想追蹤什麼？」為入口
- 文案從 OKR 術語改為用戶語言（「目標」、「指標」、「追蹤項」）

**前置條件**：OB-001、OB-002 完成

---

### [LOOP-002] 驗證核心 OKR 流程各頁面連通性 `Phase 2`

驗證「建立 3 條 OKR 之後，3 個 OKR 達成後，用一條路完整走完」的核心閉環流程在各頁面間是否暢通無阻。

**驗收清單**：
- [ ] 未登入用戶可以在首頁試用 idea validation
- [ ] 新用戶可以完整走完 onboarding（step 1-6）並建立第一個 OKR
- [ ] 登入用戶可以在 `/tasks` 新增任務、完成任務
- [ ] 可以生成並查看 `/report` weekly alignment report
- [ ] Google OAuth 登入可以正常完成
- [ ] OKR → Task → Report 的資料鏈路無斷點

---

## EXT — 外部個人數據匯入

---

### [EXT-001] Google Calendar 匯入 `Phase 2`

接受 Google Calendar 事件，指定時間範圍，可以「我做了什麼」或「工作項目」在 scheduled 後，展現自動同步到任務清單，讓用戶選擇有意義的事件標記為已完成任務。

**範圍**：
- Google Calendar OAuth 整合（read-only scope）
- 用戶選擇時間範圍（今天 / 本週 / 自訂）
- 讀取事件列表，AI 篩選出「有意義的工作事件」
- 用戶勾選後加入 completed tasks 清單
- 可選：自動關聯至對應 OKR KR

---

### [EXT-002] GitHub Commits 匯入 `Phase 3`

讓技術用戶可以手動指定時間範圍，讀取 commit 訊息，用來生成「我做了什麼」的真實清單，讓 AI 總結貢獻，自動對應至 KR 進度。

**範圍**：
- GitHub OAuth 整合（read repo commits）
- 指定 repo 和時間範圍
- AI 解析 commit messages → 生成工作摘要
- 自動對應至相關 OKR KR

---

### [EXT-003] 雙機器指揮界面（iOS / Android API） `Phase 3`

通過 iOS Shortcuts / Android Tasker API 端點，讓用戶快速從手機捷徑加入新任務，AI 識清意圖後自動分類。

**範圍**：
- 建立 `/api/quick-add` endpoint（支援 API key 認證）
- iOS Shortcuts 範本（可下載安裝）
- Android Tasker 設定說明
- AI 接收自然語言輸入後自動分類為 task / idea

---

## DB — 數據庫

---

### [DB-001] 新增 Ideas 資料表

**Schema**：

```sql
create table ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  text_raw text,
  text_ai_clarified text,
  text_final text,
  trigger_flags jsonb,       -- 觸發器標記
  scores jsonb,              -- objectiveScores, overallScore
  web_research_summary text,
  risks jsonb,
  decision text,             -- 'accepted' | 'rejected' | 'deferred' | null
  created_at timestamptz default now()
);
```

**目前**：ideas 資料存在 localStorage，需遷移至 Supabase。

**前置條件**：SEC-02（RLS 政策確認）

---

### [DB-002] 擴展 roles 管理（多 layer 路線）

**Schema**：

```sql
create table roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  emoji text,
  layer int check (layer in (0,1,2,3)),
  inferred boolean default false,
  user_confirmed boolean default false,
  weight numeric default 1.0,
  created_at timestamptz default now()
);

create table role_goals (
  id uuid primary key default gen_random_uuid(),
  role_id uuid references roles not null,
  objective_id uuid references objectives not null,
  role_confidence numeric,
  created_at timestamptz default now()
);
```

---

## LIFE — 人生管理框架演化

---

### [LIFE-001] 定義家庭與個人的人生管理理念及具體功能演化 `Design Review`

定義家庭與個人的人生管理理念及具體功能演化（生命週期：從年度 OKR → 到 Life Roles → 到家庭共同目標 → 到人生 milestones）。

**需討論的前提問題**：
1. Life Domain 如何定義？（健康 / 工作 / 關係 / 學習？還是用戶自定義？）
2. 與現有 Objective 的關係：是 tag 還是獨立層？
3. 家庭/夥伴共同目標的協作模式？
4. 跨 domain 的 idea 如何做加權計算？
5. 與 ROLE Layer 體系的關係和邊界在哪？

**參考框架**：Iqiai / Lean Startup / Life Roles / OGSM

**建議**：等 ROLE-001、ROLE-002 完成並有用戶行為資料後，再反推這層的設計。

---

## 安全底線（不動）

| 項目 | 狀態 |
|------|------|
| [SEC-01] Claude API Key 移至後端 Proxy | ✅ 已完成（`app/api/ai/route.ts`） |
| [SEC-02] Supabase RLS 政策啟用 | 需確認 Dashboard 設定 |

---

*最後更新：2026-05-17*
