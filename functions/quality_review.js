module.exports = {
  meta: {
    description: '品質審核：單一明細數量超過 500 無法保證抽檢能力。三方都通過後訂單進入 REVIEWED',
    params: {
      orderId: { type: 'number', default: 1 },
      approve: { type: 'boolean', default: true },
      note: { type: 'string', default: '' },
    },
  },
  run(db, { orderId, approve, note }) {
    const order = db.sales_orders.get(orderId);
    if (!order) throw new Error('訂單不存在');
    if (order.status !== 'SALES_APPROVED') throw new Error(`訂單狀態為 ${order.status}，需先通過銷售審核`);
    if (db.reviews.count({ order_id: orderId, dept: 'quality' })) throw new Error('品質已審核過');

    const lines = db.order_lines.find({ order_id: orderId });
    const tooBig = lines.some((l) => l.qty > 500);
    const ok = approve && !tooBig;

    db.reviews.insert({
      order_id: orderId, dept: 'quality', status: ok ? 'APPROVED' : 'REJECTED',
      note: tooBig ? '單項數量超過 500，超出抽檢能力' : note,
      reviewed_at: new Date().toISOString(),
    });

    const approved = db.reviews.find({ order_id: orderId, status: 'APPROVED' }).map((r) => r.dept);
    if (!ok) db.sales_orders.update(orderId, { status: 'REJECTED' });
    else if (['sales', 'tech', 'quality'].every((d) => approved.includes(d))) {
      db.sales_orders.update(orderId, { status: 'REVIEWED' });
    }
    return { approved: ok, departmentsApproved: approved };
  },
};
