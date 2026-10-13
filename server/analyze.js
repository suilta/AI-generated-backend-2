'use strict';
// 靜態識別：從源碼找出函數讀/寫了哪些表。動態識別（真實運行的 trace）由 server 另行合併。

const { loadModule } = require('./runner');

const READ = ['find', 'findOne', 'get', 'count', 'all'];
const WRITE = ['insert', 'update', 'delete'];

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function staticDeps(code, tableNames) {
  const src = stripComments(code);
  const known = new Set(tableNames);
  const reads = new Set(), writes = new Set();
  const add = (table, method) => {
    if (!known.has(table)) return;
    if (READ.includes(method)) reads.add(table);
    else if (WRITE.includes(method)) writes.add(table);
  };
  // 別名：const o = db.orders;  /  const o = db.table('orders');
  const alias = {};
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*db\s*(?:\.\s*(\w+)|\.\s*table\(\s*['"`](\w+)['"`]\s*\))\s*[;\n]/g)) {
    alias[m[1]] = m[2] || m[3];
  }
  for (const m of src.matchAll(/\bdb\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g)) add(m[1], m[2]);
  for (const m of src.matchAll(/\bdb\s*\.\s*table\(\s*['"`](\w+)['"`]\s*\)\s*\.\s*(\w+)\s*\(/g)) add(m[1], m[2]);
  for (const [a, t] of Object.entries(alias)) {
    for (const m of src.matchAll(new RegExp(`\\b${a}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g'))) add(t, m[1]);
  }
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

function readMeta(code) {
  try {
    const { mod } = loadModule(code);
    const meta = (mod && mod.meta) || {};
    return { meta: JSON.parse(JSON.stringify({ description: '', params: {}, ...meta })), error: null };
  } catch (e) {
    return { meta: { description: '', params: {} }, error: String(e.message || e) };
  }
}

module.exports = { staticDeps, readMeta };
