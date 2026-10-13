'use strict';
// 範例企業系統：客戶訂單 → 銷售/技術/品質審核 + 購買申報 → 生產 → 出貨 → 回單確認 → 銷售對帳 → 財務

const t = (label, columns) => ({ label, columns });

const schema = {
  customers: t('客戶', { name: 'string', credit_limit: 'number', balance: 'number' }),
  products: t('產品/物料', { sku: 'string', name: 'string', kind: 'string', price: 'number' }),
  bom: t('物料清單', { product_id: 'number', material_id: 'number', qty: 'number' }),
  inventory: t('庫存', { product_id: 'number', on_hand: 'number', reserved: 'number' }),
  sales_orders: t('客戶訂單', { customer_id: 'number', status: 'string', total: 'number', note: 'string', created_at: 'string', statement_id: 'number' }),
  order_lines: t('訂單明細', { order_id: 'number', product_id: 'number', qty: 'number', unit_price: 'number' }),
  reviews: t('部門審核', { order_id: 'number', dept: 'string', status: 'string', note: 'string', reviewed_at: 'string' }),
  purchase_requests: t('購買申報', { order_id: 'number', material_id: 'number', qty: 'number', status: 'string' }),
  work_orders: t('生產工單', { order_id: 'number', product_id: 'number', qty: 'number', status: 'string' }),
  quality_checks: t('品質檢驗', { work_order_id: 'number', order_id: 'number', result: 'string', note: 'string' }),
  shipments: t('出貨單', { order_id: 'number', status: 'string', shipped_at: 'string' }),
  receipts: t('回單', { shipment_id: 'number', order_id: 'number', confirmed_by: 'string', diff_note: 'string', confirmed_at: 'string' }),
  statements: t('銷售對帳單', { customer_id: 'number', period: 'string', total: 'number', status: 'string' }),
  ledger: t('財務總帳', { customer_id: 'number', order_id: 'number', statement_id: 'number', type: 'string', amount: 'number', posted_at: 'string' }),
};

const rows = {
  customers: [
    { id: 1, name: '星辰科技', credit_limit: 100000, balance: 20000 },
    { id: 2, name: '遠景電子', credit_limit: 30000, balance: 25000 },
  ],
  products: [
    { id: 1, sku: 'CTRL-100', name: '控制器', kind: 'finished', price: 800 },
    { id: 2, sku: 'SENS-20', name: '感測器', kind: 'finished', price: 150 },
    { id: 3, sku: 'PCB-01', name: '電路板', kind: 'raw', price: 30 },
    { id: 4, sku: 'CHIP-X', name: '晶片', kind: 'raw', price: 20 },
    { id: 5, sku: 'CASE-A', name: '外殼', kind: 'raw', price: 10 },
  ],
  bom: [
    { id: 1, product_id: 1, material_id: 3, qty: 1 },
    { id: 2, product_id: 1, material_id: 4, qty: 2 },
    { id: 3, product_id: 1, material_id: 5, qty: 1 },
    { id: 4, product_id: 2, material_id: 3, qty: 1 },
    { id: 5, product_id: 2, material_id: 4, qty: 1 },
  ],
  inventory: [
    { id: 1, product_id: 1, on_hand: 0, reserved: 0 },
    { id: 2, product_id: 2, on_hand: 0, reserved: 0 },
    { id: 3, product_id: 3, on_hand: 4, reserved: 0 },
    { id: 4, product_id: 4, on_hand: 30, reserved: 0 },
    { id: 5, product_id: 5, on_hand: 20, reserved: 0 },
  ],
  sales_orders: [
    { id: 1, customer_id: 1, status: 'NEW', total: 8000, note: '示範訂單', created_at: '2026-10-01T09:00:00.000Z', statement_id: null },
  ],
  order_lines: [{ id: 1, order_id: 1, product_id: 1, qty: 10, unit_price: 800 }],
};

module.exports = { schema, rows };
