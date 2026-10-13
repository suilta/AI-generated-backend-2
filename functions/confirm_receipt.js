module.exports = {
  meta: {
    description: '回單確認：客戶簽收，出貨單 DELIVERED，訂單進入 RECEIVED',
    params: {
      shipmentId: { type: 'number', default: 1 },
      confirmedBy: { type: 'string', default: '王小明' },
      diffNote: { type: 'string', default: '' },
    },
  },
  run(db, { shipmentId, confirmedBy, diffNote }) {
    const shipment = db.shipments.get(shipmentId);
    if (!shipment) throw new Error('出貨單不存在');
    if (shipment.status !== 'SHIPPED') throw new Error(`出貨單狀態為 ${shipment.status}`);

    db.receipts.insert({
      shipment_id: shipmentId, order_id: shipment.order_id, confirmed_by: confirmedBy,
      diff_note: diffNote, confirmed_at: new Date().toISOString(),
    });
    db.shipments.update(shipmentId, { status: 'DELIVERED' });
    db.sales_orders.update(shipment.order_id, { status: 'RECEIVED' });
    return { orderId: shipment.order_id };
  },
};
