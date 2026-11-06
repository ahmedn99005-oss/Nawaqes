import { initStore, parseConfig, saveLocalConfig, clearLocalConfig, readLocalConfig } from './store.js';

(function(){
'use strict';
document.documentElement.lang = 'ar';
document.documentElement.dir = 'rtl';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ICON = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.3-4.4A8.5 8.5 0 1 1 20.5 12z"/><path d="M9 10.5h6M9 13.5h4" stroke-linecap="round"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  mic: '<svg class="mic-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};

/* ---------- text helpers ---------- */
function toLatin(s){
  return String(s == null ? '' : s)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0));
}
function norm(s){
  return toLatin(s).toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function cleanText(s){ return toLatin(s).replace(/\s+/g, ' ').trim(); }
function parseQty(s){
  const n = parseInt(toLatin(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 99999) : 0;
}
function hashKey(str){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++){ const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
const catId = key => 'k' + hashKey(key);
function countItems(n){
  if (n === 0) return 'مفيش أصناف';
  if (n === 1) return 'صنف واحد';
  if (n === 2) return 'صنفين';
  if (n <= 10) return n + ' أصناف';
  return n + ' صنف';
}
const LOC = 'ar-EG-u-nu-latn';
function dayStart(t){ const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); }
function relDay(t){
  const diff = Math.round((dayStart(Date.now()) - dayStart(t)) / 864e5);
  if (diff <= 0) return 'النهارده';
  if (diff === 1) return 'امبارح';
  if (diff < 7) return 'يوم ' + new Date(t).toLocaleDateString(LOC, {weekday:'long'});
  return new Date(t).toLocaleDateString(LOC, {day:'numeric', month:'long'});
}
const fmtLong = t => new Date(t).toLocaleDateString(LOC, {weekday:'long', day:'numeric', month:'long', year:'numeric'});
const fmtDay = t => new Date(t).toLocaleDateString(LOC, {weekday:'long', day:'numeric', month:'long'});
const byName = (a, b) => a.name.localeCompare(b.name, 'ar');

/* ---------- state ---------- */
const S = {
  db: null, dl: null, dbStatus: 'connecting',
  items: new Map(), catalog: new Map(), listQuery: '',
  settings: {shopName: '', phone: '', phones: {}},
  listFilter: 'all', dbFilter: 'all', dbQuery: '',
  has: {}, fresh: {}, stale: false, view: 'list', flash: new Set(),
  sample: null, sampleOff: false
};
const SUBS = ['items', 'catalog', 'settings'];

/* ---------- writes: one at a time per document ---------- */
const chains = new Map();
function write(path, op){
  const prev = chains.get(path) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try { return await op(); }
    catch (e){
      if (e && e.code === 'unavailable'){ await sleep(400 + Math.random() * 700); return op(); }
      throw e;
    }
  });
  chains.set(path, next);
  const clear = () => { if (chains.get(path) === next) chains.delete(path); };
  next.then(clear, clear);
  return next;
}
async function runLimited(tasks, n){
  const q = tasks.slice(); const errs = [];
  const worker = async () => { while (q.length){ const t = q.shift(); try { await t(); } catch (e){ errs.push(e); } } };
  await Promise.all(Array.from({length: Math.min(n || 4, q.length)}, worker));
  return errs;
}
function reportWriteError(e){
  if (e && e.code === 'quota_exceeded') toast('المساحة اتملت. امسح طلبيات قديمة من «الطلبيات» وجرب تاني.');
  else toast('ماتحفظش. اتأكد من النت وجرب تاني.');
}
const itemsCol = () => S.db.collection('items');
const catCol = () => S.db.collection('catalog');

/* ---------- derived ---------- */
function allItems(){
  return [...S.items.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}
function activeByKey(key){
  for (const it of S.items.values()) if (it.key === key) return it;
  return null;
}

/* ---------- centers ---------- */
const CENTERS = [{id: 'nasr', name: 'النصرية'}, {id: 'mamar', name: 'الممر'}, {id: 'shaqa', name: 'الشقة'}];
const CENTER_NAME = {nasr: 'النصرية', mamar: 'الممر', shaqa: 'الشقة'};
const NONE_LABEL = 'من غير مركز';
const validCenter = c => (CENTER_NAME[c] ? c : null);
function centerOf(it){
  const p = S.catalog.get(catId(it.key || norm(it.name)));
  return validCenter(p && p.center) || validCenter(it.center);
}
const centerLabel = c => (CENTER_NAME[c] || NONE_LABEL);
function pillHTML(c){
  return CENTER_NAME[c] ? `<span class="cpill c-${c}"><i></i>${CENTER_NAME[c]}</span>` : `<span class="cpill none">${NONE_LABEL}</span>`;
}
function centerButtonsHTML(selected, attr){
  return CENTERS.map(c => `<button type="button" class="cbtn c-${c.id}" ${attr}="${c.id}" aria-pressed="${selected === c.id}"><i></i>${c.name}</button>`).join('');
}
function groupByCenter(list){
  const secs = CENTERS.map(c => ({id: c.id, label: c.name, items: []}));
  const none = {id: null, label: NONE_LABEL, items: []};
  for (const it of list){ const c = centerOf(it); (c ? secs.find(x => x.id === c) : none).items.push(it); }
  return secs.concat([none]).filter(x => x.items.length).map(x => (x.items.sort(byName), x));
}
function setProductCenter(p, center){
  const body = Object.assign({}, p); delete body.id;
  body.key = body.key || norm(body.name);
  body.center = validCenter(center);
  S.catalog.set(p.id, Object.assign({id: p.id}, body));
  write('catalog/' + p.id, () => catCol().doc(p.id).set(body)).catch(reportWriteError);
  for (const it of S.items.values()){
    if (it.key === body.key && (it.center || null) !== body.center){
      S.items.set(it.id, Object.assign({}, it, {center: body.center}));
      write('items/' + it.id, () => itemsCol().doc(it.id).update({center: body.center})).catch(() => {});
    }
  }
}
function assignCenter(name, center){
  const key = norm(name), cid = catId(key);
  const p = S.catalog.get(cid);
  if (p && validCenter(p.center) === validCenter(center)) return;
  setProductCenter(p || {id: cid, name, key, uses: 1, lastAt: Date.now()}, center);
}
function requestAdd(name, qty, note, after){
  const p = S.catalog.get(catId(norm(name)));
  if (p && validCenter(p.center)){ addItem(name, qty, note, false, p.center); if (after) after(); return; }
  openModal(headHTML('تبع أنهي مركز؟') + `
    <p class="m-sub">«${esc(name)}» صنف جديد لسه مالوش مركز. اختاره مرة واحدة والبرنامج هيفتكره بعد كده.</p>
    <div class="center-pick">${centerButtonsHTML(null, 'data-cp')}</div>
    <div><button type="button" class="link" id="cpSkip">ضيفه من غير مركز دلوقتي</button></div>`,
  card => {
    card.querySelectorAll('[data-cp]').forEach(b => b.addEventListener('click', () => {
      closeModal(); addItem(name, qty, note, false, b.dataset.cp); if (after) after();
    }));
    card.querySelector('#cpSkip').addEventListener('click', () => { closeModal(); addItem(name, qty, note, false, null); if (after) after(); });
  });
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, opt){
  const t = $('#toast');
  t.innerHTML = '';
  const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
  if (opt && opt.action){
    const b = document.createElement('button'); b.type = 'button'; b.textContent = opt.action;
    b.addEventListener('click', () => { t.hidden = true; opt.onAction(); });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, opt && opt.action ? 6500 : 3800);
}

/* ---------- rendering ---------- */
function render(){
  renderHeader(); renderNotice(); renderFreq(); renderFilters(); renderList(); renderDb(); renderBar();
}
function renderHeader(){
  const shop = S.settings.shopName;
  $('#shopLine').textContent = (shop ? shop + ' · ' : '') + fmtDay(Date.now());
  $('#countList').textContent = S.items.size;
  const unset = [...S.catalog.values()].filter(p => !validCenter(p.center)).length;
  const d = $('#countDb'); d.textContent = unset; d.hidden = !unset; d.title = unset ? `${unset} من غير مركز` : '';
  $('#addFs').disabled = S.dbStatus === 'none' || S.dbStatus === 'error';
}
function renderNotice(){
  let msg = '';
  if (S.dbStatus === 'none') msg = '';
  else if (S.dbStatus === 'error') msg = S.dbError || 'الاتصال بالبيانات وقف. اقفل الأبلكيشن وافتحه تاني.';
  else if (S.stale) msg = 'مفيش نت دلوقتي. اللي قدامك آخر نسخة اتحفظت على الجهاز، وأي تعديل هيتبعت أول ما النت يرجع.';
  const n = $('#notice'); n.textContent = msg; n.hidden = !msg;
}
function renderFreq(){
  const el = $('#freq');
  const activeKeys = new Set([...S.items.values()].map(it => it.key));
  const top = [...S.catalog.values()]
    .filter(c => (c.uses || 0) >= 2 && !activeKeys.has(c.key))
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.lastAt || 0) - (a.lastAt || 0))
    .slice(0, 8);
  if (!top.length){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = '<span class="freq-l">بينقص كتير:</span>' + top.map(c => `<button type="button" class="fchip" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
}
function renderFilters(){
  const el = $('#cfilter');
  const counts = {all: S.items.size, none: 0}; CENTERS.forEach(c => { counts[c.id] = 0; });
  for (const it of S.items.values()) counts[centerOf(it) || 'none']++;
  const ids = ['all'].concat(CENTERS.map(c => c.id).filter(id => counts[id]), counts.none ? ['none'] : []);
  if (ids.length <= 2 || !S.has.items){ el.hidden = true; el.innerHTML = ''; S.listFilter = 'all'; return; }
  if (!ids.includes(S.listFilter)) S.listFilter = 'all';
  el.hidden = false;
  el.innerHTML = ids.map(id => `<button type="button" class="fbtn${CENTER_NAME[id] ? ' c-' + id : ''}" data-lf="${id}" aria-pressed="${S.listFilter === id}">${CENTER_NAME[id] ? '<i></i>' : ''}${id === 'all' ? 'الكل' : esc(centerLabel(id))} <b>${counts[id]}</b></button>`).join('');
}
function emptyHTML(title, body){
  return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(body)}</p></div>`;
}
function rowHTML(it){
  const c = centerOf(it);
  return `<li class="row${S.flash.has(it.id) ? ' flash' : ''}">
    <button type="button" class="tick" data-done="${esc(it.id)}" aria-label="«${esc(it.name)}» وصل، شيله من النواقص" title="وصل، شيله"><span>${ICON.check}</span></button>
    <button type="button" class="row-body" data-edit="${esc(it.id)}" aria-label="${esc(it.name)}، ${esc(centerLabel(c))}${it.qty ? '، العدد ' + it.qty : ''}. اضغط للتعديل">
      <span class="row-main"><span class="row-name">${esc(it.name)}</span>${it.note ? `<span class="row-note">${esc(it.note)}</span>` : ''}<span class="row-tags">${pillHTML(c)}</span></span>
      <span class="row-qty">${it.qty ? esc(it.qty) : ''}</span></button></li>`;
}
function renderList(){
  const el = $('#list');
  $('#listSearchBox').hidden = !(S.has.items && S.items.size > 0);
  if (S.dbStatus === 'none'){
    el.innerHTML = emptyHTML('الكشكول مقفول', 'سجّل دخول بحساب جوجل، وهتلاقي النواقص بتاعتك هنا.');
    return;
  }
  if (!S.has.items){
    el.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="tail"></div>';
    return;
  }
  if (!S.items.size){
    el.innerHTML = emptyHTML('مفيش نواقص دلوقتي', 'أول ما صنف يخلص، اكتبه فوق واضغط «ضيف»، أو دوس على زرار المايك وقول كذا صنف مرة واحدة. ولما يوصل، علّم على المربع اللي جنبه يتشال.');
    return;
  }
  const toks = norm(S.listQuery).split(' ').filter(Boolean);
  const pass = it => (S.listFilter === 'all' || (centerOf(it) || 'none') === S.listFilter)
    && toks.every(t => (it.key || norm(it.name)).includes(t));
  const list = allItems().filter(pass);
  if (!list.length){
    el.innerHTML = emptyHTML('مفيش صنف بالاسم ده', toks.length ? 'جرب تكتب جزء تاني من الاسم، أو امسح البحث.' : 'مفيش أصناف في المركز ده دلوقتي.');
    return;
  }
  const title = toks.length ? 'نتايج البحث' : (S.listFilter === 'all' ? 'كل النواقص' : centerLabel(S.listFilter));
  el.innerHTML = `<h2 class="group-h">${esc(title)} <b>${list.length}</b></h2><ul class="rows">` + list.map(rowHTML).join('') + '</ul><div class="tail"></div>';
}
function renderDb(){
  const box = $('#dbList'), fb = $('#dbFilters');
  if (S.dbStatus === 'none'){ fb.innerHTML = ''; box.innerHTML = '<div class="page">' + emptyHTML('الكشكول مقفول', 'سجّل دخول بحساب جوجل.') + '</div>'; return; }
  if (!S.has.catalog){ fb.innerHTML = ''; box.innerHTML = '<div class="page"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'; return; }
  const all = [...S.catalog.values()];
  const counts = {all: all.length, none: 0}; CENTERS.forEach(c => { counts[c.id] = 0; });
  all.forEach(p => { counts[validCenter(p.center) || 'none']++; });
  const ids = ['all'].concat(counts.none ? ['none'] : [], CENTERS.map(c => c.id).filter(id => counts[id]));
  if (!ids.includes(S.dbFilter)) S.dbFilter = 'all';
  fb.innerHTML = ids.map(id => `<button type="button" class="fbtn${CENTER_NAME[id] ? ' c-' + id : ''}" data-dbf="${id}" aria-pressed="${S.dbFilter === id}">${CENTER_NAME[id] ? '<i></i>' : ''}${id === 'all' ? 'الكل' : esc(centerLabel(id))} <b>${counts[id]}</b></button>`).join('');
  if (!all.length){ box.innerHTML = '<div class="page">' + emptyHTML('قاعدة الأصناف فاضية', 'كل صنف بتكتبه في النواقص بيتسجل هنا، وتقدر تضيف أصناف بزرار «صنف جديد».') + '</div>'; return; }
  const toks = norm(S.dbQuery).split(' ').filter(Boolean);
  const rows = all.filter(p => {
    const c = validCenter(p.center);
    if (S.dbFilter === 'none' && c) return false;
    if (CENTER_NAME[S.dbFilter] && c !== S.dbFilter) return false;
    const k = p.key || norm(p.name);
    return toks.every(t => k.includes(t));
  }).sort((a, b) => (validCenter(a.center) ? 1 : 0) - (validCenter(b.center) ? 1 : 0) || byName(a, b));
  if (!rows.length){ box.innerHTML = '<p class="db-intro">مفيش أصناف بالاسم ده. تقدر تضيفه بزرار «صنف جديد».</p>'; return; }
  box.innerHTML = '<ul class="dbrows">' + rows.map(p => `<li class="dbrow" data-pid="${esc(p.id)}">
    <span class="db-name">${esc(p.name)}${validCenter(p.center) ? '' : `<small>${NONE_LABEL}</small>`}</span>
    <div class="cseg" role="group" aria-label="مركز ${esc(p.name)}">${centerButtonsHTML(validCenter(p.center), 'data-pc')}</div>
    <button type="button" class="b-x" data-pdel aria-label="امسح «${esc(p.name)}» من الأصناف" title="امسحه من الأصناف">${ICON.x}</button></li>`).join('') + '</ul>';
}
function renderBar(){
  const bar = $('#bar'); bar.hidden = S.view !== 'list';
  const b = $('#sendBtn');
  const n = S.items.size;
  if (n){ b.innerHTML = `ابعت الكشف للمخزن <b>${n}</b>`; b.disabled = false; }
  else { b.textContent = 'مفيش نواقص تتبعت'; b.disabled = true; }
}
function flash(id){
  S.flash.add(id);
  setTimeout(() => S.flash.delete(id), 1700);
}

/* ---------- quick add ---------- */
const nameInput = $('#nameInput'), noteInput = $('#noteInput'), sugEl = $('#suggest');
let sugList = [], sugIdx = -1;

$('#noteToggle').addEventListener('click', () => {
  const show = noteInput.hidden;
  noteInput.hidden = !show;
  $('#noteToggle').hidden = show;
  $('#noteToggle').setAttribute('aria-expanded', String(show));
  if (show) noteInput.focus();
});
function resetForm(){
  nameInput.value = ''; noteInput.value = '';
  noteInput.hidden = true; $('#noteToggle').hidden = false; $('#noteToggle').setAttribute('aria-expanded', 'false');
  hideSuggest();
}

function suggestions(q){
  const nq = norm(q);
  if (!nq) return [];
  const toks = nq.split(' ');
  const res = [];
  for (const c of S.catalog.values()){
    const k = c.key || norm(c.name);
    if (!toks.every(t => k.includes(t))) continue;
    const score = (k === nq ? 1000 : 0) + (k.startsWith(nq) ? 100 : 0) + Math.min(c.uses || 0, 90);
    res.push({c, score});
  }
  res.sort((a, b) => b.score - a.score || byName(a.c, b.c));
  return res.slice(0, 7).map(r => r.c);
}
function renderSuggest(){
  sugList = suggestions(nameInput.value);
  if (!sugList.length || document.activeElement !== nameInput){ hideSuggest(); return; }
  if (sugIdx >= sugList.length) sugIdx = -1;
  sugEl.innerHTML = sugList.map((c, i) => {
    const act = activeByKey(c.key);
    const meta = (act ? '<span class="sg-meta in">موجود في النواقص</span>' : '') + (validCenter(c.center) ? pillHTML(c.center) : '');
    return `<li class="sg${i === sugIdx ? ' active' : ''}" role="option" id="sg-${i}" aria-selected="${i === sugIdx}">
      <button type="button" class="sg-pick" data-i="${i}" tabindex="-1"><span class="sg-name">${esc(c.name)}</span>${meta}</button>
      <button type="button" class="sg-x" data-x="${i}" tabindex="-1" aria-label="شيل «${esc(c.name)}» من الاقتراحات" title="شيله من الاقتراحات">${ICON.x}</button></li>`;
  }).join('');
  sugEl.hidden = false;
  nameInput.setAttribute('aria-expanded', 'true');
  if (sugIdx >= 0) nameInput.setAttribute('aria-activedescendant', 'sg-' + sugIdx); else nameInput.removeAttribute('aria-activedescendant');
}
function hideSuggest(){
  sugEl.hidden = true; sugEl.innerHTML = ''; sugIdx = -1;
  nameInput.setAttribute('aria-expanded', 'false'); nameInput.removeAttribute('aria-activedescendant');
}
function pickSuggestion(c){
  nameInput.value = c.name;
  hideSuggest();
  nameInput.focus();
}
nameInput.addEventListener('input', () => { sugIdx = -1; renderSuggest(); });
nameInput.addEventListener('focus', renderSuggest);
nameInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== nameInput) hideSuggest(); }, 120));
nameInput.addEventListener('keydown', e => {
  if (sugEl.hidden) return;
  if (e.key === 'ArrowDown'){ e.preventDefault(); sugIdx = (sugIdx + 1) % sugList.length; renderSuggest(); }
  else if (e.key === 'ArrowUp'){ e.preventDefault(); sugIdx = sugIdx <= 0 ? sugList.length - 1 : sugIdx - 1; renderSuggest(); }
  else if (e.key === 'Enter' && sugIdx >= 0){ e.preventDefault(); pickSuggestion(sugList[sugIdx]); }
  else if (e.key === 'Escape'){ hideSuggest(); }
});
sugEl.addEventListener('pointerdown', e => e.preventDefault());
sugEl.addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x){
    const c = sugList[+x.dataset.x];
    if (c && S.db){
      S.catalog.delete(c.id);
      write('catalog/' + c.id, () => catCol().doc(c.id).delete()).catch(reportWriteError);
      renderSuggest();
    }
    return;
  }
  const p = e.target.closest('[data-i]');
  if (p) pickSuggestion(sugList[+p.dataset.i]);
});
$('#freq').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  const c = S.catalog.get(b.dataset.cat); if (!c) return;
  if (!S.db) return;
  requestAdd(c.name, null, '', () => toast(`اتضاف «${c.name}»`));
});

$('#addForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = cleanText(nameInput.value);
  if (!name){ nameInput.focus(); toast('اكتب اسم الصنف الأول'); return; }
  if (!S.db){ toast(S.dbStatus === 'connecting' ? 'لسه بفتح البيانات، ثانية واحدة وجرب تاني.' : 'سجّل دخول بحساب جوجل الأول.'); return; }
  requestAdd(name, null, cleanText(noteInput.value), () => { resetForm(); nameInput.focus(); });
});

function addItem(name, qty, note, quiet, center){
  const key = norm(name);
  const now = Date.now();
  qty = qty || null;
  center = validCenter(center);
  let existing = null;
  for (const it of S.items.values()) if (it.key === key){ existing = it; break; }
  if (existing){
    const oldQty = existing.qty || null;
    const newQty = qty ? (oldQty || 0) + qty : oldQty;
    let newNote = existing.note || '';
    if (note && !newNote.includes(note)) newNote = newNote ? newNote + ' · ' + note : note;
    flash(existing.id);
    const newCenter = center || existing.center || null;
    if (newQty !== oldQty || newNote !== (existing.note || '') || newCenter !== (existing.center || null)){
      S.items.set(existing.id, Object.assign({}, existing, {qty: newQty, note: newNote, center: newCenter, updatedAt: now}));
      write('items/' + existing.id, () => itemsCol().doc(existing.id).update({qty: newQty, note: newNote, center: newCenter, updatedAt: now})).catch(reportWriteError);
      if (!quiet) toast(newQty !== oldQty ? `«${existing.name}» كان موجود، العدد بقى ${newQty}` : `«${existing.name}» كان موجود، واتضافت الملاحظة`);
    } else if (!quiet) toast(`«${existing.name}» موجود في النواقص من قبل`);
  } else {
    const ref = itemsCol().doc();
    const body = {name, key, qty, note: note || '', center, addedAt: now, updatedAt: now};
    S.items.set(ref.id, Object.assign({id: ref.id}, body));
    write('items/' + ref.id, () => ref.set(body)).catch(reportWriteError);
    flash(ref.id);
  }
  const cid = catId(key);
  const prev = S.catalog.get(cid);
  const cbody = {name, key, uses: ((prev && prev.uses) || 0) + 1, lastAt: now, center: center || validCenter(prev && prev.center)};
  S.catalog.set(cid, Object.assign({id: cid}, cbody));
  write('catalog/' + cid, () => catCol().doc(cid).set(cbody)).catch(() => {});
  if (!quiet) render();
}

/* ---------- say several items at once ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const COLOR_WORDS = ['ازرق','اسود','احمر','اخضر','اصفر','ابيض','بني','رمادي','روز','بينك','بنفسجي','موف','برتقالي','لبني','فضي','دهبي','ذهبي','سيلفر','جولد','كحلي','زيتي','فوشيا','نبيتي','سماوي','تركواز','شفاف','ملون','كافيه','بيج','زهري','لموني','فسفوري'];
const COLOR_FIX = {'ازرق':'أزرق','اسود':'أسود','احمر':'أحمر','اخضر':'أخضر','اصفر':'أصفر','ابيض':'أبيض'};
const NUM_WORDS = {'واحد':1,'اتنين':2,'اثنين':2,'تلاته':3,'ثلاثه':3,'اربعه':4,'خمسه':5,'سته':6,'سبعه':7,'تمانيه':8,'ثمانيه':8,'تسعه':9,'عشره':10,'حداشر':11,'اتناشر':12,'خمستاشر':15,'عشرين':20,'تلاتين':30,'ثلاثين':30,'اربعين':40,'خمسين':50,'ستين':60,'سبعين':70,'تمانين':80,'ثمانين':80,'تسعين':90,'ميه':100,'مايه':100,'مائه':100,'ميتين':200,'مائتين':200};
const FILLERS = ['ناقص عندي','عندي ناقص','ناقصني','ناقص','عندي','كمان','يعني','وبعدين','بعدين','عايز','عاوز','محتاج','محتاجين','هات','خلصان','خلص'];
const KEEP_W = new Set(['ورق','ورقه','وصله','وش','ولاعه','وسط','وايت','واتر','وان','وجه','واقي']);
function localParse(text){
  const words0 = toLatin(text).replace(/[.؟?!:]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => { const n = NUM_WORDS[norm(w)]; return n != null ? String(n) : w; });
  const firstTokens = new Set([...S.catalog.values()].map(c => (c.key || norm(c.name)).split(' ')[0]));
  const parts = [];
  for (const chunk of words0.join(' ').split(/[\n،,؛;+]+/)){
    let cur = [];
    for (const w of chunk.trim().split(/\s+/).filter(Boolean)){
      const nw = norm(w);
      if (nw === 'و'){ if (cur.length) parts.push(cur.join(' ')); cur = []; continue; }
      if (cur.length && w.startsWith('و') && nw.length > 2 && !KEEP_W.has(nw) && !firstTokens.has(nw)){
        parts.push(cur.join(' ')); cur = [w.slice(1)]; continue;
      }
      cur.push(w);
    }
    if (cur.length) parts.push(cur.join(' '));
  }
  const out = []; let prev = null;
  for (const p of parts){
    let s = ' ' + p + ' ';
    for (const f of FILLERS) s = s.split(' ' + f + ' ').join(' ');
    s = cleanText(s);
    if (!s) continue;
    const toks = norm(s).split(' ');
    if (prev && toks.every(x => COLOR_WORDS.includes(x) || x === 'لون' || x === 'اللون')){
      const base = prev.name.split(' ');
      while (base.length > 1 && COLOR_WORDS.includes(norm(base[base.length - 1]))) base.pop();
      s.split(' ').filter(w => !['لون', 'اللون'].includes(norm(w))).forEach(cw => {
        out.push({name: base.join(' ') + ' ' + (COLOR_FIX[norm(cw)] || cw), qty: null, note: ''});
      });
      continue;
    }
    s = s.split(' ').map(w => COLOR_FIX[norm(w)] || w).join(' ');
    const known = S.catalog.get(catId(norm(s)));
    const item = {name: known ? known.name : s, qty: null, note: ''};
    out.push(item); prev = item;
  }
  return out;
}
function openBulk(){
  const draft = [];
  let rec = null, listening = false;
  openModal(headHTML('قول النواقص مرة واحدة') + `
    <p class="m-sub">${SR ? 'دوس «ابدأ الكلام» وقول كل اللي ناقص' : 'دوس على المايك اللي في كيبورد الموبايل وقول كل اللي ناقص'}، أو اكتبه. مثلاً: «كشكول 60 مسطر وقلم روتو ليكود أزرق وأسود وأستيكة».</p>
    ${SR ? `<button type="button" class="btn mic-big" id="bMic">${ICON.mic}ابدأ الكلام</button>` : ''}
    <label for="bText" class="vh">النواقص بالكلام</label>
    <textarea class="inp area" id="bText" rows="3" placeholder="كشكول 60 مسطر وقلم روتو ليكود أزرق وأسود…"></textarea>
    <div class="m-actions"><button type="button" class="btn primary" id="bParse">قسّمهم أصناف</button></div>
    <p class="b-status" id="bStatus" role="status"></p>
    <ul class="bulk" id="bList" hidden></ul>
    <div class="m-actions" id="bAddRow" hidden><button type="button" class="btn primary" id="bAdd"></button></div>`,
  card => {
    const ta = card.querySelector('#bText'), parseBtn = card.querySelector('#bParse'), st = card.querySelector('#bStatus');
    const listEl = card.querySelector('#bList'), addRow = card.querySelector('#bAddRow'), addBtn = card.querySelector('#bAdd');
    const micBtn = card.querySelector('#bMic');
    const status = (msg, err) => { st.textContent = msg || ''; st.classList.toggle('err', !!err); };
    const drawList = () => {
      listEl.hidden = !draft.length; addRow.hidden = !draft.length;
      parseBtn.classList.toggle('primary', !draft.length);
      parseBtn.textContent = draft.length ? 'قسّم الكلام الجديد وضيفه للقايمة' : 'قسّمهم أصناف';
      addBtn.textContent = `ضيفهم للنواقص (${draft.length})`;
      listEl.innerHTML = draft.map((d, i) => `<li data-bi="${i}">
        <label class="vh" for="bn${i}">اسم الصنف</label><input class="inp" id="bn${i}" data-bn="${i}" type="text" value="${esc(d.name)}">
        <button type="button" class="b-x" data-bx="${i}" aria-label="شيل «${esc(d.name)}»">${ICON.x}</button>
        <div class="cseg" role="group" aria-label="المركز">${centerButtonsHTML(d.center, 'data-bc')}</div>
        ${d.qty || d.note ? `<span class="b-note">${[d.qty ? 'العدد: ' + d.qty : '', d.note].filter(Boolean).map(esc).join(' · ')}</span>` : ''}</li>`).join('');
    };
    const mergeIn = items => {
      for (const it of items){
        const key = norm(it.name);
        const same = draft.find(d => norm(d.name) === key);
        if (same){ if (it.qty) same.qty = (same.qty || 0) + it.qty; if (it.note && !same.note) same.note = it.note; }
        else { const p = S.catalog.get(catId(key)); draft.push({name: it.name, qty: it.qty || null, note: it.note || '', center: validCenter(p && p.center)}); }
      }
    };
    const parse = () => {
      const text = ta.value.trim();
      if (!text){ status('قول أو اكتب النواقص الأول', true); return; }
      const items = localParse(text);
      if (!items.length){ status('ماعرفتش ألاقي أصناف في الكلام ده. جرب تاني.', true); return; }
      mergeIn(items); ta.value = ''; drawList();
      const unset = draft.filter(d => !d.center).length;
      status(unset ? `فيه ${countItems(unset)} لسه مالهمش مركز، اختار مركزهم أو ضيفهم وحدده بعدين.` : 'راجعهم، وعدّل أي اسم قبل ما تضيف. تقدر تقول كمان وتقسّمهم تاني.');
    };
    listEl.addEventListener('input', e => {
      const n = e.target.closest('[data-bn]'); if (n) draft[+n.dataset.bn].name = n.value;
    });
    listEl.addEventListener('click', e => {
      const x = e.target.closest('[data-bx]');
      if (x){ draft.splice(+x.dataset.bx, 1); drawList(); return; }
      const cb = e.target.closest('[data-bc]');
      if (cb){
        const li = cb.closest('[data-bi]'); const d = draft[+li.dataset.bi];
        d.center = cb.dataset.bc;
        li.querySelectorAll('[data-bc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bc === d.center)));
      }
    });
    parseBtn.addEventListener('click', parse);
    const stopMic = () => { if (rec){ try { rec.stop(); } catch (e){} } };
    if (micBtn) micBtn.addEventListener('click', () => {
      if (listening){ stopMic(); return; }
      const base = ta.value.trim();
      rec = new SR(); rec.lang = 'ar-EG'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
      let heard = '';
      rec.onresult = e => {
        heard = '';
        for (let i = 0; i < e.results.length; i++) heard += ' ' + e.results[i][0].transcript;
        ta.value = (base + ' ' + heard).replace(/\s+/g, ' ').trim();
      };
      rec.onerror = e => {
        const c = e && e.error;
        status(c === 'not-allowed' || c === 'service-not-allowed' ? 'اسمح للأبلكيشن يستخدم المايك وجرب تاني.'
          : c === 'no-speech' ? 'ماسمعتش حاجة. دوس وجرب تاني.'
          : c === 'network' ? 'التعرف على الكلام محتاج نت. استخدم مايك الكيبورد.'
          : 'المايك وقف. جرب تاني أو استخدم مايك الكيبورد.', true);
      };
      rec.onend = () => {
        listening = false; rec = null;
        if (!micBtn.isConnected) return;
        micBtn.classList.remove('on'); micBtn.innerHTML = ICON.mic + 'ابدأ الكلام';
        if (heard.trim()) parse();
      };
      try {
        rec.start(); listening = true;
        micBtn.classList.add('on'); micBtn.innerHTML = ICON.mic + 'بسمعك… دوس هنا لما تخلص';
        status('');
      } catch (e){ status('المايك مش متاح هنا. استخدم مايك الكيبورد.', true); }
    });
    addBtn.addEventListener('click', () => {
      if (!S.db){ status('سجّل دخول بحساب جوجل الأول.', true); return; }
      const items = draft.map(d => ({name: cleanText(d.name), qty: d.qty || null, note: d.note, center: d.center})).filter(d => d.name);
      if (!items.length) return;
      items.forEach(d => addItem(d.name, d.qty, d.note, true, d.center));
      render();
      closeModal();
      toast(items.length === 1 ? `اتضاف «${items[0].name}» للنواقص` : `اتضاف ${countItems(items.length)} للنواقص`);
    });
    drawList();
    if (!SR) setTimeout(() => ta.focus(), 30);
    return () => stopMic();
  });
}
$('#bulkBtn').addEventListener('click', openBulk);

/* ---------- modal ---------- */
let lastFocus = null, modalCleanup = null;
function openModal(html, mount){
  closeModal(true);
  lastFocus = document.activeElement;
  const card = $('#modalCard');
  card.innerHTML = html;
  $('#modal').hidden = false;
  document.body.classList.add('modal-open');
  modalCleanup = mount ? mount(card) || null : null;
  const h = card.querySelector('#modalTitle'); if (h) h.focus({preventScroll: true});
}
function closeModal(silent){
  if ($('#modal').hidden) return;
  if (typeof modalCleanup === 'function') modalCleanup();
  modalCleanup = null;
  $('#modal').hidden = true;
  $('#modalCard').innerHTML = '';
  document.body.classList.remove('modal-open');
  if (!silent && lastFocus && lastFocus.isConnected) lastFocus.focus({preventScroll: true});
}
$('#modal').addEventListener('click', e => {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
function headHTML(title){
  return `<div class="m-head"><h2 id="modalTitle" tabindex="-1">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="قفل">${ICON.x}</button></div>`;
}
/* ---------- edit item ---------- */
function openEdit(id){
  const it = S.items.get(id); if (!it) return;
  openModal(headHTML('تعديل الصنف') + `
    <div><label class="lbl" for="eName">اسم الصنف</label><input class="inp" id="eName" type="text" value="${esc(it.name)}"></div>
    <div><span class="lbl">المركز</span><div class="cseg" role="group" aria-label="المركز">${centerButtonsHTML(centerOf(it), 'data-ec')}</div></div>
    <div><label class="lbl" for="eQty">العدد (اختياري)</label><input class="inp" id="eQty" type="text" inputmode="numeric" style="max-width:180px" value="${esc(it.qty || '')}" placeholder="من غير عدد"></div>
    <div><label class="lbl" for="eNote">ملاحظة</label><input class="inp" id="eNote" type="text" value="${esc(it.note || '')}" placeholder="مثلاً: أزرق بس"></div>
    <div class="m-actions"><button type="button" class="btn primary" id="eSave">حفظ</button><button type="button" class="btn danger" id="eDel">شيله من النواقص</button></div>`,
  card => {
    const q = card.querySelector('#eQty');
    let ec = centerOf(it);
    card.querySelectorAll('[data-ec]').forEach(b => b.addEventListener('click', () => {
      ec = b.dataset.ec;
      card.querySelectorAll('[data-ec]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.ec === ec)));
    }));
    card.querySelector('#eSave').addEventListener('click', () => {
      const name = cleanText(card.querySelector('#eName').value);
      if (!name){ card.querySelector('#eName').focus(); return; }
      const patch = {name, key: norm(name), qty: parseQty(q.value) || null, note: cleanText(card.querySelector('#eNote').value), updatedAt: Date.now()};
      S.items.set(id, Object.assign({}, it, patch));
      patch.center = ec || null;
      S.items.set(id, Object.assign({}, it, patch));
      write('items/' + id, () => itemsCol().doc(id).update(patch)).catch(reportWriteError);
      if (ec) assignCenter(name, ec);
      closeModal(); render(); toast('اتحفظ');
    });
    card.querySelector('#eDel').addEventListener('click', () => { closeModal(); deleteItem(it); });
  });
}
function deleteItem(it, arrived){
  const data = Object.assign({}, it); delete data.id;
  S.items.delete(it.id); render();
  write('items/' + it.id, () => itemsCol().doc(it.id).delete()).catch(reportWriteError);
  toast(arrived ? `«${it.name}» وصل واتشال` : `اتشال «${it.name}»`, {action: 'تراجع', onAction: () => {
    S.items.set(it.id, Object.assign({id: it.id}, data)); render();
    write('items/' + it.id, () => itemsCol().doc(it.id).set(data)).catch(reportWriteError);
  }});
}

/* ---------- message ---------- */
function buildMessage(list, ts, target){
  const shop = S.settings.shopName;
  const single = !!target && target !== 'all';
  const lines = [shop ? `*كشف نواقص — ${shop}*` : '*كشف نواقص*'];
  if (single) lines.push(`*${centerLabel(target)}*`);
  lines.push(fmtLong(ts), '');
  const secs = single ? [{id: null, label: '', items: list.slice().sort(byName)}] : groupByCenter(list);
  const heads = !single && !(secs.length === 1 && secs[0].id === null);
  secs.forEach(sec => {
    if (heads) lines.push(`*${sec.label}* (${sec.items.length})`);
    sec.items.forEach((it, i) => {
      lines.push(`${i + 1}- ${it.name}` + (it.qty ? `‏ × ${it.qty}` : ''));
      if (it.note) lines.push(`     (${it.note}‏)`);
    });
    lines.push('');
  });
  lines.push(`عدد الأصناف: ${list.length}`);
  return lines.join('\n');
}
function waPhone(p){
  let d = toLatin(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = '20' + d.slice(1);
  return d;
}
function saveSettings(patch){
  S.settings = Object.assign({}, S.settings, patch);
  renderHeader();
  if (!S.db) return Promise.resolve();
  const ph = S.settings.phones || {};
  const body = {shopName: S.settings.shopName || '', phone: S.settings.phone || '', phones: {nasr: ph.nasr || '', mamar: ph.mamar || '', shaqa: ph.shaqa || ''}};
  return write('settings/main', () => S.db.doc('settings/main').set(body)).catch(reportWriteError);
}


/* ---------- send sheet ---------- */
function openSend(){
  const base = allItems().map(x => Object.assign({}, x, {center: centerOf(x)}));
  if (!base.length){ toast('مفيش نواقص تتبعت'); return; }
  const ctx = {target: 'all', ts: Date.now()};
  const canPdf = true;
  openModal(headHTML('كشف النواقص') + `
    <div id="sTargetsBox"><span class="lbl">تبعته لمين؟</span><div class="filters tight" id="sTargets" role="radiogroup" aria-label="المركز"></div></div>
    <pre class="preview" id="sPreview" tabindex="0" aria-label="نص الكشف"></pre>
    <div><label class="lbl" for="sPhone" id="sPhoneL">رقم واتساب المخزن</label>
      <input class="inp" id="sPhone" type="tel" inputmode="tel" dir="ltr" style="text-align:right" placeholder="01xxxxxxxxx">
      <p class="hint">لو سبته فاضي، واتساب هيسألك تبعت لمين.</p></div>
    <div class="send-actions">
      <a class="btn primary wa" id="sWa" href="https://wa.me/" target="_blank" rel="noopener noreferrer">${ICON.chat}ابعت على واتساب</a>
      <button type="button" class="btn" id="sCopy">${ICON.copy}نسخ الكشف</button>
      <button type="button" class="btn" id="sPdf" ${canPdf ? '' : 'hidden'}>${ICON.file}PDF (واتساب / طباعة)</button>
    </div>`,
  card => {
    const pre = card.querySelector('#sPreview'), wa = card.querySelector('#sWa'), phone = card.querySelector('#sPhone');
    const tEl = card.querySelector('#sTargets');
    const list = () => base.filter(it => ctx.target === 'all' || (it.center || 'none') === ctx.target);
    const phoneKey = () => validCenter(ctx.target);
    const getPhone = () => { const k = phoneKey(); return k ? ((S.settings.phones || {})[k] || '') : (S.settings.phone || ''); };
    const counts = {all: base.length, none: 0}; CENTERS.forEach(c => { counts[c.id] = 0; });
    base.forEach(it => { counts[it.center || 'none']++; });
    const centersPresent = CENTERS.map(c => c.id).filter(id => counts[id]);
    const ids = ['all'].concat(centersPresent, counts.none ? ['none'] : []);
    card.querySelector('#sTargetsBox').hidden = !centersPresent.length;
    tEl.innerHTML = ids.map(id => `<button type="button" role="radio" class="fbtn${CENTER_NAME[id] ? ' c-' + id : ''}" data-target="${id}">${CENTER_NAME[id] ? '<i></i>' : ''}${id === 'all' ? 'الكشف كله متقسم' : esc(centerLabel(id))} <b>${counts[id]}</b></button>`).join('');
    const update = () => {
      const msg = buildMessage(list(), ctx.ts, ctx.target);
      pre.textContent = msg.replace(/\*/g, '');
      wa.href = 'https://wa.me/' + waPhone(phone.value) + '?text=' + encodeURIComponent(msg);
      tEl.querySelectorAll('[data-target]').forEach(b => { const on = b.dataset.target === ctx.target; b.setAttribute('aria-checked', String(on)); b.setAttribute('aria-pressed', String(on)); });
      card.querySelector('#sPhoneL').textContent = phoneKey() ? `رقم واتساب ${CENTER_NAME[phoneKey()]}` : 'رقم واتساب المخزن';
    };
    tEl.addEventListener('click', e => {
      const b = e.target.closest('[data-target]'); if (!b) return;
      ctx.target = b.dataset.target; phone.value = getPhone(); update();
    });
    phone.addEventListener('input', update);
    phone.addEventListener('change', () => {
      const v = cleanText(phone.value), k = phoneKey();
      if (k) saveSettings({phones: Object.assign({}, S.settings.phones, {[k]: v})}); else saveSettings({phone: v});
    });
    card.querySelector('#sCopy').addEventListener('click', () => {
      const msg = buildMessage(list(), ctx.ts, ctx.target);
      const fallback = () => {
        const r = document.createRange(); r.selectNodeContents(pre);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        let done = false; try { done = document.execCommand('copy'); } catch (e){}
        toast(done ? 'اتنسخ الكشف' : 'النص متعلّم، انسخه من القائمة');
      };
      try { navigator.clipboard.writeText(msg).then(() => toast('اتنسخ الكشف'), fallback); } catch (e){ fallback(); }
    });
    card.querySelector('#sPdf').addEventListener('click', async e => {
      const b = e.currentTarget; const old = b.innerHTML;
      b.disabled = true; b.textContent = 'بجهز الملف…';
      try {
        const blob = await makePdf(list(), ctx.ts, ctx.target);
        const r = await saveFile(blob, pdfName(ctx.ts, ctx.target), 'application/pdf', true);
        if (r === 'saved') toast('اتحفظ ملف الـPDF في التنزيلات');
      } catch (err){
        if (err && err.code === 'declined'){}
        else if (err && err.code === 'rate_limited') toast('استنى ثانية وجرب تاني');
        else toast('ماقدرتش أعمل ملف الـPDF هنا');
      } finally { if (b.isConnected){ b.disabled = false; b.innerHTML = old; } }
    });
    phone.value = getPhone(); update();
  });
}
function pdfName(ts, target){
  const d = new Date(ts);
  const c = CENTER_NAME[target] ? '-' + target : '';
  return `nawaqes${c}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`;
}


/* ---------- settings sheet ---------- */
function openSettings(){
  const ph = S.settings.phones || {};
  const phoneField = (id, label, val) => `<div><label class="lbl" for="${id}">${label}</label><input class="inp" id="${id}" type="tel" inputmode="tel" dir="ltr" style="text-align:right" placeholder="01xxxxxxxxx" value="${esc(val || '')}"></div>`;
  const who = S.user ? (S.user.email || S.user.displayName || '') : '';
  openModal(headHTML('الإعدادات') + `
    ${S.user ? `<div class="acct"><span>داخل بـ <b>${esc(who)}</b></span><button type="button" class="btn small" id="stOut">خروج</button></div>` : ''}
    <div><label class="lbl" for="stShop">اسم المكتبة</label><input class="inp" id="stShop" type="text" placeholder="مثلاً: مكتبة النور" value="${esc(S.settings.shopName || '')}">
      <p class="hint">بيظهر في أول كشف النواقص.</p></div>
    ${phoneField('stPhone', 'رقم واتساب المخزن (للكشف كله)', S.settings.phone)}
    ${CENTERS.map(c => phoneField('stPh_' + c.id, 'رقم واتساب ' + c.name, ph[c.id])).join('')}
    <p class="hint">كل الأرقام اختيارية. لما تبعت كشف مركز لوحده، واتساب بيفتح على رقم المركز ده.</p>
    <div class="m-actions"><button type="button" class="btn primary" id="stSave">حفظ</button></div>
    <div><span class="lbl">البيانات</span>
      <div class="m-actions"><button type="button" class="btn" id="stExport">نسخة احتياطية</button><button type="button" class="btn" id="stImport">استيراد ملف</button></div>
      <p class="hint">«استيراد ملف» بيضيف الأصناف والنواقص من ملف نسخة احتياطية أو من ملف النقل من البرنامج القديم.</p>
      <input type="file" id="stFile" accept=".json,application/json" hidden></div>`,
  card => {
    card.querySelector('#stSave').addEventListener('click', () => {
      if (!S.db){ toast('سجّل دخول بحساب جوجل الأول.'); return; }
      const phones = {}; CENTERS.forEach(c => { phones[c.id] = cleanText(card.querySelector('#stPh_' + c.id).value); });
      saveSettings({shopName: cleanText(card.querySelector('#stShop').value), phone: cleanText(card.querySelector('#stPhone').value), phones});
      closeModal(); toast('اتحفظت الإعدادات');
    });
    const out = card.querySelector('#stOut');
    if (out) out.addEventListener('click', () => { closeModal(); if (STORE) STORE.signOut(); });
    card.querySelector('#stExport').addEventListener('click', async () => {
      const blob = new Blob([JSON.stringify(exportData(), null, 1)], {type: 'application/json'});
      const d = new Date();
      await saveFile(blob, `nawaqes-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`, 'application/json', false);
      toast('اتحفظت النسخة الاحتياطية في التنزيلات');
    });
    const fileEl = card.querySelector('#stFile');
    card.querySelector('#stImport').addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async () => {
      const f = fileEl.files && fileEl.files[0]; if (!f) return;
      if (!S.db){ toast('سجّل دخول بحساب جوجل الأول.'); return; }
      try {
        const n = await importData(JSON.parse(await f.text()));
        closeModal();
        toast(`اتنقل ${countItems(n.items)} للنواقص و${countItems(n.catalog)} لقاعدة الأصناف`);
      } catch (e){
        toast(e && e.message === 'bad-file' ? 'الملف ده مش ملف نواقص.' : 'ماقدرتش أقرا الملف. جرب تاني.');
      }
    });
  });
}
function exportData(){
  const strip = o => { const c = Object.assign({}, o); return c; };
  return {app: 'nawaqes', version: 1, exportedAt: new Date().toISOString(),
    settings: {shopName: S.settings.shopName || '', phone: S.settings.phone || '', phones: Object.assign({}, S.settings.phones || {})},
    items: [...S.items.values()].map(strip), catalog: [...S.catalog.values()].map(strip)};
}
async function importData(data){
  if (!data || data.app !== 'nawaqes') throw new Error('bad-file');
  const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o[k] !== undefined) r[k] = o[k]; }); return r; };
  const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_\-]{1,100}$/.test(id);
  const ops = [];
  const items = (data.items || []).filter(x => x && safeId(x.id) && x.name);
  const catalog = (data.catalog || []).filter(x => x && safeId(x.id) && x.name);
  items.forEach(x => ops.push({path: 'items/' + x.id, data: Object.assign({key: norm(x.name), qty: null, note: '', center: null, addedAt: Date.now(), updatedAt: Date.now()}, pick(x, ['name', 'key', 'qty', 'note', 'center', 'addedAt', 'updatedAt']))}));
  catalog.forEach(x => ops.push({path: 'catalog/' + x.id, data: Object.assign({key: norm(x.name), uses: 0, lastAt: 0, center: null}, pick(x, ['name', 'key', 'uses', 'lastAt', 'center']))}));
  if (data.settings){
    const st = data.settings, ph = st.phones || {};
    const cur = S.settings;
    ops.push({path: 'settings/main', data: {shopName: cur.shopName || st.shopName || '', phone: cur.phone || st.phone || '',
      phones: {nasr: (cur.phones || {}).nasr || ph.nasr || '', mamar: (cur.phones || {}).mamar || ph.mamar || '', shaqa: (cur.phones || {}).shaqa || ph.shaqa || ''}}});
  }
  await S.db.batchSet(ops);
  return {items: items.length, catalog: catalog.length};
}
async function saveFile(blob, filename, type, preferShare){
  if (preferShare && navigator.canShare){
    try {
      const file = new File([blob], filename, {type});
      if (navigator.canShare({files: [file]})){ await navigator.share({files: [file], title: filename}); return 'shared'; }
    } catch (e){ if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}

/* ---------- PDF (drawn on canvas, wrapped as A4 pages) ---------- */
function wrapText(ctx, text, maxW, maxLines){
  const ell = s => { while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; };
  const words = String(text).split(' ');
  const lines = []; let line = '';
  for (const w of words){
    const t = line ? line + ' ' + w : w;
    if (!line || ctx.measureText(t).width <= maxW) line = t; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  let out = lines;
  if (lines.length > maxLines){ out = lines.slice(0, maxLines); out[maxLines - 1] = ell(lines.slice(maxLines - 1).join(' ')); }
  return out.map(l => ctx.measureText(l).width > maxW ? ell(l) : l);
}
async function makePdf(list, ts, target){
  const BODY = '"IBM Plex Sans Arabic", Tahoma, sans-serif', DISP = '"Aref Ruqaa", "IBM Plex Sans Arabic", serif';
  try {
    await Promise.all([
      document.fonts.load('700 54px "Aref Ruqaa"', 'كشف نواقص'),
      document.fonts.load('500 21px "IBM Plex Sans Arabic"', 'كشكول 60'),
      document.fonts.load('600 24px "IBM Plex Sans Arabic"', 'النصرية الممر الشقة')
    ]);
  } catch (e){}
  // A4 drawn in 1240 x 1754 units, rendered at 1.5x for crisp small text
  const W = 1240, H = 1754, K = 1.5;
  const C = {ink: '#17224A', soft: '#6A7597', pen: '#2343B5', rule: '#D3E0F2', col: '#B9CBE8', margin: '#D9443A', band: '#EEF3FB',
    nasr: '#0E7C72', mamar: '#6D45C8', shaqa: '#B8325F', none: '#9A6A12'};
  const M = 48, COLS = 3, colW = (W - 2 * M) / COLS, PAD = 12, NUM_W = 40;
  const nameW = colW - NUM_W - PAD * 2;
  const FN = '500 21px ' + BODY, FNUM = '500 15px ' + BODY;
  const LH = 27, HEAD_H = 54;
  const cv = document.createElement('canvas'); cv.width = Math.round(W * K); cv.height = Math.round(H * K);
  const ctx = cv.getContext('2d');
  ctx.direction = 'rtl';
  const single = !!target && target !== 'all';
  const secs = single ? [{id: validCenter(target), label: centerLabel(target), items: list.slice().sort(byName)}] : groupByCenter(list);
  const heads = !single && !(secs.length === 1 && secs[0].id === null);
  const blocks = [];
  for (const sec of secs){
    if (heads) blocks.push({t: 'head', sec, h: HEAD_H});
    const cells = sec.items.map((it, i) => {
      ctx.font = FN;
      const label = it.name + (it.note ? ' (' + it.note + '‏)' : '') + (it.qty ? '‏ × ' + it.qty : '');
      const nl = wrapText(ctx, label, nameW, 2);
      return {n: i + 1, nl, h: 13 + nl.length * LH};
    });
    for (let i = 0; i < cells.length; i += COLS){
      const r = cells.slice(i, i + COLS);
      blocks.push({t: 'row', sec, cells: r, h: Math.max(40, Math.max.apply(null, r.map(c => c.h)))});
    }
  }
  const TOP1 = 176, TOPN = 112, BOTTOM = H - 70;
  const pages = []; let cur = []; let y = TOP1;
  blocks.forEach((b, i) => {
    const need = b.h + (b.t === 'head' && blocks[i + 1] ? blocks[i + 1].h : 0);
    if (y + need > BOTTOM && cur.length){
      pages.push(cur); cur = []; y = TOPN;
      if (b.t === 'row' && heads){ cur.push({t: 'head', sec: b.sec, h: HEAD_H, cont: true}); y += HEAD_H; }
    }
    cur.push(b); y += b.h;
  });
  pages.push(cur);
  const shop = S.settings.shopName;
  const jpegs = [];
  for (let p = 0; p < pages.length; p++){
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.margin; ctx.fillRect(W - 26, 0, 2, H);
    ctx.textBaseline = 'alphabetic';
    let top;
    if (p === 0){
      ctx.fillStyle = C.pen; ctx.font = '700 54px ' + DISP; ctx.textAlign = 'right';
      ctx.fillText('كشف نواقص', W - M, 84);
      const sub = single ? centerLabel(target) + (shop ? ' — ' + shop : '') : shop;
      if (sub){ ctx.fillStyle = single ? (C[validCenter(target) || 'none']) : C.ink; ctx.font = '600 24px ' + BODY; ctx.fillText(sub, W - M, 130); }
      ctx.textAlign = 'left'; ctx.fillStyle = C.soft; ctx.font = '400 20px ' + BODY;
      ctx.fillText(fmtLong(ts), M, 78);
      ctx.fillText('عدد الأصناف: ' + list.length, M, 112);
      top = TOP1;
    } else {
      ctx.fillStyle = C.pen; ctx.font = '700 34px ' + DISP; ctx.textAlign = 'right';
      ctx.fillText('كشف نواقص (تابع)' + (single ? ' — ' + centerLabel(target) : ''), W - M, 70);
      ctx.textAlign = 'left'; ctx.fillStyle = C.soft; ctx.font = '400 18px ' + BODY;
      ctx.fillText(fmtLong(ts), M, 66);
      top = TOPN;
    }
    ctx.fillStyle = C.ink; ctx.fillRect(M, top - 14, W - 2 * M, 2.5);
    let ry = top;
    for (const b of pages[p]){
      if (b.t === 'head'){
        const color = C[b.sec.id || 'none'];
        ctx.fillStyle = C.band; ctx.fillRect(M, ry + 8, W - 2 * M, b.h - 12);
        ctx.fillStyle = color; ctx.fillRect(W - M - 6, ry + 8, 6, b.h - 12);
        ctx.textAlign = 'right'; ctx.font = '600 24px ' + BODY; ctx.fillStyle = color;
        ctx.fillText(b.sec.label + (b.cont ? ' (تابع)' : ''), W - M - 22, ry + 38);
        ctx.textAlign = 'left'; ctx.font = '400 18px ' + BODY; ctx.fillStyle = C.soft;
        ctx.fillText(countItems(b.sec.items.length), M + 14, ry + 37);
        ry += b.h;
        continue;
      }
      b.cells.forEach((c, k) => {
        const xr = W - M - k * colW;
        ctx.textAlign = 'right';
        ctx.fillStyle = C.soft; ctx.font = FNUM;
        ctx.fillText(c.n + '.', xr - PAD + 2, ry + 28);
        ctx.fillStyle = C.ink; ctx.font = FN;
        c.nl.forEach((l, i) => ctx.fillText(l, xr - PAD - NUM_W, ry + 28 + i * LH));
      });
      ctx.fillStyle = C.col;
      for (let k = 1; k < COLS; k++) ctx.fillRect(W - M - k * colW - 0.75, ry, 1.5, b.h);
      ry += b.h;
      ctx.fillStyle = C.rule; ctx.fillRect(M, ry - 1, W - 2 * M, 1.5);
    }
    if (pages.length > 1){
      ctx.fillStyle = C.soft; ctx.font = '400 18px ' + BODY; ctx.textAlign = 'center';
      ctx.fillText(`صفحة ${p + 1} من ${pages.length}`, W / 2, H - 34);
    }
    jpegs.push(await canvasJpeg(cv));
  }
  return buildPdf(jpegs, cv.width, cv.height);
}
function canvasJpeg(cv){
  return new Promise(resolve => {
    const fromDataUrl = () => {
      const b64 = cv.toDataURL('image/jpeg', 0.9).split(',')[1];
      const bin = atob(b64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      resolve(u);
    };
    try {
      cv.toBlob(b => { if (!b) return fromDataUrl(); b.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), fromDataUrl); }, 'image/jpeg', 0.9);
    } catch (e){ fromDataUrl(); }
  });
}
function buildPdf(jpegs, W, H){
  const enc = new TextEncoder(); const parts = []; let len = 0; const offs = [];
  const add = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const PW = 595.28, PH = 841.89, n = jpegs.length, total = 2 + n * 3;
  add('%PDF-1.4\n'); add(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  offs[1] = len; add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offs[2] = len; add(`2 0 obj\n<< /Type /Pages /Kids [${jpegs.map((_, i) => (3 + i * 3) + ' 0 R').join(' ')}] /Count ${n} >>\nendobj\n`);
  jpegs.forEach((jpg, i) => {
    const pg = 3 + i * 3, im = pg + 1, ct = pg + 2;
    offs[pg] = len; add(`${pg} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${ct} 0 R >>\nendobj\n`);
    offs[im] = len; add(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    add(jpg); add('\nendstream\nendobj\n');
    const cs = `q ${PW} 0 0 ${PH} 0 0 cm /Im${i} Do Q`;
    offs[ct] = len; add(`${ct} 0 obj\n<< /Length ${cs.length} >>\nstream\n${cs}\nendstream\nendobj\n`);
  });
  const xref = len;
  let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let k = 1; k <= total; k++) x += String(offs[k]).padStart(10, '0') + ' 00000 n \n';
  add(x);
  add(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, {type: 'application/pdf'});
}

/* ---------- navigation & global clicks ---------- */
function setView(v){
  S.view = v;
  $('#view-list').hidden = v !== 'list';
  $('#view-db').hidden = v !== 'db';
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === v)));
  renderBar();
  window.scrollTo(0, 0);
}
function openNewProduct(){
  let center = CENTER_NAME[S.dbFilter] ? S.dbFilter : null;
  openModal(headHTML('صنف جديد') + `
    <div><label class="lbl" for="npName">اسم الصنف</label><input class="inp" id="npName" type="text" placeholder="مثلاً: كشكول 60 مسطر" autocomplete="off"></div>
    <div><span class="lbl">تبع أنهي مركز؟</span><div class="cseg" role="group" aria-label="المركز">${centerButtonsHTML(center, 'data-npc')}</div></div>
    <div class="m-actions"><button type="button" class="btn primary" id="npSave">ضيفه للأصناف</button></div>
    <p class="b-status" id="npStatus" role="status"></p>`,
  card => {
    const nameEl = card.querySelector('#npName'), st = card.querySelector('#npStatus');
    card.querySelectorAll('[data-npc]').forEach(b => b.addEventListener('click', () => {
      center = b.dataset.npc;
      card.querySelectorAll('[data-npc]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.npc === center)));
    }));
    const save = () => {
      const name = cleanText(nameEl.value);
      if (!name){ st.textContent = 'اكتب اسم الصنف'; st.classList.add('err'); nameEl.focus(); return; }
      if (!center){ st.textContent = 'اختار المركز'; st.classList.add('err'); return; }
      if (!S.db){ st.textContent = 'سجّل دخول بحساب جوجل الأول.'; st.classList.add('err'); return; }
      const key = norm(name), cid = catId(key);
      const existed = S.catalog.has(cid);
      setProductCenter(S.catalog.get(cid) || {id: cid, name, key, uses: 0, lastAt: Date.now()}, center);
      render();
      st.classList.remove('err');
      st.textContent = existed ? `«${name}» كان موجود، واتحط في ${CENTER_NAME[center]}` : `اتضاف «${name}» في ${CENTER_NAME[center]}. اكتب اللي بعده.`;
      nameEl.value = ''; nameEl.focus();
    };
    card.querySelector('#npSave').addEventListener('click', save);
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); save(); } });
    setTimeout(() => nameEl.focus(), 30);
  });
}
$('#npBtn').addEventListener('click', openNewProduct);
$('#dbSearch').addEventListener('input', e => { S.dbQuery = e.target.value; renderDb(); });
$('#view-db').addEventListener('click', e => {
  const f = e.target.closest('[data-dbf]'); if (f){ S.dbFilter = f.dataset.dbf; renderDb(); return; }
  const pc = e.target.closest('[data-pc]');
  if (pc){
    const p = S.catalog.get(pc.closest('[data-pid]').dataset.pid); if (!p || !S.db) return;
    if (validCenter(p.center) === pc.dataset.pc) return;
    setProductCenter(p, pc.dataset.pc); render();
    return;
  }
  const del = e.target.closest('[data-pdel]');
  if (del){
    const p = S.catalog.get(del.closest('[data-pid]').dataset.pid); if (!p || !S.db) return;
    const body = Object.assign({}, p); delete body.id;
    S.catalog.delete(p.id); render();
    write('catalog/' + p.id, () => catCol().doc(p.id).delete()).catch(reportWriteError);
    toast(`اتمسح «${p.name}» من الأصناف`, {action: 'تراجع', onAction: () => {
      S.catalog.set(p.id, p); render();
      write('catalog/' + p.id, () => catCol().doc(p.id).set(body)).catch(reportWriteError);
    }});
  }
});
$('#listSearch').addEventListener('input', e => { S.listQuery = e.target.value; renderList(); });
$('#cfilter').addEventListener('click', e => {
  const b = e.target.closest('[data-lf]'); if (!b) return;
  S.listFilter = b.dataset.lf; renderFilters(); renderList();
});
$$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
$('#settingsBtn').addEventListener('click', openSettings);
$('#sendBtn').addEventListener('click', openSend);
document.addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]'); if (ed){ openEdit(ed.dataset.edit); return; }
  const dn = e.target.closest('[data-done]');
  if (dn){
    const it = S.items.get(dn.dataset.done); if (!it || !S.db) return;
    dn.classList.add('on'); dn.closest('.row').classList.add('done');
    setTimeout(() => deleteItem(it, true), 260);
  }
});

/* ---------- data ---------- */
let loadTimer = null;
function allFresh(){ return SUBS.every(k => S.fresh[k]); }
function markSnap(name, snap){
  S.has[name] = true;
  if (!snap.metadata || !snap.metadata.fromCache) S.fresh[name] = true;
  if (allFresh()){ clearTimeout(loadTimer); if (S.stale){ S.stale = false; } }
}
function subErr(e){
  const code = e && e.code;
  S.dbStatus = 'error';
  S.dbError = code === 'permission-denied'
    ? 'قاعدة البيانات رافضة الحساب ده. اتأكد إن قواعد Firestore متحطة زي ما في ملف firestore.rules.'
    : 'الاتصال بالبيانات وقف. اقفل الأبلكيشن وافتحه تاني.';
  clearTimeout(loadTimer); render();
}

let STORE = null, UNSUBS = [];
function gate(kind, extra){
  const g = $('#gate'), b = $('#gateBody');
  if (!kind){ g.hidden = true; return; }
  g.hidden = false;
  if (kind === 'loading'){ b.innerHTML = '<p>بيفتح…</p>'; return; }
  if (kind === 'error'){ b.innerHTML = `<p>${esc(extra || 'حصلت مشكلة وأنا بفتح الأبلكيشن. اتأكد من النت وافتحه تاني.')}</p><button type="button" class="btn primary" id="gRetry">جرّب تاني</button>`; $('#gRetry').onclick = () => location.reload(); return; }
  if (kind === 'signin'){
    b.innerHTML = `<p>سجّل دخول بحساب جوجل عشان النواقص تتحفظ وتظهر على الموبايل والكمبيوتر. استخدم نفس الحساب على كل الأجهزة.</p>
      <button type="button" class="btn primary" id="gIn" style="height:54px;font-size:17px">ادخل بحساب جوجل</button>
      <p class="b-status" id="gSt" role="status"></p>`;
    $('#gIn').onclick = async () => {
      const st = $('#gSt'); st.classList.remove('err'); st.textContent = 'بيفتح جوجل…';
      try { await STORE.signIn(); }
      catch (e){
        const c = e && e.code;
        st.classList.add('err');
        st.textContent = c === 'auth/unauthorized-domain' ? 'الدومين ده مش متضاف في Firebase. ضيف ' + location.hostname + ' في Authentication ← Settings ← Authorized domains.'
          : c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' ? 'اتقفلت شاشة جوجل قبل ما تختار الحساب. جرّب تاني.'
          : c === 'auth/operation-not-allowed' ? 'الدخول بجوجل مش متفعل في Firebase. فعّله من Authentication ← Sign-in method.'
          : c === 'auth/configuration-not-found' ? 'خدمة Authentication لسه مش متفعلة في Firebase. افتح Authentication ودوس Get started، وبعدين فعّل Google.'
          : c === 'auth/network-request-failed' ? 'مفيش نت. اتأكد من النت وجرّب تاني.'
          : 'ماقدرتش أدخل. اتأكد من النت وجرّب تاني.' + (c ? ' (' + c + ')' : '');
      }
    };
    return;
  }
  if (kind === 'setup'){
    b.innerHTML = `<p>الأبلكيشن لسه مش متوصل بقاعدة البيانات (Firebase). الصق هنا إعدادات الويب اللي Firebase إداهالك (الجزء اللي فيه apiKey).</p>
      <label for="gCfg" class="vh">إعدادات Firebase</label>
      <textarea class="inp" id="gCfg" placeholder='const firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." };'></textarea>
      <button type="button" class="btn primary" id="gSave">وصّل</button>
      <p class="b-status" id="gSt" role="status"></p>
      <p class="hint">الأحسن تبعت الإعدادات دي لـClaude يحطها في الأبلكيشن نفسه، عشان كل الأجهزة تشتغل من غير ما تلزقها على كل جهاز.</p>`;
    $('#gSave').onclick = () => {
      const cfg = parseConfig($('#gCfg').value);
      if (!cfg){ const st = $('#gSt'); st.classList.add('err'); st.textContent = 'مش لاقي apiKey و projectId و appId في اللي لزقته.'; return; }
      saveLocalConfig(cfg); location.reload();
    };
  }
}
function stopData(){
  UNSUBS.forEach(u => { try { u(); } catch (e){} });
  UNSUBS = [];
  clearTimeout(loadTimer);
  S.db = null; S.dbStatus = 'none'; S.has = {}; S.fresh = {}; S.stale = false;
  S.items = new Map(); S.catalog = new Map(); S.settings = {shopName: '', phone: '', phones: {}};
}
function startData(db){
  stopData();
  S.db = db; S.dbStatus = 'ok';
  loadTimer = setTimeout(() => { if (!allFresh()){ S.stale = true; render(); } }, 10000);
  UNSUBS.push(db.collection('items').onSnapshot(snap => {
    S.items = new Map(snap.docs.map(d => [d.id, Object.assign({id: d.id}, d.data())]));
    markSnap('items', snap); render();
    if (!sugEl.hidden) renderSuggest();
  }, subErr));
  UNSUBS.push(db.collection('catalog').onSnapshot(snap => {
    S.catalog = new Map(snap.docs.map(d => [d.id, Object.assign({id: d.id}, d.data())]));
    markSnap('catalog', snap); render();
    if (!sugEl.hidden) renderSuggest();
  }, subErr));
  UNSUBS.push(db.doc('settings/main').onSnapshot(snap => {
    const d = snap.exists ? snap.data() : {};
    S.settings = {shopName: d.shopName || '', phone: d.phone || '', phones: Object.assign({}, d.phones || {})};
    markSnap('settings', snap); renderHeader();
  }, subErr));
  render();
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
window.addEventListener('appinstalled', () => { installEvt = null; $('#installBtn').hidden = true; toast('اتثبّت الأبلكيشن'); });
$('#installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  try { await installEvt.userChoice; } catch (e){}
  installEvt = null; $('#installBtn').hidden = true;
});
async function boot(){
  render();
  gate('loading');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try { STORE = await initStore(); }
  catch (e){ gate('error', 'ماقدرتش أوصل لـFirebase. اتأكد من النت وافتح الأبلكيشن تاني.'); return; }
  if (!STORE.configured){ gate('setup'); return; }
  STORE.onAuth(user => {
    if (!user){ S.user = null; stopData(); render(); gate('signin'); return; }
    S.user = user; gate(null); startData(STORE.db(user.uid));
  });
}
boot();
})();
