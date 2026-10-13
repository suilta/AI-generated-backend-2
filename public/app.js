'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (method, url, body) => {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const show = (v) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const S = {
  fns: [], schema: [], cur: null, savedCode: '', meta: { params: {} },
  paramVals: {}, run: null, step: 0, tab: 'state', showAll: false, browse: null, chat: [],
};

/* ---------- 左側 ---------- */
function renderLeft() {
  $('#fnList').innerHTML = S.fns.map((f) => `
    <div class="fn ${S.cur && S.cur.name === f.name ? 'active' : ''}" data-fn="${f.name}">
      <div class="n">${esc(f.name)}</div><div class="d">${esc(f.description)}</div>
      <div>${f.deps.reads.map((t) => `<span class="chip r">R ${t}</span>`).join('')}${f.deps.writes.map((t) => `<span class="chip w">W ${t}</span>`).join('')}</div>
    </div>`).join('');
  $('#tableList').innerHTML = S.schema.map((t) => `<div class="tbl" data-t="${t.name}"><span>${t.name} <span class="muted">${esc(t.label)}</span></span><span class="muted">${t.count}</span></div>`).join('');
}
async function refreshLists() {
  [S.fns, S.schema] = await Promise.all([api('GET', '/api/functions'), api('GET', '/api/schema')]);
  renderLeft();
}

/* ---------- 編輯器 ---------- */
const ta = $('#code');
function renderGutter() {
  const n = ta.value.split('\n').length;
  const marks = {};
  if (S.run) for (const e of S.run.events) if (e.line) marks[e.line] = e.kind === 'write' ? 'wr' : marks[e.line] === 'wr' ? 'wr' : 'rd';
  const errLine = S.run && S.run.error && S.run.error.line;
  let h = '';
  for (let i = 1; i <= n; i++) h += `<div class="l ${marks[i] || ''} ${errLine === i ? 'err' : ''}">${i}</div>`;
  $('#gutterInner').innerHTML = h;
  syncScroll();
}
function syncScroll() {
  $('#gutterInner').style.transform = `translateY(${-ta.scrollTop}px)`;
  placeHl();
}
function currentLine() {
  if (!S.run || S.step === 0) return null;
  const evs = S.run.events;
  if (S.step <= evs.length) return { line: evs[S.step - 1].line, err: false };
  return { line: S.run.error && S.run.error.line, err: true };
}
function placeHl() {
  const hl = $('#hl'), c = currentLine();
  if (!c || !c.line) { hl.classList.remove('on'); return; }
  hl.classList.add('on'); hl.classList.toggle('err', c.err);
  hl.style.top = `${8 + (c.line - 1) * 20 - ta.scrollTop}px`;
}
function revealLine(line) {
  const top = (line - 1) * 20, vh = ta.clientHeight;
  if (top < ta.scrollTop || top > ta.scrollTop + vh - 40) ta.scrollTop = Math.max(0, top - vh / 3);
}
ta.addEventListener('scroll', syncScroll);
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = ta.selectionStart;
    ta.setRangeText('  ', s, ta.selectionEnd, 'end');
    onEdit();
  }
});
let analyzeTimer;
ta.addEventListener('input', onEdit);
function onEdit() {
  renderGutter();
  $('#dirty').textContent = ta.value !== S.savedCode ? '● 未儲存' : '';
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(async () => {
    try {
      const a = await api('POST', '/api/analyze', { code: ta.value, name: S.cur && S.cur.name });
      S.meta = a.meta; $('#fnDesc').textContent = a.meta.description || '';
      renderParams();
      const f = S.fns.find((x) => x.name === S.cur.name);
      if (f) { f.deps = a.deps; f.description = a.meta.description; renderLeft(); }
      if (S.tab === 'deps') renderTab();
    } catch { /* 語法錯誤時保留舊 meta */ }
  }, 400);
}

async function selectFn(name) {
  if (S.cur && ta.value !== S.savedCode && !confirm('目前函數有未儲存修改，仍要切換？')) return;
  const f = await api('GET', `/api/functions/${name}`);
  S.cur = { name }; S.savedCode = f.code; S.meta = f.meta; S.run = null; S.step = 0; S.chat = f.chat;
  ta.value = f.code; ta.scrollTop = 0;
  $('#fnName').textContent = name; $('#fnDesc').textContent = f.meta.description || ''; $('#dirty').textContent = '';
  $('#chatFile').textContent = `${name}.js`;
  location.hash = name;
  renderGutter(); renderParams(); renderLeft(); renderChat(); renderStepbar(); renderTab();
}
async function save() {
  if (!S.cur) return;
  await api('PUT', `/api/functions/${S.cur.name}`, { code: ta.value });
  S.savedCode = ta.value; $('#dirty').textContent = '';
  await refreshLists();
}

/* ---------- 參數 ---------- */
function renderParams() {
  const ps = S.meta.params || {};
  const vals = (S.paramVals[S.cur.name] ||= {});
  $('#params').innerHTML = Object.entries(ps).map(([k, p]) => {
    if (!(k in vals)) vals[k] = p.default !== undefined ? p.default : p.type === 'boolean' ? false : p.type === 'number' ? 0 : p.type === 'json' ? null : '';
    const v = vals[k], title = esc(p.description || '');
    let input;
    if (p.type === 'boolean') input = `<input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}>`;
    else if (p.type === 'json') input = `<textarea data-k="${k}" spellcheck="false">${esc(JSON.stringify(v))}</textarea>`;
    else input = `<input type="${p.type === 'number' ? 'number' : 'text'}" data-k="${k}" value="${esc(v)}">`;
    return `<label title="${title}">${esc(k)}${input}</label>`;
  }).join('') || '<span class="muted">（此函數沒有參數）</span>';
}
function collectInput() {
  const ps = S.meta.params || {}, out = {};
  for (const [k, p] of Object.entries(ps)) {
    const el = $(`#params [data-k="${k}"]`);
    if (!el) continue;
    if (p.type === 'boolean') out[k] = el.checked;
    else if (p.type === 'number') out[k] = el.value === '' ? null : Number(el.value);
    else if (p.type === 'json') { try { out[k] = JSON.parse(el.value || 'null'); } catch { throw new Error(`參數 ${k} 不是合法 JSON`); } }
    else out[k] = el.value;
    S.paramVals[S.cur.name][k] = out[k];
  }
  return out;
}

/* ---------- 運行 ---------- */
async function doRun(commit) {
  if (!S.cur) return;
  let input;
  try { input = collectInput(); } catch (e) { return alert(e.message); }
  $('#runBtn').disabled = $('#commitBtn').disabled = true;
  try {
    S.run = await api('POST', '/api/run', { name: S.cur.name, code: ta.value, input, commit });
    S.step = 0; S.tab = 'state';
    if (S.run.committed) await refreshLists(); else { const f = S.fns.find((x) => x.name === S.cur.name); if (f) { f.deps = S.run.deps; renderLeft(); } }
    renderGutter(); renderStepbar(); renderTab(); setTab('state');
    if (S.run.events.length) goStep(1);
  } catch (e) { alert(e.message); }
  $('#runBtn').disabled = $('#commitBtn').disabled = false;
}
const maxStep = () => (S.run ? S.run.events.length + (S.run.error ? 1 : 0) : 0);
function goStep(k) {
  S.step = Math.max(0, Math.min(maxStep(), k));
  $('#slider').value = S.step;
  renderStepbar(); placeHl();
  const c = currentLine(); if (c && c.line) revealLine(c.line);
  if (S.tab === 'state' || S.tab === 'steps') renderTab();
}
function stepText(k) {
  if (k === 0) return '初始狀態（尚未執行）';
  const evs = S.run.events;
  if (k > evs.length) return `💥 錯誤（第 ${S.run.error.line ?? '?'} 行）：${S.run.error.message}`;
  const e = evs[k - 1];
  return `第 ${e.line ?? '?'} 行 · ${e.kind === 'read' ? '讀' : '寫'} ${e.table}.${e.op}(${e.detail})`;
}
function renderStepbar() {
  const bar = $('#stepbar');
  if (!S.run) { bar.hidden = true; return; }
  bar.hidden = false;
  $('#slider').max = maxStep(); $('#slider').value = S.step;
  $('#stepInfo').textContent = `${S.step}/${maxStep()}　${stepText(S.step)}`;
  $('#stepInfo').title = $('#stepInfo').textContent;
}

/* ---------- 表狀態（核心調試視圖） ---------- */
function stateAt(run, k) {
  const tables = {};
  for (const t of run.touched) {
    const m = new Map();
    for (const r of run.before[t]) m.set(r.id, { row: r, orig: r, mark: null, deleted: false });
    tables[t] = { rows: m, touchedIds: new Set(), cur: new Map() };
  }
  run.events.forEach((e, i) => {
    const T = tables[e.table];
    e.readIds.forEach((id) => T.touchedIds.add(id));
    for (const c of e.changes) {
      T.touchedIds.add(c.id);
      let en = T.rows.get(c.id);
      if (i < k) {
        if (!en) { en = { row: null, orig: null, mark: null, deleted: false }; T.rows.set(c.id, en); }
        if (c.after) { en.row = c.after; en.deleted = false; en.mark = en.orig ? 'upd' : 'ins'; }
        else { en.row = c.before; en.deleted = true; en.mark = 'del'; }
      }
    }
    if (i === k - 1) {
      if (e.kind === 'read') e.readIds.forEach((id) => T.cur.set(id, 'read'));
      else {
        e.readIds.forEach((id) => T.cur.set(id, 'read'));
        for (const c of e.changes) T.cur.set(c.id, !c.before ? 'ins' : !c.after ? 'del' : 'upd');
      }
    }
  });
  return tables;
}
function gridHtml(cols, rowsHtml) {
  return `<table class="grid"><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${rowsHtml}</table>`;
}
function renderState() {
  if (!S.run) return '<span class="muted">設定參數後按「試運行」。試運行在資料庫副本上執行，不會改動真實資料；「運行並提交」才會落庫。</span>';
  if (!S.run.touched.length) return '<span class="muted">本次運行沒有訪問任何資料表。</span>';
  const st = stateAt(S.run, Math.min(S.step, S.run.events.length));
  const cur = S.run.events[S.step - 1];
  let h = `<div class="legend" style="margin-bottom:8px"><span><i class="dot" style="background:#1d3556"></i>本步讀取</span><span><i class="dot" style="background:#17402f"></i>本步新增</span><span><i class="dot" style="background:#4a3d12"></i>本步修改</span><span><i class="dot" style="background:#4d1f1e"></i>本步刪除</span><span class="muted">左側色條 = 之前步驟已改動</span><label><input type="checkbox" id="showAll" ${S.showAll ? 'checked' : ''}> 顯示全部行</label></div>`;
  const order = [...S.run.touched].sort((a, b) => (cur && cur.table === b ? 1 : 0) - (cur && cur.table === a ? 1 : 0));
  for (const t of order) {
    const T = st[t], meta = S.schema.find((x) => x.name === t);
    const cols = meta ? meta.columns : Object.keys([...T.rows.values()][0]?.row || {});
    const ids = [...T.rows.keys()].sort((a, b) => a - b).filter((id) => S.showAll || T.touchedIds.has(id));
    const body = ids.map((id) => {
      const en = T.rows.get(id), c = T.cur.get(id);
      const cls = [c ? `cur-${c}` : '', !c && en.mark ? `past-${en.mark}` : ''].join(' ');
      const tds = cols.map((col) => {
        const nv = en.row ? en.row[col] : null, ov = en.orig ? en.orig[col] : undefined;
        const changed = en.mark === 'upd' && JSON.stringify(nv) !== JSON.stringify(ov);
        return `<td class="${changed ? 'chg' : ''}" title="${esc(show(nv))}">${changed ? `<span class="old">${esc(show(ov))}</span>` : ''}${esc(show(nv))}</td>`;
      }).join('');
      return `<tr class="${cls}">${tds}</tr>`;
    }).join('');
    h += `<div class="tcard"><h4>${t} <small>${esc(meta ? meta.label : '')} · 顯示 ${ids.length}/${T.rows.size} 行</small></h4>${gridHtml(cols, body)}</div>`;
  }
  return h;
}

/* ---------- 其他分頁 ---------- */
function renderSteps() {
  if (!S.run) return '<span class="muted">尚未運行。</span>';
  const evs = S.run.events;
  let h = evs.map((e, i) => `<div class="ev ${S.step === i + 1 ? 'cur' : ''}" data-step="${i + 1}"><span class="no">${i + 1}</span><span class="ln">L${e.line ?? '?'}</span><span class="tag ${e.kind}">${e.kind === 'read' ? '讀' : '寫'}</span><span>${esc(e.table)}.${e.op}(${esc(e.detail)})${e.changes.length ? ` <span class="muted">→ ${e.changes.length} 行變動</span>` : e.readIds.length ? ` <span class="muted">→ ${e.readIds.length} 行</span>` : ''}</span></div>`).join('');
  if (S.run.error) h += `<div class="ev ${S.step > evs.length ? 'cur' : ''}" data-step="${evs.length + 1}"><span class="no">💥</span><span class="ln">L${S.run.error.line ?? '?'}</span><span>${esc(S.run.error.message)}</span></div>`;
  return h || '<span class="muted">沒有 db 調用。</span>';
}
function renderChanges() {
  const r = S.run;
  if (!r) return '<span class="muted">尚未運行。</span>';
  let h = r.ok ? `<div style="margin-bottom:8px">以此參數運行一次：${r.committed ? '<b style="color:var(--green)">已提交到資料庫</b>' : '<span class="muted">試運行（未落庫）</span>'}</div>` : `<div class="err-box">運行失敗，已整體回滾，資料庫未被改動。以下是失敗前已發生的改動。</div>`;
  const names = Object.keys(r.summary);
  const changedTables = names.filter((n) => r.summary[n].changes.length);
  const readOnly = names.filter((n) => !r.summary[n].changes.length);
  if (!changedTables.length) h += '<div class="muted">沒有任何資料行被改動。</div>';
  for (const t of changedTables) {
    const s = r.summary[t], cols = (S.schema.find((x) => x.name === t) || {}).columns || [];
    const rows = s.changes.map((c) => {
      let desc;
      if (c.type === 'update') desc = c.changedColumns.map((k) => `${k}: <span class="muted">${esc(show(c.before[k]))}</span> → <b>${esc(show(c.after[k]))}</b>`).join('，');
      else desc = esc(JSON.stringify(c.type === 'insert' ? c.after : c.before));
      const tag = { insert: '新增', update: '修改', delete: '刪除' }[c.type];
      const color = { insert: 'var(--green)', update: 'var(--yellow)', delete: 'var(--red)' }[c.type];
      return `<tr><td>${c.id}</td><td style="color:${color}">${tag}</td><td style="white-space:normal">${desc}</td></tr>`;
    }).join('');
    const n = (ty) => s.changes.filter((c) => c.type === ty).length;
    h += `<div class="tcard"><h4>${t} <small>新增 ${n('insert')} · 修改 ${n('update')} · 刪除 ${n('delete')}${s.readRows.length ? ` · 讀取 ${s.readRows.length} 行` : ''}</small></h4>${gridHtml(['id', '類型', '內容'], rows)}</div>`;
  }
  if (readOnly.length) h += `<div class="tcard"><h4>只讀的表</h4>${readOnly.map((t) => `<span class="chip r">${t} · ${r.summary[t].readRows.length} 行</span>`).join('')}</div>`;
  return h;
}
function renderDeps() {
  if (!S.cur) return '';
  const me = S.fns.find((f) => f.name === S.cur.name);
  if (!me) return '';
  const inter = (a, b) => a.filter((x) => b.includes(x));
  const up = S.fns.filter((f) => f.name !== me.name && inter(f.deps.writes, me.deps.reads).length);
  const down = S.fns.filter((f) => f.name !== me.name && inter(f.deps.reads, me.deps.writes).length);
  const chip = (t, k, d) => `<span class="chip ${k}" title="${d.static.includes(t) ? '靜態識別' : ''}${d.observed.includes(t) ? ' 運行觀測' : ''}">${t}</span>`;
  const item = (f, shared) => `<div class="dep-item" data-fn="${f.name}"><b>${f.name}</b> <span class="muted">${esc(f.description)}</span><br>${shared.map((t) => `<span class="chip ${'r'}">${t}</span>`).join('')}</div>`;
  const st = me.deps.static, ob = me.deps.observed;
  return `<div style="margin-bottom:12px"><b>${me.name}</b> 的資料訪問（靜態分析 + 實際運行 trace 自動合併）：<br>
    讀：${me.deps.reads.map((t) => chip(t, 'r', { static: st.reads, observed: ob.reads })).join('') || '<span class="muted">無</span>'}<br>
    寫：${me.deps.writes.map((t) => chip(t, 'w', { static: st.writes, observed: ob.writes })).join('') || '<span class="muted">無</span>'}</div>
    <div class="dep-grid">
      <div><h4>⬆ 上游：寫了我讀的表</h4>${up.map((f) => item(f, inter(f.deps.writes, me.deps.reads))).join('') || '<span class="muted">無</span>'}</div>
      <div><h4>⬇ 下游：讀了我寫的表</h4>${down.map((f) => item(f, inter(f.deps.reads, me.deps.writes))).join('') || '<span class="muted">無</span>'}</div>
    </div>`;
}
function renderOut() {
  const r = S.run;
  if (!r) return '<span class="muted">尚未運行。</span>';
  let h = '';
  if (r.error) h += `<div class="err-box">❌ ${esc(r.error.message)}${r.error.line ? `（第 ${r.error.line} 行）` : ''}</div>`;
  else h += `<h4>返回值 <small class="muted">${r.durationMs}ms</small></h4><pre>${esc(JSON.stringify(r.result, null, 2))}</pre>`;
  h += `<h4 style="margin-top:12px">console 日誌</h4>` + (r.logs.length ? r.logs.map((l) => `<pre>[${l.level}] L${l.line ?? '?'} 於步驟 ${l.step}：${esc(l.text)}</pre>`).join('') : '<span class="muted">無</span>');
  return h;
}
async function renderBrowse() {
  const rows = await api('GET', `/api/tables/${S.browse}`);
  const meta = S.schema.find((x) => x.name === S.browse);
  return `<div class="tcard"><h4>${S.browse} <small>${esc(meta.label)} · ${rows.length} 行（真實資料庫當前內容）</small></h4>${gridHtml(meta.columns, rows.map((r) => `<tr>${meta.columns.map((c) => `<td>${esc(show(r[c]))}</td>`).join('')}</tr>`).join(''))}</div>`;
}

async function renderTab() {
  const body = $('#tabBody');
  const fn = { state: renderState, steps: renderSteps, changes: renderChanges, deps: renderDeps, out: renderOut, browse: renderBrowse }[S.tab];
  const keep = body.scrollTop;
  body.innerHTML = await fn();
  body.scrollTop = keep;
}
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  renderTab();
}

/* ---------- AI 對話 ---------- */
function renderChat() {
  const log = $('#chatLog');
  log.innerHTML = S.chat.map((m, i) => {
    const text = m.role === 'assistant' && m.code ? m.content.replace(/```[\s\S]*?```/g, '').trim() : m.content;
    return `<div class="msg ${m.role} ${m.err ? 'err' : ''}">${esc(text)}${m.code ? `<pre>${esc(m.code.split('\n').slice(0, 12).join('\n'))}${m.code.split('\n').length > 12 ? '\n…' : ''}</pre><button data-apply="${i}">套用到編輯器</button>` : ''}</div>`;
  }).join('') || '<div class="muted">一個檔案一個對話。告訴 AI 這個業務函數該做什麼，它會產出完整檔案，按「套用」後再試運行、步進檢查。</div>';
  log.scrollTop = log.scrollHeight;
}
function compactRun() {
  const r = S.run;
  if (!r || !$('#sendRun').checked) return undefined;
  return {
    ok: r.ok, result: r.result, error: r.error, logs: r.logs.slice(0, 20),
    steps: r.events.slice(0, 60).map((e) => `L${e.line} ${e.table}.${e.op}(${e.detail}) ${e.changes.length ? `變動${e.changes.length}行` : `讀${e.readIds.length}行`}`),
    input: S.paramVals[S.cur.name],
  };
}
async function sendChat() {
  const text = $('#chatText').value.trim();
  if (!text || !S.cur) return;
  $('#chatText').value = ''; $('#chatSend').disabled = true;
  S.chat.push({ role: 'user', content: text }); renderChat();
  try {
    const out = await api('POST', '/api/chat', { name: S.cur.name, message: text, code: ta.value, lastRun: compactRun() });
    S.chat.push({ role: 'assistant', content: out.reply, code: out.code });
  } catch (e) { S.chat.push({ role: 'assistant', content: e.message, err: true }); }
  $('#chatSend').disabled = false; renderChat();
}

/* ---------- 事件 ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-fn],[data-t],[data-step],[data-apply],[data-tab]');
  if (!t) return;
  if (t.dataset.fn) selectFn(t.dataset.fn);
  else if (t.dataset.t) { S.browse = t.dataset.t; S.tab = 'browse'; document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('active')); renderTab(); }
  else if (t.dataset.step) goStep(Number(t.dataset.step));
  else if (t.dataset.apply) { ta.value = S.chat[Number(t.dataset.apply)].code; onEdit(); }
  else if (t.dataset.tab) setTab(t.dataset.tab);
});
document.addEventListener('change', (e) => { if (e.target.id === 'showAll') { S.showAll = e.target.checked; renderTab(); } });
$('#runBtn').onclick = () => doRun(false);
$('#commitBtn').onclick = () => { if (confirm('提交後改動會寫入真實資料庫，確定？')) doRun(true); };
$('#saveBtn').onclick = save;
$('#sFirst').onclick = () => goStep(0); $('#sPrev').onclick = () => goStep(S.step - 1);
$('#sNext').onclick = () => goStep(S.step + 1); $('#sLast').onclick = () => goStep(maxStep());
$('#slider').oninput = (e) => goStep(Number(e.target.value));
$('#chatSend').onclick = sendChat;
$('#chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendChat(); });
$('#newFn').onclick = async () => {
  const name = prompt('函數名（英文、數字、底線）：');
  if (!name) return;
  try { await api('POST', `/api/functions/${name}`); await refreshLists(); await selectFn(name); } catch (e) { alert(e.message); }
};
$('#resetDb').onclick = async () => {
  if (!confirm('重置資料庫為初始範例資料？')) return;
  await api('POST', '/api/reset'); await refreshLists(); S.run = null; renderStepbar(); renderGutter(); renderTab();
};
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || !S.run) return;
  if (e.key === 'ArrowRight') goStep(S.step + 1);
  if (e.key === 'ArrowLeft') goStep(S.step - 1);
});

(async () => {
  await refreshLists();
  const first = location.hash.slice(1);
  await selectFn(S.fns.some((f) => f.name === first) ? first : S.fns[0] && S.fns[0].name);
})();
