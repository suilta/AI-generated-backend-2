'use strict';
// 在沙盒中執行一個業務函數，並記錄每一次對資料表的讀/寫（一次 = 一個調試「步」）。
// 函數永遠在資料庫的副本上運行；是否採納副本（commit）由調用方決定。

const vm = require('node:vm');
const { clone } = require('./db');

const FILE = 'fn.js';
const READ_OPS = ['find', 'findOne', 'get', 'count', 'all'];

function callerLine(err) {
  const m = /fn\.js:(\d+):(\d+)/.exec((err || new Error()).stack || '');
  return m ? Number(m[1]) : null;
}

function describeWhere(w) {
  if (w === undefined || w === null) return '全部';
  if (typeof w === 'function') return String(w).replace(/\s+/g, ' ').slice(0, 90);
  if (typeof w === 'object') return JSON.stringify(w);
  return `id=${w}`;
}

function matcher(where) {
  if (where === undefined || where === null) return () => true;
  if (typeof where === 'function') return (row) => !!where(clone(row));
  if (typeof where === 'number' || typeof where === 'string') return (row) => row.id === where;
  const entries = Object.entries(where);
  return (row) => entries.every(([k, v]) => row[k] === v);
}

// 只載入模組本體（不給 db），用於取 meta。
function loadModule(code) {
  const ctx = vm.createContext({ module: { exports: {} }, console: { log() {}, warn() {}, error() {} } });
  new vm.Script(code, { filename: FILE }).runInContext(ctx, { timeout: 1000 });
  return { ctx, mod: ctx.module.exports };
}

function foldSummary(events) {
  const tables = {};
  const get = (t) => (tables[t] ||= { reads: new Set(), rows: new Map() });
  for (const e of events) {
    const t = get(e.table);
    for (const id of e.readIds) t.reads.add(id);
    for (const c of e.changes) {
      const cur = t.rows.get(c.id);
      t.rows.set(c.id, { before: cur ? cur.before : c.before, after: c.after });
    }
  }
  const out = {};
  for (const [name, t] of Object.entries(tables)) {
    const rows = [];
    for (const [id, { before, after }] of t.rows) {
      if (!before && !after) continue; // 插入後又刪除，淨效果為無
      const type = !before ? 'insert' : !after ? 'delete' : 'update';
      const changedColumns = type === 'update'
        ? Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])) : [];
      if (type === 'update' && !changedColumns.length) continue;
      rows.push({ id, type, before, after, changedColumns });
    }
    out[name] = { readRows: [...t.reads].sort((a, b) => a - b), changes: rows.sort((a, b) => a.id - b.id) };
  }
  return out;
}

async function runFunction({ code, input = {}, database, timeoutMs = 3000 }) {
  const db = database.clone();
  const events = [];
  const logs = [];
  const before = {};
  const started = Date.now();

  const snap = (t) => { if (!before[t]) before[t] = clone(db.tables[t].rows); };
  const emit = (e) => { events.push({ step: events.length + 1, line: callerLine(), changes: [], readIds: [], ...e }); };

  function makeTable(name) {
    if (!db.tables[name]) throw new Error(`未知的資料表：${name}（可用：${db.tableNames().join(', ')}）`);
    const t = db.tables[name];
    const pick = (where) => { snap(name); return t.rows.filter(matcher(where)); };
    const read = (op, where, rows, ret) => {
      emit({ op, kind: 'read', table: name, detail: describeWhere(where), readIds: rows.map((r) => r.id) });
      return ret;
    };
    return {
      find: (w) => { const r = pick(w); return read('find', w, r, clone(r)); },
      all: () => { const r = pick(); return read('all', undefined, r, clone(r)); },
      findOne: (w) => { const r = pick(w).slice(0, 1); return read('findOne', w, r, clone(r[0] ?? null)); },
      get: (id) => { const r = pick(id); return read('get', id, r, clone(r[0] ?? null)); },
      count: (w) => { const r = pick(w); return read('count', w, r, r.length); },
      insert(input) {
        snap(name);
        const many = Array.isArray(input);
        const inserted = (many ? input : [input]).map((src) => {
          if (src && 'id' in src) throw new Error(`insert 不能指定 id（表 ${name}）`);
          const row = { id: t.nextId };
          for (const c of Object.keys(db.schema[name].columns)) row[c] = src[c] === undefined ? null : src[c];
          db.validate(name, src);
          t.nextId++;
          t.rows.push(row);
          return row;
        });
        emit({ op: 'insert', kind: 'write', table: name, detail: `${inserted.length} 行`,
          changes: inserted.map((r) => ({ id: r.id, before: null, after: clone(r) })) });
        return clone(many ? inserted : inserted[0]);
      },
      update(where, patch) {
        const rows = pick(where);
        const changes = [];
        for (const row of rows) {
          const p = typeof patch === 'function' ? patch(clone(row)) : patch;
          if (p && 'id' in p) throw new Error('不能修改 id');
          db.validate(name, p);
          const b = clone(row);
          Object.assign(row, clone(p));
          if (JSON.stringify(b) !== JSON.stringify(row)) changes.push({ id: row.id, before: b, after: clone(row) });
        }
        emit({ op: 'update', kind: 'write', table: name, detail: `${describeWhere(where)} → ${rows.length} 行`,
          readIds: rows.map((r) => r.id), changes });
        return rows.length;
      },
      delete(where) {
        const rows = pick(where);
        const ids = new Set(rows.map((r) => r.id));
        t.rows = t.rows.filter((r) => !ids.has(r.id));
        emit({ op: 'delete', kind: 'write', table: name, detail: `${describeWhere(where)} → ${rows.length} 行`,
          readIds: [...ids], changes: rows.map((r) => ({ id: r.id, before: clone(r), after: null })) });
        return rows.length;
      },
    };
  }

  const cache = {};
  const tableOf = (n) => (cache[n] ||= makeTable(n));
  const dbApi = new Proxy({}, {
    get(_, prop) {
      if (prop === 'table') return (n) => tableOf(n);
      if (typeof prop !== 'string') return undefined;
      return tableOf(prop);
    },
  });

  const mkLog = (level) => (...args) => logs.push({
    level, line: callerLine(), step: events.length,
    text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
  });

  let ok = true, result, error = null;
  try {
    const ctx = vm.createContext({
      module: { exports: {} },
      console: { log: mkLog('log'), warn: mkLog('warn'), error: mkLog('error') },
    });
    new vm.Script(code, { filename: FILE }).runInContext(ctx, { timeout: timeoutMs });
    const mod = ctx.module.exports;
    if (!mod || typeof mod.run !== 'function') throw new Error('module.exports 必須包含 run(db, input) 函數');
    Object.assign(ctx, { __mod: mod, __db: dbApi, __input: clone(input) });
    let timer;
    const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`執行超時（>${timeoutMs}ms）`)), timeoutMs); });
    try {
      const pending = vm.runInContext('__mod.run(__db, __input)', ctx, { timeout: timeoutMs });
      result = await Promise.race([Promise.resolve(pending), guard]);
    } finally { clearTimeout(timer); }
    result = result === undefined ? null : JSON.parse(JSON.stringify(result));
  } catch (e) {
    ok = false;
    error = { message: String((e && e.message) || e), line: callerLine(e), step: events.length };
  }

  const touched = Object.keys(before);
  const after = {};
  for (const n of touched) after[n] = clone(db.tables[n].rows);
  const summary = foldSummary(events);
  const deps = { reads: [], writes: [] };
  for (const e of events) {
    const list = e.kind === 'read' ? deps.reads : deps.writes;
    if (!list.includes(e.table)) list.push(e.table);
  }

  return { ok, result, error, logs, events, before, after, summary, deps, touched, durationMs: Date.now() - started, database: db };
}

module.exports = { runFunction, loadModule, READ_OPS };
