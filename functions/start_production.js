module.exports = {
  meta: {
    description: '開工：按 BOM 領料（扣庫存），每條訂單明細產生一張工單',
    params: { orderId: { type: 'number', default: 1 } },
  },
  run(db, { orderId }) {
    const order = db.sales_orders.get(orderId);
    if (!order) throw new Error('訂單不存在');
    if (order.status !== 'READY_FOR_PRODUCTION') throw new Error(`訂單狀態為 ${order.status}，物料未齊`);

    const lines = db.order_lines.find({ order_id: orderId });
    for (const line of lines) {
      for (const b of db.bom.find({ product_id: line.product_id })) {
        const qty = b.qty * line.qty;
        const inv = db.inventory.findOne({ product_id: b.material_id });
        if (inv.on_hand < qty) throw new Error(`物料 ${b.material_id} 庫存不足：${inv.on_hand} < ${qty}`);
        db.inventory.update(inv.id, { on_hand: inv.on_hand - qty, reserved: inv.reserved - qty });
      }
      db.work_orders.insert({ order_id: orderId, product_id: line.product_id, qty: line.qty, status: 'IN_PROGRESS' });
    }
    db.sales_orders.update(orderId, { status: 'IN_PRODUCTION' });
    return { workOrders: lines.length };
  },
};
