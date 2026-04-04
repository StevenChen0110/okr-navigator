export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 md:px-6">
      <h1 className="text-xl font-semibold mb-2">隱私政策</h1>
      <p className="text-xs text-gray-400 mb-8">最後更新：2026 年 4 月</p>

      <div className="space-y-6 text-sm text-gray-700 leading-relaxed">
        <section>
          <h2 className="font-medium text-base mb-2">我們蒐集什麼資料</h2>
          <p>
            我們蒐集你在使用 OKR Navigator 時主動輸入的資料，包含：
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-600">
            <li>帳號資訊（Email、加密後的密碼）</li>
            <li>你建立的 OKR 目標與 Key Results</li>
            <li>你提交分析的 Idea 及 AI 回傳的分析結果</li>
          </ul>
          <p className="mt-2">
            你在「設定」頁輸入的 AI API Key 僅儲存在你的瀏覽器本地，不會傳送至我們的伺服器。
          </p>
        </section>

        <section>
          <h2 className="font-medium text-base mb-2">資料如何使用</h2>
          <p>我們使用這些資料的目的只有一個：提供 OKR Navigator 的核心功能。我們不會：</p>
          <ul className="list-disc pl-5 mt-2 space-y-1 text-gray-600">
            <li>將你的資料出售或分享給第三方</li>
            <li>用你的資料進行廣告投放</li>
            <li>主動閱讀你的 OKR 或 Idea 內容</li>
          </ul>
        </section>

        <section>
          <h2 className="font-medium text-base mb-2">資料儲存</h2>
          <p>
            你的資料儲存於{" "}
            <a
              href="https://supabase.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:underline"
            >
              Supabase
            </a>{" "}
            提供的資料庫服務，位於美國。Supabase 符合 SOC 2 Type II 安全標準。
            每位使用者的資料透過資料庫層級的存取控制（Row Level Security）隔離，其他使用者無法存取你的資料。
          </p>
        </section>

        <section>
          <h2 className="font-medium text-base mb-2">你的權利</h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>你可以隨時刪除你建立的任何 OKR 或 Idea</li>
            <li>你可以要求刪除帳號及所有相關資料</li>
          </ul>
        </section>

        <section>
          <h2 className="font-medium text-base mb-2">聯絡我們</h2>
          <p>如有任何隱私相關問題，請透過 GitHub 聯絡我們。</p>
        </section>
      </div>
    </div>
  );
}
