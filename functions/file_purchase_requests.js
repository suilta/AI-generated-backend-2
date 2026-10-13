module.exports = {
  meta: {
    description: '購買申報：按 BOM 展開物料需求，預留庫存，缺口產生購買申報。無缺口則直接可生產',
    params: { orderId: { type: 'number', default: 1 } },
  },
  run(db, { orderId }) {
    const order = db.sales_orders.get(orderId);
    if (!order) throw new Error('訂單不存在');
    if (order.status !== 'REVIEWED') throw new Error(`訂單狀態為 ${order.status}，需三方審核通過`);

    // 展開物料需求
    const need = {};
    for (const line of db.order_lines.find({ order_id: orderId })) {
      for (const b of db.bom.find({ product_id: line.product_id })) {
        need[b.material_id] = (need[b.material_id] || 0) + b.qty * line.qty;
      }
    }

    const requests = [];
    for (const [materialId, qty] of Object.entries(need)) {
      const inv = db.inventory.findOne({ product_id: Number(materialId) });
      const free = Math.max(0, inv.on_hand - inv.reserved);
      const shortage = qty - free;
      db.inventory.update(inv.id, { reserved: inv.reserved + qty });
      if (shortage > 0) {
        requests.push(db.purchase_requests.insert({
          order_id: orderId, material_id: Number(materialId), qty: shortage, status: 'REQUESTED',
        }));
      }
    }
    db.sales_orders.update(orderId, { status: requests.length ? 'PURCHASING' : 'READY_FOR_PRODUCTION' });
    return { requests: requests.map((r) => ({ id: r.id, materialId: r.material_id, qty: r.qty })) };
  },
};
