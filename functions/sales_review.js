module.exports = {
  meta: {
    description: '銷售審核：檢查客戶信用額度，通過後訂單進入 SALES_APPROVED',
    params: {
      orderId: { type: 'number', default: 1 },
      approve: { type: 'boolean', default: true },
      note: { type: 'string', default: '' },
    },
  },
  run(db, { orderId, approve, note }) {
    const order = db.sales_orders.get(orderId);
    if (!order) throw new Error('訂單不存在');
    if (order.status !== 'NEW') throw new Error(`訂單狀態為 ${order.status}，不能做銷售審核`);

    const customer = db.customers.get(order.customer_id);
    const exposure = customer.balance + order.total;
    const overLimit = exposure > customer.credit_limit;
    const ok = approve && !overLimit;

    db.reviews.insert({
      order_id: orderId, dept: 'sales', status: ok ? 'APPROVED' : 'REJECTED',
      note: overLimit ? `超出信用額度：${exposure} > ${customer.credit_limit}` : note,
      reviewed_at: new Date().toISOString(),
    });
    db.sales_orders.update(orderId, { status: ok ? 'SALES_APPROVED' : 'REJECTED' });
    return { approved: ok, exposure };
  },
};
