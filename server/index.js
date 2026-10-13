'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Database } = require('./db');
const { runFunction } = require('./runner');
const { staticDeps, readMeta } = require('./analyze');
const agent = require('./agent');
const seed = require('./seed');

const ROOT = path.join(__dirname, '..');
const FN_DIR = path.join(ROOT, 'functions');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const OBS_FILE = path.join(DATA_DIR, 'observed.json');
const PUBLIC = path.join(ROOT, 'public');
const NAME_RE = /^[a-z][a-z0-9_]{0,59}$/i;

fs.mkdirSync(DATA_DIR, { recursive: true });
const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v));

let database = fs.existsSync(DB_FILE) ? Database.fromJSON(readJSON(DB_FILE)) : Database.fromSeed(seed);
const persist = () => writeJSON(DB_FILE, database);
if (!fs.existsSync(DB_FILE)) persist();

// 動態識別結果：函數名 -> { hash, reads, writes }（同一份代碼的多次運行取並集）
const observed = readJSON(OBS_FILE, {});
const hashOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

const fnFile = (n) => path.join(FN_DIR, `${n}.js`);
const chatFile = (n) => path.join(FN_DIR, `${n}.chat.json`);
const listNames = () => fs.readdirSync(FN_DIR).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();

function depsFor(name, code) {
  const st = staticDeps(code, database.tableNames());
  const ob = observed[name] && observed[name].hash === hashOf(code) ? observed[name] : { reads: [], writes: [] };
  const merge = (a, b) => [...new Set([...a, ...b])].sort();
  return { reads: merge(st.reads, ob.reads), writes: merge(st.writes, ob.writes), static: st, observed: { reads: ob.reads, writes: ob.writes } };
}

function describeFn(name) {
  const code = fs.readFileSync(fnFile(name), 'utf8');
  const { meta, error } = readMeta(code);
  return { name, description: meta.description, deps: depsFor(name, code), error };
}

const TEMPLATE = (name) => `module.exports = {
  meta: {
    description: '${name}：請描述這個業務函數',
    params: {},
  },
  run(db, input) {
    return { ok: true };
  },
};
`;

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(data);
}
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 2e6) req.destroy(); });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // 去掉 'api'
  const m = req.method;
  const name = parts[1];
  if (name !== undefined && parts[0] === 'functions' && !NAME_RE.test(name)) return send(res, 400, { error: '函數名不合法' });

  if (m === 'GET' && parts[0] === 'functions' && parts.length === 1) return send(res, 200, listNames().map(describeFn));

  if (parts[0] === 'functions' && name) {
    if (m === 'GET') {
      if (!fs.existsSync(fnFile(name))) return send(res, 404, { error: '不存在' });
      const code = fs.readFileSync(fnFile(name), 'utf8');
      return send(res, 200, { ...describeFn(name), code, meta: readMeta(code).meta, chat: readJSON(chatFile(name), []) });
    }
    if (m === 'PUT') {
      const { code } = await readBody(req);
      if (typeof code !== 'string') return send(res, 400, { error: '缺少 code' });
      fs.writeFileSync(fnFile(name), code);
      return send(res, 200, describeFn(name));
    }
    if (m === 'POST') {
      if (fs.existsSync(fnFile(name))) return send(res, 409, { error: '已存在' });
      fs.writeFileSync(fnFile(name), TEMPLATE(name));
      return send(res, 200, describeFn(name));
    }
    if (m === 'DELETE') {
      fs.rmSync(fnFile(name), { force: true });
      fs.rmSync(chatFile(name), { force: true });
      return send(res, 200, { ok: true });
    }
  }

  if (m === 'POST' && parts[0] === 'analyze') {
    const { code, name: n } = await readBody(req);
    const { meta, error } = readMeta(String(code || ''));
    return send(res, 200, { meta, error, deps: depsFor(n || '', String(code || '')) });
  }

  if (m === 'GET' && parts[0] === 'schema') {
    return send(res, 200, database.tableNames().map((t) => ({
      name: t, label: database.schema[t].label, columns: database.columns(t),
      types: { id: 'number', ...database.schema[t].columns }, count: database.tables[t].rows.length,
    })));
  }
  if (m === 'GET' && parts[0] === 'tables' && parts[1]) {
    const t = database.tables[parts[1]];
    return t ? send(res, 200, t.rows) : send(res, 404, { error: '無此表' });
  }

  if (m === 'POST' && parts[0] === 'run') {
    const { name: n, code, input, commit } = await readBody(req);
    const src = typeof code === 'string' ? code : fs.readFileSync(fnFile(n), 'utf8');
    const out = await runFunction({ code: src, input: input || {}, database });
    const { database: after, ...payload } = out;
    let committed = false;
    if (commit && out.ok) { database = after; persist(); committed = true; }
    if (n && out.ok) {
      const h = hashOf(src);
      const prev = observed[n] && observed[n].hash === h ? observed[n] : { hash: h, reads: [], writes: [] };
      observed[n] = { hash: h, reads: [...new Set([...prev.reads, ...out.deps.reads])], writes: [...new Set([...prev.writes, ...out.deps.writes])] };
      writeJSON(OBS_FILE, observed);
    }
    return send(res, 200, { ...payload, committed, deps: n ? depsFor(n, src) : out.deps, runDeps: out.deps });
  }

  if (m === 'POST' && parts[0] === 'reset') {
    database = Database.fromSeed(seed);
    persist();
    return send(res, 200, { ok: true });
  }

  if (m === 'POST' && parts[0] === 'chat') {
    const { name: n, message, code, lastRun } = await readBody(req);
    if (!NAME_RE.test(n || '') || !message) return send(res, 400, { error: '參數錯誤' });
    const history = readJSON(chatFile(n), []);
    const current = typeof code === 'string' ? code : fs.readFileSync(fnFile(n), 'utf8');
    const out = await agent.chat({ db: database, name: n, code: current, history, message, lastRun });
    history.push({ role: 'user', content: message }, { role: 'assistant', content: out.reply, code: out.code });
    writeJSON(chatFile(n), history);
    return send(res, 200, out);
  }

  send(res, 404, { error: '未知的 API' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.status || 500, { error: String((e && e.message) || e) });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`http://localhost:${port}`));
}
module.exports = { server };
