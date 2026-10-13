module.exports = {
  meta: {
    description: '出貨：扣成品庫存並建立出貨單，訂單進入 SHIPPED',
    params: { orderId: { type: 'number', default: 1 } },
  },
  run(db, { orderId }) {
    const order = db.sales_orders.get(orderId);
    if (!order) throw new Error('訂單不存在');
    if (order.status !== 'PRODUCED') throw new Error(`訂單狀態為 ${order.status}，尚未生產完成`);

    for (const line of db.order_lines.find({ order_id: orderId })) {
      const inv = db.inventory.findOne({ product_id: line.product_id });
      if (inv.on_hand < line.qty) throw new Error(`成品 ${line.product_id} 庫存不足`);
      db.inventory.update(inv.id, { on_hand: inv.on_hand - line.qty });
    }
    const shipment = db.shipments.insert({ order_id: orderId, status: 'SHIPPED', shipped_at: new Date().toISOString() });
    db.sales_orders.update(orderId, { status: 'SHIPPED' });
    return { shipmentId: shipment.id };
  },
};
