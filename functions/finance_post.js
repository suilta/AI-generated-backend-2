module.exports = {
  meta: {
    description: '財務入帳：對帳單產生應收分錄，更新客戶應收餘額，訂單進入 POSTED',
    params: { statementId: { type: 'number', default: 1 } },
  },
  run(db, { statementId }) {
    const st = db.statements.get(statementId);
    if (!st) throw new Error('對帳單不存在');
    if (st.status !== 'CONFIRMED') throw new Error(`對帳單狀態為 ${st.status}`);

    const orders = db.sales_orders.find({ statement_id: statementId });
    for (const o of orders) {
      db.ledger.insert({
        customer_id: st.customer_id, order_id: o.id, statement_id: statementId,
        type: 'AR', amount: o.total, posted_at: new Date().toISOString(),
      });
      db.sales_orders.update(o.id, { status: 'POSTED' });
    }
    const customer = db.customers.get(st.customer_id);
    db.customers.update(customer.id, { balance: customer.balance + st.total });
    db.statements.update(statementId, { status: 'POSTED' });
    return { posted: orders.length, amount: st.total };
  },
};
