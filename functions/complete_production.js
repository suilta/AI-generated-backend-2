module.exports = {
  meta: {
    description: '完工報檢：品質檢驗通過則成品入庫；訂單所有工單完工後進入 PRODUCED',
    params: {
      workOrderId: { type: 'number', default: 1 },
      qcResult: { type: 'string', default: 'PASS', description: 'PASS | FAIL' },
      note: { type: 'string', default: '' },
    },
  },
  run(db, { workOrderId, qcResult, note }) {
    const wo = db.work_orders.get(workOrderId);
    if (!wo) throw new Error('工單不存在');
    if (wo.status === 'DONE') throw new Error('工單已完工');

    db.quality_checks.insert({ work_order_id: workOrderId, order_id: wo.order_id, result: qcResult, note });
    if (qcResult !== 'PASS') {
      db.work_orders.update(workOrderId, { status: 'REWORK' });
      return { passed: false };
    }

    db.work_orders.update(workOrderId, { status: 'DONE' });
    const inv = db.inventory.findOne({ product_id: wo.product_id });
    db.inventory.update(inv.id, { on_hand: inv.on_hand + wo.qty });

    if (db.work_orders.count((w) => w.order_id === wo.order_id && w.status !== 'DONE') === 0) {
      db.sales_orders.update(wo.order_id, { status: 'PRODUCED' });
    }
    return { passed: true };
  },
};
