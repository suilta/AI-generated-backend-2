'use strict';
// AI agent：一個檔案一個對話。通過 Anthropic Messages API 產出完整的函數檔案。
// 需要環境變數 ANTHROPIC_API_KEY；可選 ANTHROPIC_MODEL、ANTHROPIC_BASE_URL。

const API_DOC = `
你在為一個企業後端撰寫「業務函數」。每個函數是一個 JS 檔案，格式固定（CommonJS）：

module.exports = {
  meta: {
    description: '一句話說明業務含義',
    params: { orderId: { type: 'number'|'string'|'boolean'|'json', default: 1, description: '...' } },
  },
  run(db, input) { /* 同步或 async 都可以，回傳值會作為結果 */ },
};

db 的用法（資料來源只有關係表；所有方法同步返回）：
  db.<表名>.find(where?)      -> 行陣列。where 可為 {欄位: 值}、函數 row=>bool、或 id 數字
  db.<表名>.findOne(where)    -> 單行或 null
  db.<表名>.get(id)           -> 單行或 null
  db.<表名>.count(where?)     -> 數字
  db.<表名>.all()             -> 全部行
  db.<表名>.insert(row | rows[]) -> 插入並返回含 id 的行（不可指定 id；缺的欄位為 null）
  db.<表名>.update(where, patchObject | row=>patch) -> 返回影響行數（不可改 id）
  db.<表名>.delete(where)     -> 返回刪除行數
  db.table('表名') 等價於 db.表名。

規則：
- 不可使用 require / fetch / 檔案系統等，只有 db、input、標準 JS。
- 業務校驗失敗就 throw new Error('中文說明')，整次運行會回滾。
- 只能用 schema 裡存在的表與欄位，型別必須吻合，否則寫入會報錯。
- 每次 db 調用都是調試器的一步，請讓讀、寫的邏輯清楚，不要用大量無意義的小調用。
- 回覆時先用兩三句說明你做了什麼，然後給出「完整的檔案內容」放在一個 \`\`\`js 代碼塊裡（只放一個代碼塊）。
`;

function schemaText(db) {
  return db.tableNames().map((n) => {
    const s = db.schema[n];
    const cols = Object.entries(s.columns).map(([c, t]) => `${c}:${t}`).join(', ');
    return `- ${n}（${s.label}）: id:number, ${cols}`;
  }).join('\n');
}

function extractCode(text) {
  const blocks = [...text.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)];
  return blocks.length ? blocks[blocks.length - 1][1].trimEnd() + '\n' : null;
}

async function chat({ db, name, code, history, message, lastRun }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error('伺服器沒有設定 ANTHROPIC_API_KEY，AI agent 無法使用。設定後重啟即可（其餘功能不受影響）。');
    err.status = 503;
    throw err;
  }
  const system = `${API_DOC}\n資料表 schema：\n${schemaText(db)}\n\n目前檔案 ${name}.js 的內容：\n\`\`\`js\n${code}\n\`\`\`` +
    (lastRun ? `\n\n最近一次運行結果（供除錯參考）：\n${JSON.stringify(lastRun).slice(0, 4000)}` : '');
  const messages = [...history.slice(-20).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: message }];
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 8000, system, messages }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Anthropic API 錯誤：${(body.error && body.error.message) || res.status}`);
    err.status = 502;
    throw err;
  }
  const reply = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { reply, code: extractCode(reply) };
}

module.exports = { chat, extractCode };
