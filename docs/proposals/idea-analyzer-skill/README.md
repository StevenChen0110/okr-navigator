# Idea Analyzer Skill — 提案說明

> 這是一個提案資料夾，**未實作**。目的是把目前散在 `lib/claude.ts:analyzeIdea` 的判斷邏輯重構成可版本化、可測試、可維護的 skill 結構。

## 為什麼要這樣做

目前 `lib/claude.ts` 有兩個問題：
1. **一致性問題**：`temperature` 沒設、用 regex 摳 JSON、沒有 few-shot，同一個 idea 重跑會給不同分數
2. **維護性問題**：rubric 寫在一個 ~30 行的字串裡，產品/設計要調整必須改 code

這個 skill 結構同時解決兩件事。

## 檔案說明

| 檔案 | 用途 |
| --- | --- |
| `SKILL.md` | rubric 主文件 — 定義打分邏輯、加權、邊界情境 |
| `examples.json` | 10 個 few-shot 校準錨點，會被自動注入 prompt |
| `output_schema.json` | tool use 的 input_schema（待補） |
| `eval/golden.json` | 100 個黃金測試案例，每次改 rubric 必須重跑（待補） |
| `version` | 純文字版本號，每次 rubric 變動 +1 |

## 預期使用流程

```
使用者送出 idea
  ↓
lib/claude.ts:analyzeIdea() 載入此 skill 資料夾
  ├─ 讀 SKILL.md → 組成 system prompt
  ├─ 讀 examples.json → 注入 few-shot
  └─ 讀 output_schema.json → 設定 tool use
  ↓
呼叫 Claude API（temperature=0, tool_choice 強制此 tool）
  ↓
解析 tool_use.input（已是 JSON object，無須 regex）
  ↓
回傳結果
```

## 一致性保證的責任分工

| 由誰負責 | 內容 |
| --- | --- |
| 程式（`lib/claude.ts`） | `temperature: 0`、`tool_use`、prompt cache、模型版本鎖定、retry 邏輯 |
| Skill（此資料夾） | rubric、加權、邊界情境、few-shot 範例 |
| Eval（CI） | 每次 PR 跑 golden.json，分數平均變動 > 0.5 警告 |

**Skill 本身不保證一致性。一致性是 temperature + tool use + skill 三者組合出來的。**

## 預期需要的程式改動（在 P0/P1 ticket 之外）

如果決定走這條路，會新增一個 ticket：

> **T-AI-01｜把 `analyzeIdea` 重構成 skill-based 呼叫**
> - 抽出 `lib/skills/idea-analyzer/loader.ts`，從此資料夾載入 SKILL.md + examples.json
> - 改 `analyzeIdea()` 為 `temperature: 0`、`tool_use` 模式
> - 新增 `eval/run.ts` CI 腳本，PR 觸發
> - 工程量：M（3–4 天）
> - 風險：rubric 從「自由文字」變「強規則」可能讓部分 edge case 變得太剛性，需在 eval 過程觀察

## 待你決定的問題

1. **rubric 的細度**：目前邊界情境（學習類、整理類、聊聊類）寫得相當具體。是否同意這種「強規則 > AI 自由判斷」的取捨？
2. **eval 的標準**：金樣本 100 個夠嗎？要 5 個還是 20 個邊界情境？
3. **失敗時的 UX**：當 AI 給出 `status: no-objective` 或 `status: fallback` 時，前端要怎麼呈現？
4. **多模型一致性**：當使用者切換 haiku → sonnet → opus，是否要保證同一 idea 給「同一分數」？還是允許「同一排序、分數可微調」？這會影響 rubric 嚴格度設計。
