module.exports = {
  meta: {
    description: '技術審核：每個產品必須有 BOM。銷售、技術、品質都通過後訂單進入 REVIEWED',
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
    if (db.reviews.count({ order_id: orderId, dept: 'tech' })) throw new Error('技術已審核過');

    const lines = db.order_lines.find({ order_id: orderId });
    const noBom = lines.filter((l) => db.bom.count({ product_id: l.product_id }) === 0);
    const ok = approve && noBom.length === 0;

    db.reviews.insert({
      order_id: orderId, dept: 'tech', status: ok ? 'APPROVED' : 'REJECTED',
      note: noBom.length ? `產品缺少 BOM：${noBom.map((l) => l.product_id)}` : note,
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
