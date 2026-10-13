module.exports = {
  meta: {
    description: '客戶下單：建立訂單與明細（狀態 NEW）',
    params: {
      customerId: { type: 'number', default: 1, description: '客戶 id' },
      items: { type: 'json', default: [{ productId: 2, qty: 5 }], description: '[{ productId, qty }]' },
      note: { type: 'string', default: '' },
    },
  },
  run(db, { customerId, items, note }) {
    const customer = db.customers.get(customerId);
    if (!customer) throw new Error('客戶不存在');
    if (!items || !items.length) throw new Error('訂單沒有明細');

    let total = 0;
    const lines = [];
    for (const it of items) {
      const p = db.products.get(it.productId);
      if (!p || p.kind !== 'finished') throw new Error(`產品 ${it.productId} 不可下單`);
      lines.push({ product_id: p.id, qty: it.qty, unit_price: p.price });
      total += p.price * it.qty;
    }
    const order = db.sales_orders.insert({
      customer_id: customerId, status: 'NEW', total, note, created_at: new Date().toISOString(),
    });
    db.order_lines.insert(lines.map((l) => ({ ...l, order_id: order.id })));
    return { orderId: order.id, total };
  },
};
