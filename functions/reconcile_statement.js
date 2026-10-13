module.exports = {
  meta: {
    description: '銷售對帳：把某客戶已簽收的訂單匯總成對帳單，訂單進入 RECONCILED',
    params: {
      customerId: { type: 'number', default: 1 },
      period: { type: 'string', default: '2026-10' },
    },
  },
  run(db, { customerId, period }) {
    const orders = db.sales_orders.find((o) => o.customer_id === customerId && o.status === 'RECEIVED');
    if (!orders.length) throw new Error('沒有可對帳的已簽收訂單');

    const total = orders.reduce((s, o) => s + o.total, 0);
    const statement = db.statements.insert({ customer_id: customerId, period, total, status: 'CONFIRMED' });
    for (const o of orders) {
      db.sales_orders.update(o.id, { status: 'RECONCILED', statement_id: statement.id });
    }
    return { statementId: statement.id, total, orders: orders.map((o) => o.id) };
  },
};
