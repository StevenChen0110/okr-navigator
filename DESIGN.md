# Design System

規範所有頁面的排版、字型、間距規則，確保一致的視覺語言。

---

## Typography

| 用途 | Class |
|------|-------|
| 頁面主標題 | `text-xl font-semibold text-gray-900` |
| 頁面副標題 / 標語 | `text-xs text-gray-400` |
| 區塊標題 | `text-sm font-semibold text-gray-700` |
| 一般文字 | `text-sm text-gray-700` |
| 輔助文字 / meta | `text-xs text-gray-500` |
| 極小標籤 | `text-[10px] text-gray-400` |
| 連結 | `text-xs text-indigo-500 hover:text-indigo-700` |

---

## Spacing

### 頁面容器
- **窄版（單欄頁面）**：`max-w-xl mx-auto px-4 pt-6 pb-8 md:px-6 md:pt-8`
- **分欄頁面（工作區開啟）**：左欄 `w-[420px] shrink-0`，右欄 `flex-1`

### 頁面標頭（page header）
- `px-4 pt-6 pb-5 md:px-6`
- 標題 + 副標題垂直間距：`mt-0.5`
- 按鈕組與標題同行：`flex items-center justify-between gap-3`

### 卡片 / 區塊
- Padding：`p-4`，小型卡片：`p-3`
- Border radius：`rounded-xl`
- Border：`border border-gray-100` 或 `border border-gray-200`

### 列表行
- `px-4 py-3`
- 展開後 padding bottom：`pb-4`

### 輸入欄位
- 單行容器：`px-3 py-2`，字型 `text-sm`
- Focus ring：`focus:outline-none focus:ring-2 focus:ring-indigo-400`

---

## Colors

| 用途 | Token |
|------|-------|
| 主色（互動、CTA）| `indigo-600` |
| 主色 hover | `indigo-700` |
| 主色淺底 | `indigo-50` + `border-indigo-200` |
| 文字主色 | `gray-900` |
| 文字次要 | `gray-700` |
| 文字輔助 | `gray-500` / `gray-400` |
| 邊框淡 | `gray-100` |
| 邊框一般 | `gray-200` |
| 背景淡 | `gray-50` |
| 警告 / 中等 | `amber-500` |
| 成功 | `green-500` |
| 刪除 / 危險 | `red-400` |

---

## Buttons

### 主要按鈕（CTA）
```
px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium
hover:bg-indigo-700 disabled:opacity-40 transition-colors
```

### 次要按鈕（border style）
```
px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500
hover:text-gray-700 hover:border-gray-300 transition-colors
```

### 工作區切換按鈕（active / inactive）
```
flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors
inactive: border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300
active:   bg-indigo-50 border-indigo-200 text-indigo-600
```

### 圓角 pill 標籤（filter tabs）
```
text-xs px-2 py-0.5 rounded-full transition-colors
active:   bg-indigo-600 text-white
inactive: text-gray-400 hover:text-gray-600
```

### 關閉按鈕
```
text-gray-300 hover:text-gray-500 text-xl leading-none transition-colors
```

---

## Layout Patterns

### 單欄頁面（目標、設定）
```
<div className="flex flex-1 min-h-0">
  <div className="flex-1 min-w-0 overflow-y-auto">
    <div className="max-w-xl mx-auto px-4 pt-6 pb-8 md:px-6 md:pt-8 space-y-5">
      {/* 標頭 */}
      {/* 內容 */}
    </div>
  </div>
  {/* 可選：AI 工作區側欄（desktopChatOpen 時顯示） */}
  {chatOpen && <div className="hidden lg:flex w-[380px] shrink-0 ...">...</div>}
</div>
```

### 分欄頁面（任務）
```
<div className="flex h-screen flex-col">
  {/* Mobile tabs */}
  <div className="lg:hidden shrink-0 flex border-b border-gray-100 h-10">...</div>
  {/* Split */}
  <div className="flex flex-1 min-h-0">
    {/* 左欄：任務清單（含 page header） */}
    <div className={workspaceOpen ? "lg:w-[420px] lg:shrink-0" : "w-full"}>...</div>
    {/* 右欄：AI 工作區 */}
    {workspaceOpen && <div className="flex-1 ...">...</div>}
  </div>
</div>
```

---

## AI Workspace Toggle Button

所有頁面統一使用以下 icon + 文字按鈕觸發 AI 工作區：

```tsx
<button
  onClick={toggleWorkspace}
  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors
    ${open ? "bg-indigo-50 border-indigo-200 text-indigo-600"
            : "border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300"}`}
>
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
    <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
  AI 工作區
</button>
```

---

## Page Header Pattern

每個頁面標頭包含：
1. 主標題（`text-xl font-semibold`）
2. 副標題（`EditableTagline` — 可點擊編輯，存於 localStorage）
3. 右側操作按鈕組

```tsx
<div className="flex items-center justify-between gap-3">
  <div className="min-w-0">
    <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
    <EditableTagline storageKey="tagline_{page}" defaultText="..." />
  </div>
  <div className="flex items-center gap-2 shrink-0">
    {/* actions */}
  </div>
</div>
```
