# AI 寫後端實驗

後端由一個個 JS 業務函數組成，由 AI 產出；介面可配置參數運行、步進調試，並自動識別每個函數讀/改了哪些表。無第三方依賴（Node ≥ 20）。

```bash
npm start                         # http://localhost:3000
ANTHROPIC_API_KEY=... npm start   # 啟用右側 AI agent（可選 ANTHROPIC_MODEL）
npm test
```

## 介面
- **左**：函數列表（每個函數自動標出 `R` 讀 / `W` 寫的表）、資料表（點擊瀏覽真實資料）。
- **中**：代碼（行號旁藍=讀、黃=寫）＋ 參數表單（由 `meta.params` 生成）＋ 調試。
  - 「試運行」在資料庫副本上執行，不落庫；「運行並提交」才寫入。出錯則整體回滾，但已執行的步驟仍可回看，並定位到出錯行。
  - **步進**：每次 `db` 調用是一步（⏮ ◀ ▶ ⏭ / 滑桿 / ←→ 鍵），代碼高亮對應行；「表狀態」顯示每張表在該步的樣子（本步讀/增/改/刪的行著色，改動的格子顯示舊值→新值）。
  - **本次改動**：以此參數運行一次，到底改了哪些表的哪些行（新增/修改/刪除 + 欄位級 diff + 只讀的表）。
  - **依賴關係**：靜態分析源碼（含 `const o = db.orders` 別名）＋ 實際運行 trace 合併；並推出上游（寫了我讀的表）/下游（讀了我寫的表）函數。
- **右**：AI agent，一個檔案一個對話（存在 `functions/<name>.chat.json`）。AI 回傳完整檔案，按「套用到編輯器」後自行試運行。可附帶最近一次運行的 trace 供它除錯。

## 函數格式
```js
module.exports = {
  meta: { description: '…', params: { orderId: { type: 'number', default: 1 } } },
  run(db, input) {
    const o = db.sales_orders.get(input.orderId);   // find/findOne/get/count/all
    db.sales_orders.update(o.id, { status: 'X' });  // insert/update/delete
  },
};
```
資料來源目前只有「關係表」（`server/seed.js` 定義 schema 與範例資料，運行時資料在 `data/db.json`）。

## 範例
客戶訂單 → 銷售/技術/品質審核 → 購買申報 → 生產 → 出貨 → 回單確認 → 銷售對帳 → 財務入帳，共 12 個函數。預設參數沿示範訂單 #1 依序「運行並提交」即可走完（見 `test/flow.test.js`）。

## 注意
函數在 `node:vm` 中運行（有超時、無 require），**不是安全沙盒**；不要運行不可信的代碼。
