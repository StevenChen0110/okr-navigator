# Idea Analyzer Skill

> 草稿 v0.1（提案中，未實作）。把目前 `lib/claude.ts` 中 `analyzeIdea` 的 system prompt 重構成此 skill。

---

## 用途

評估使用者輸入的一個「想法 / 任務」對其當前 OKR 的助益程度，產出 0–10 分的多層評分、風險清單、執行建議。

## 何時觸發

- 使用者在 `+ 新增任務` 或 `腦倒` 流程中送出一個 idea
- 使用者點擊既有任務的「重新評估」
- 週檢視時批次重評 inbox 項目

## 一致性保證機制（程式端負責，非 prompt 內容）

| 項目 | 設定 |
| --- | --- |
| `temperature` | **0**（強制） |
| `model` | `claude-haiku-4-5-20251001` 或 settings 指定，**不可用 alias** |
| 輸出 | 透過 `tool_use`（schema 見下方 `output_schema.json`），**不解析自由文字** |
| Prompt cache | rubric + examples 區塊永遠 cache（cache_control: ephemeral） |
| 版本 | 此 SKILL.md 開頭的 v0.1 為版本號，每次 rubric 變動必須 +1 並更新 `eval/golden.json` |

---

## 評分 rubric（核心一致性錨點）

對「這個 idea 對某個 Objective 的助益程度」給 0–10 分。每個 KR 也獨立打一個分數。

| 分數區間 | 定義 | 必要條件 |
| --- | --- | --- |
| 0–1 | 無關或反向 | 完全不在 Objective 路徑上，或會排擠資源 |
| 2–3 | 微弱間接 | 可能間接影響，需要長鏈推理才能說出關聯 |
| 4–5 | 中等貢獻 | 推進 1 個 KR 約 5–15%，路徑直接但非決定性 |
| 6–7 | 強貢獻 | 推進 1 個 KR > 15%，或同時推進 2+ KR |
| 8–9 | 關鍵 | 直接決定一個 KR 是否達標 |
| 10 | 不可或缺 | 沒做這件事，整個 Objective 不可能達成 |

### 加權因子（必須在 reasoning 中明寫應用了哪一條）

1. **進度落後加權**：當前 KR 完成度 < 預期完成度（依 deadline 比例）→ 該 KR 分數 +1，最多 +2
2. **時間敏感加權**：deadline ≤ 14 天 → 該 KR 分數 +0.5
3. **重複性扣權**：使用者過去 30 天內已建立 ≥ 3 個語意相似的 idea → 全 Objective 分數 −1
4. **風險扣權**：identifying ≥ 1 個會傷害另一個 Objective 的副作用 → finalScore −1

### 邊界情境（一律照這裡判，不靠 AI 自由發揮）

- **「學習 X」類 idea**：除非 X 直接出現在 Objective 或 KR 文字中，預設給 2–3 分（避免泛學習傾向高估）
- **「整理 / 規劃 / 思考」類 idea**：預設給 1–2 分（後設行為，非執行行為）
- **「跟人聊聊 / meet」類 idea**：若沒寫對方是誰、聊什麼，給 1–3 分；寫清楚後重評
- **「休息 / 運動 / 睡覺」類 idea**：除非 Objective 包含健康類，否則給 0–2 分（不是評斷對錯，是評斷對「這個 OKR」的助益）
- **沒有任何 Objective 時**：finalScore = null，不強行打分；輸出建議使用者先設 Objective

---

## 推理輸出規範

每個 Objective 的 `reasoning` 必須：
- 1 句話講路徑（這個 idea 透過什麼機制影響此 Objective）
- 1 句話講分數依據（套用了哪條加權 / rubric 區間）
- 不寫廢話、不寫鼓勵語、不寫「加油」「很棒」之類

每個 KR 的 `reasoning`：1 句話即可，必須點名是推進了「目標 → 現值差距」的哪一段。

---

## Few-shot 校準錨點

詳見 `examples.json`。原則：每個 0–10 區間至少 1 個範例，邊界情境（學習類、整理類、聊聊類）各 1 個。任何 rubric 變動都要重審範例是否還對齊。

---

## 失敗處理

- AI 拒答 / 超時：回傳 `{ status: "fallback", finalScore: null }`，由前端顯示「先手動評估」
- JSON schema 不符（理論上 tool use 不會發生，保險）：retry 一次，仍失敗 → fallback
- 任何重試**不允許改變 prompt**（避免「換個說法 AI 就過」造成的不可重現）

---

## 版本紀錄

| 版本 | 日期 | 變動 | golden eval 平均分變動 |
| --- | --- | --- | --- |
| v0.1 | 2026-04-26 | 初版草稿 | — |
