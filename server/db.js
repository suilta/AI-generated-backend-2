'use strict';
// 極簡的記憶體「關係表」。每張表有 schema（欄位與型別）、rows、自增 id。

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

class Database {
  constructor(schema, tables) {
    this.schema = schema; // { table: { label, columns: { col: 'number'|'string'|'boolean' } } }
    this.tables = tables; // { table: { rows: [], nextId } }
  }

  static fromSeed(seed) {
    const tables = {};
    for (const name of Object.keys(seed.schema)) {
      const rows = clone(seed.rows[name] || []);
      tables[name] = { rows, nextId: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1 };
    }
    return new Database(clone(seed.schema), tables);
  }

  static fromJSON(json) {
    return new Database(json.schema, json.tables);
  }

  clone() {
    return new Database(clone(this.schema), clone(this.tables));
  }

  toJSON() {
    return { schema: this.schema, tables: this.tables };
  }

  tableNames() {
    return Object.keys(this.schema);
  }

  columns(name) {
    return ['id', ...Object.keys(this.schema[name].columns)];
  }

  // 寫入前驗證：欄位必須存在於 schema，型別必須吻合（null 允許）。
  validate(name, row) {
    const cols = this.schema[name].columns;
    for (const [k, v] of Object.entries(row)) {
      if (k === 'id') continue;
      if (!(k in cols)) throw new Error(`表 ${name} 沒有欄位 ${k}`);
      if (v === null || v === undefined) continue;
      if (typeof v !== cols[k]) throw new Error(`表 ${name}.${k} 需要 ${cols[k]}，收到 ${typeof v}（${JSON.stringify(v)}）`);
    }
  }
}

module.exports = { Database, clone };
