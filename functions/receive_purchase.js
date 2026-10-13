module.exports = {
  meta: {
    description: '採購到貨：物料入庫；訂單所有申報都到貨後進入 READY_FOR_PRODUCTION',
    params: { requestId: { type: 'number', default: 1 } },
  },
  run(db, { requestId }) {
    const req = db.purchase_requests.get(requestId);
    if (!req) throw new Error('購買申報不存在');
    if (req.status !== 'REQUESTED') throw new Error(`申報狀態為 ${req.status}`);

    const inv = db.inventory.findOne({ product_id: req.material_id });
    db.inventory.update(inv.id, { on_hand: inv.on_hand + req.qty });
    db.purchase_requests.update(requestId, { status: 'RECEIVED' });

    const open = db.purchase_requests.count({ order_id: req.order_id, status: 'REQUESTED' });
    if (open === 0) db.sales_orders.update(req.order_id, { status: 'READY_FOR_PRODUCTION' });
    return { openRequests: open };
  },
};
