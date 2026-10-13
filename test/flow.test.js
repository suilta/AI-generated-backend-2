const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('../server/db');
const { runFunction } = require('../server/runner');
const { staticDeps } = require('../server/analyze');
const seed = require('../server/seed');

const FN = path.join(__dirname, '..', 'functions');
const src = (n) => fs.readFileSync(path.join(FN, `${n}.js`), 'utf8');

test('整條業務鏈：下單 → … → 財務入帳', async () => {
  let db = Database.fromSeed(seed);
  const step = async (name, input) => {
    const r = await runFunction({ code: src(name), input, database: db });
    assert.ok(r.ok, `${name} 失敗：${r.error && r.error.message}`);
    db = r.database;
    return r;
  };
  await step('sales_review', { orderId: 1, approve: true });
  await step('tech_review', { orderId: 1, approve: true });
  const q = await step('quality_review', { orderId: 1, approve: true });
  assert.equal(db.tables.sales_orders.rows[0].status, 'REVIEWED');
  assert.deepEqual(q.summary.sales_orders.changes[0].changedColumns, ['status']);

  const p = await step('file_purchase_requests', { orderId: 1 });
  assert.equal(p.result.requests[0].qty, 6); // 需要 10 片 PCB，庫存 4
  await step('receive_purchase', { requestId: 1 });
  await step('start_production', { orderId: 1 });
  await step('complete_production', { workOrderId: 1, qcResult: 'PASS' });
  await step('ship_order', { orderId: 1 });
  await step('confirm_receipt', { shipmentId: 1, confirmedBy: 'x' });
  const rec = await step('reconcile_statement', { customerId: 1, period: '2026-10' });
  assert.equal(rec.result.total, 8000);
  await step('finance_post', { statementId: 1 });
  assert.equal(db.tables.sales_orders.rows[0].status, 'POSTED');
  assert.equal(db.tables.customers.rows[0].balance, 28000);
});

test('失敗時不修改原資料庫，但仍返回已執行的步驟與出錯行號', async () => {
  const db = Database.fromSeed(seed);
  const code = `module.exports = { run(db) {\n  db.customers.update(1, { balance: 1 });\n  throw new Error('boom');\n} };`;
  const r = await runFunction({ code, database: db });
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 3);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].line, 2);
  assert.equal(db.tables.customers.rows[0].balance, 20000);
});

test('schema 驗證與超時', async () => {
  const db = Database.fromSeed(seed);
  let r = await runFunction({ code: `module.exports={run(db){db.customers.insert({nope:1})}}`, database: db });
  assert.match(r.error.message, /沒有欄位 nope/);
  r = await runFunction({ code: `module.exports={run(){while(true){}}}`, database: db, timeoutMs: 200 });
  assert.equal(r.ok, false);
});

test('靜態依賴識別（含別名）', () => {
  const deps = staticDeps(`const o = db.sales_orders;\n o.update(1,{});\n db.table('customers').get(1);\n // db.ledger.insert()`, Object.keys(seed.schema));
  assert.deepEqual(deps, { reads: ['customers'], writes: ['sales_orders'] });
});
