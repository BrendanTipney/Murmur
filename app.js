import { FieldSystem } from './field.js';
import * as fx from './fx.js';
import * as sync from './sync.js';

const GOAL = 27;
const KEY = 'murmur.v1';
const $ = (s) => document.querySelector(s);

// ---------- storage ----------

// Each habit keeps a log of { 'YYYY-MM-DD': { d: 1|0, t: <epoch ms> } }. Storing
// un-ticks (d: 0) and a timestamp per day is what lets two devices merge, and
// deleted habits stay as tombstones so the delete travels too.
function migrate(s) {
  for (const h of s.habits) {
    if (!h.log) {
      h.log = {};
      for (const d of h.days || []) h.log[d] = { d: 1, t: 0 };
    }
    delete h.days;
    h.updated = h.updated || 0;
  }
  return s;
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.habits)) return migrate({ sound: true, ...s });
  } catch {}
  return { habits: [], sound: true };
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
navigator.storage?.persist?.();

const live = () => state.habits.filter((h) => !h.deleted);
const doneDays = (h) => Object.keys(h.log).filter((d) => h.log[d].d);

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- dates & streaks ----------

const pad2 = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayKey = () => keyOf(new Date());
function prevKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return keyOf(new Date(y, m - 1, d - 1));
}

/** Consecutive days ending today, or yesterday if today isn't done yet. */
function streakOf(h) {
  const set = new Set(doneDays(h));
  let k = todayKey();
  if (!set.has(k)) k = prevKey(k);
  let n = 0;
  while (set.has(k)) { n++; k = prevKey(k); }
  return n;
}
const doneToday = (h) => !!h.log[todayKey()]?.d;

// ---------- geometry ----------

const col = $('#col');
const fields = new FieldSystem();
let geo = null;
let rows = []; // [{h, row, info, hex, cv, fieldW, mirror}]

function computeGeo() {
  const W = Math.min(window.innerWidth, 520);
  const hexW = Math.round(Math.max(84, Math.min(116, W * 0.24)));
  const hexH = hexW / 0.866;      // pointy-top hexes: the long axis is vertical
  // True honeycomb: each row steps half a width across and three quarters of a
  // height down, so neighbouring hexes share a whole slanted edge.
  // On each side the rows alternate details, lane, details, so a lane's
  // neighbours above and below are 1.5 hex heights apart: fill that gap.
  const infoH = Math.round(hexH * 0.55);
  return {
    W, hexW, hexH, infoH,
    step: hexH * 0.75,
    off: hexW * 0.5,
    fieldH: hexH * 1.5 - infoH - 6, // pattern lane, centred on its hex
    pad: 6,
    top: 10,
    radius: 14,
  };
}

function rowGeo(i) {
  const g = geo;
  const left = i % 2 === 0; // hex left of centre: details left, pattern right
  const cx = g.W / 2 + (left ? -g.off / 2 : g.off / 2);
  const cy = g.top + g.hexH / 2 + i * g.step;
  return {
    left, cx, cy,
    infoY: cy - g.infoH / 2,
    fieldY: cy - g.fieldH / 2,
    info: left ? { x: g.pad, w: cx - g.pad } : { x: cx, w: g.W - g.pad - cx },
    field: left ? { x: cx, w: g.W - g.pad - cx } : { x: g.pad, w: cx - g.pad },
  };
}

function place(el, x, y, w, h) {
  Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
}

const FIRST_DAY = 0.16; // day one is cheated forward so it clearly reads as progress

// The first slice of every lane sits behind the hex, so it never counts as progress.
const hiddenFor = (fieldW) => Math.min(0.5, (geo.hexW * 0.5 + 6) / fieldW);

function extentFor(s, fieldW) {
  if (s <= 0) return 0;  // nothing kept yet: bare lane
  if (s >= GOAL) return 1;
  const hidden = hiddenFor(fieldW);
  const t = FIRST_DAY + (1 - FIRST_DAY) * ((s - 1) / (GOAL - 1));
  return hidden + (1 - hidden) * t;
}

// ---------- building ----------

const HEX_HTML = `<span class="rim"></span><span class="core"></span>
<svg class="ck" viewBox="0 0 24 24" aria-hidden="true"><path class="ghost" d="M6.5 12.6l3.6 3.6 7.4-8.3"/><path class="ink" d="M6.5 12.6l3.6 3.6 7.4-8.3"/></svg>
<span class="count"></span>`;
const ADD_HTML = `<span class="rim"></span><span class="core"></span>
<svg class="plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

function makeInfo(r, cls) {
  const info = document.createElement('div');
  info.className = `info ${r.left ? 'L' : 'R'} ${cls || ''}`;
  place(info, r.info.x, r.infoY, r.info.w, geo.infoH);
  info.style.setProperty('--r', Math.min(12, geo.infoH / 2) + 'px');
  info.style.setProperty('--hexpad', geo.hexW / 2 + 8 + 'px');
  info.innerHTML = '<div class="name"></div><div class="trig"></div><div class="goal"></div>';
  return info;
}

function makeHex(r, html, label) {
  const hex = document.createElement('button');
  hex.type = 'button';
  hex.className = 'hex';
  hex.innerHTML = html;
  hex.setAttribute('aria-label', label);
  place(hex, r.cx - geo.hexW / 2, r.cy - geo.hexH / 2, geo.hexW, geo.hexH);
  return hex;
}

function makeRow(h, i) {
  const r = rowGeo(i);
  const row = document.createElement('div');
  row.className = 'row';

  const info = makeInfo(r);
  info.querySelector('.name').textContent = h.name;
  info.querySelector('.trig').textContent = h.trigger || '';
  info.querySelector('.goal').textContent = h.goal || '';

  const cv = document.createElement('canvas');
  cv.className = 'field';
  place(cv, r.field.x, r.fieldY, r.field.w, geo.fieldH);

  const hex = makeHex(r, HEX_HTML, h.name);
  row.append(cv, info, hex);
  col.appendChild(row);

  const e = { h, row, info, hex, cv, fieldW: r.field.w, mirror: !r.left };
  const s = streakOf(h);
  if (fields.ok) {
    fields.attach(h.id, cv, {
      w: r.field.w, h: geo.fieldH, mirror: !r.left, radius: geo.radius,
      originY: 0.5, // the lane is centred on the hex
      hidden: hiddenFor(r.field.w),
      extent: extentFor(s, r.field.w),
    });
  } else {
    cv.classList.add('fallback');
    cv.classList.toggle('flip', !r.left);
  }

  hex.addEventListener('click', () => onHex(e));
  info.addEventListener('click', () => openEditor(h));
  cv.addEventListener('click', (ev) => {
    const b = cv.getBoundingClientRect();
    fields.ripple(h.id, 0.7, { x: ev.clientX - b.left, y: ev.clientY - b.top });
  });
  return e;
}

function makeAddRow(i) {
  const r = rowGeo(i);
  const row = document.createElement('div');
  row.className = 'row';
  const info = makeInfo(r, 'add');
  info.querySelector('.name').textContent = 'New habit';
  info.querySelector('.goal').textContent = live().length ? '' : `Keep it for ${GOAL} days`;
  const hex = makeHex(r, ADD_HTML, 'Add a habit');
  hex.classList.add('add');
  row.append(info, hex);
  col.appendChild(row);
  hex.addEventListener('click', () => { fx.pop(hex); openEditor(null); });
  info.addEventListener('click', () => openEditor(null));
  return row;
}

function build() {
  geo = computeGeo();
  col.style.width = geo.W + 'px';
  col.replaceChildren();
  rows = live().map((h, i) => makeRow(h, i));
  makeAddRow(rows.length);
  const last = rowGeo(rows.length);
  col.style.height = last.cy + geo.hexH / 2 + 40 + 'px';
  fields.prune(new Set(live().map((h) => h.id)));
  rows.forEach((e) => refresh(e, true));
  updateHeader();
}

function refresh(e, immediate = false) {
  const { h, hex, cv } = e;
  const s = streakOf(h);
  const done = doneToday(h);
  const mastered = s >= GOAL;
  hex.classList.toggle('done', done);
  hex.classList.toggle('mastered', mastered);
  hex.setAttribute('aria-pressed', String(done));
  hex.setAttribute('aria-label', `${h.name}: ${done ? 'done today' : 'not done yet today'}, day ${s} of ${GOAL}`);
  hex.querySelector('.count').innerHTML = `${s}<i>/${GOAL}</i>`;
  const ext = extentFor(s, e.fieldW);
  if (fields.ok) fields.setTarget(h.id, ext, mastered ? 1 : 0, immediate);
  else cv.style.setProperty('--ext', ext * 100 + '%');
}

function updateHeader() {
  const d = new Date();
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const n = live().length;
  const done = live().filter(doneToday).length;
  $('#today').textContent = n ? `${date} · ${done}/${n}` : date;
}

// ---------- the tap ----------

function onHex(e) {
  const { h, hex, info } = e;
  const t = todayKey();
  const was = doneToday(h);
  h.log[t] = { d: was ? 0 : 1, t: Date.now() };
  save();
  queueSync();

  const s = streakOf(h);
  const b = hex.getBoundingClientRect();
  const x = b.left + b.width / 2, y = b.top + b.height / 2;
  fx.haptic();

  if (!was) {
    const mastered = s === GOAL;
    fx.pop(hex);
    fx.wave(rows.map((r) => r.hex), rows.indexOf(e));
    fx.burst(x, y, mastered ? { power: 1.8, count: 60 } : {});
    if (mastered) {
      fx.fanfare(state.sound);
      setTimeout(() => fx.burst(x, y, { power: 2.5, count: 40 }), 260);
      setTimeout(() => fields.ripple(h.id, 1.2), 350);
    } else {
      fx.chime(s, state.sound);
    }
    fields.ripple(h.id, mastered ? 1.6 : 1);
    info.classList.remove('shine');
    void info.offsetWidth; // restart the animation
    info.classList.add('shine');
  } else {
    fx.unpop(hex);
    fx.unchime(state.sound);
    fields.ripple(h.id, -0.8);
  }
  refresh(e);
  updateHeader();
}

// ---------- sheets ----------

const scrim = $('#scrim');
const editSheet = $('#editSheet');
const menuSheet = $('#menuSheet');
const form = $('#habitForm');
const fName = $('#fName'), fTrig = $('#fTrig'), fGoal = $('#fGoal');
const delBtn = $('#delBtn');
let openEl = null;
let editingId = null;

function openSheet(el) {
  openEl = el;
  el.classList.add('on');
  el.setAttribute('aria-hidden', 'false');
  scrim.classList.add('on');
}
function closeSheet() {
  if (!openEl) return;
  openEl.classList.remove('on');
  openEl.setAttribute('aria-hidden', 'true');
  scrim.classList.remove('on');
  document.activeElement?.blur?.();
  openEl = null;
}
scrim.addEventListener('click', closeSheet);

function openEditor(h) {
  editingId = h ? h.id : null;
  $('#sheetTitle').textContent = h ? 'Edit habit' : 'New habit';
  fName.value = h?.name ?? '';
  fTrig.value = h?.trigger ?? '';
  fGoal.value = h?.goal ?? '';
  delBtn.hidden = !h;
  disarm();
  openSheet(editSheet);
  if (!h) fName.focus({ preventScroll: true });
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = fName.value.trim();
  if (!name) { fx.shake(fName); return; }
  const data = { name, trigger: fTrig.value.trim(), goal: fGoal.value.trim(), updated: Date.now() };
  let newId = null;
  const existing = editingId && state.habits.find((h) => h.id === editingId);
  if (existing) Object.assign(existing, data);
  else {
    newId = uid();
    state.habits.push({ id: newId, ...data, created: todayKey(), log: {} });
  }
  save();
  queueSync();
  closeSheet();
  build();
  if (newId) {
    const e = rows.find((r) => r.h.id === newId);
    if (e) {
      fx.appear([e.hex, e.info, e.cv]);
      setTimeout(() => fields.ripple(newId, 0.9), 300);
      e.hex.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
});

let armTimer = 0;
function disarm() {
  clearTimeout(armTimer);
  delBtn.classList.remove('armed');
  delBtn.textContent = 'Delete';
}
delBtn.addEventListener('click', () => {
  if (!delBtn.classList.contains('armed')) {
    delBtn.classList.add('armed');
    delBtn.textContent = 'Tap again to delete';
    armTimer = setTimeout(disarm, 3000);
    return;
  }
  // Tombstone rather than splice, so the delete reaches other devices.
  const h = state.habits.find((x) => x.id === editingId);
  if (h) { h.deleted = Date.now(); h.updated = Date.now(); }
  save();
  queueSync();
  closeSheet();
  build();
});

// menu
const soundBtn = $('#soundBtn');
const syncSound = () => { soundBtn.textContent = `Sound: ${state.sound ? 'on' : 'off'}`; };
syncSound();
$('#menuBtn').addEventListener('click', () => openSheet(menuSheet));
soundBtn.addEventListener('click', () => {
  state.sound = !state.sound;
  save();
  syncSound();
  fx.chime(5, state.sound);
});

$('#exportBtn').addEventListener('click', async () => {
  const name = `murmur-${todayKey()}.json`;
  const text = JSON.stringify(state, null, 2);
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

const importFile = $('#importFile');
$('#importBtn').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const f = importFile.files?.[0];
  importFile.value = '';
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!s || !Array.isArray(s.habits)) throw new Error('bad file');
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const habits = s.habits
      .filter((h) => h && typeof h.name === 'string')
      .map((h) => {
        const log = {};
        for (const d of Array.isArray(h.days) ? h.days : []) if (day.test(d)) log[d] = { d: 1, t: 0 };
        for (const [d, m] of Object.entries(h.log || {})) {
          if (day.test(d)) log[d] = { d: m?.d ? 1 : 0, t: Number(m?.t) || 0 };
        }
        return {
          id: String(h.id || uid()),
          name: h.name.slice(0, 40),
          trigger: String(h.trigger || '').slice(0, 60),
          goal: String(h.goal || '').slice(0, 80),
          created: String(h.created || todayKey()),
          updated: Number(h.updated) || Date.now(),
          log,
        };
      });
    if (!confirm(`Replace your current habits with ${habits.filter((h) => !h.deleted).length} from this backup?`)) return;
    state = { ...state, habits };
    save();
    queueSync();
    closeSheet();
    build();
  } catch {
    alert("That file doesn't look like a Murmur backup.");
  }
});

// ---------- sync ----------

const syncBlock = $('#syncBlock');
const syncStatus = $('#syncStatus');
const syncForm = $('#syncForm');
const syncEmail = $('#syncEmail');
const signOutBtn = $('#signOutBtn');
let syncTimer = 0, syncing = false, syncNote = '';

function showSync() {
  if (!sync.configured()) { syncBlock.hidden = true; return; }
  syncBlock.hidden = false;
  const on = sync.signedIn();
  syncForm.hidden = on;
  signOutBtn.hidden = !on;
  syncStatus.textContent = syncNote || (on ? `Syncing as ${sync.account() ?? 'signed in'}` : 'Sync is off. Your habits stay on this device.');
}

/** Debounced: a tap writes locally straight away, the network catches up. */
function queueSync(delay = 1200) {
  if (!sync.signedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  if (!sync.signedIn() || syncing) return;
  syncing = true;
  try {
    const changed = await sync.sync(state);
    save();
    if (changed) build();
    syncNote = '';
  } catch (err) {
    syncNote = navigator.onLine ? `Sync failed: ${String(err.message).slice(0, 60)}` : 'Offline. Will sync later.';
  } finally {
    syncing = false;
    showSync();
  }
}

sync.onChange((s) => {
  if (s.error) syncNote = s.error;
  if (s.signedOut) syncNote = '';
  showSync();
});

syncForm?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const address = syncEmail.value.trim();
  if (!address) { fx.shake(syncEmail); return; }
  syncNote = 'Sending…';
  showSync();
  try {
    await sync.sendLink(address);
    syncNote = `Check ${address} for a sign-in link.`;
  } catch (err) {
    syncNote = String(err.message).slice(0, 80);
  }
  showSync();
});

signOutBtn?.addEventListener('click', () => {
  sync.signOut();
  showSync();
});

sync.init();
showSync();
if (sync.signedIn()) syncNow();

addEventListener('online', () => queueSync(300));

// ---------- lifecycle ----------

let dayKey = todayKey();
function checkDay() {
  if (todayKey() === dayKey) return;
  dayKey = todayKey();
  rows.forEach((e) => refresh(e));
  updateHeader();
}
setInterval(checkDay, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { fields.stop(); queueSync(0); }
  else { checkDay(); fields.start(); queueSync(400); }
});

let lastW = innerWidth, resizeT = 0;
addEventListener('resize', () => {
  if (Math.abs(innerWidth - lastW) < 2) return;
  lastW = innerWidth;
  clearTimeout(resizeT);
  resizeT = setTimeout(build, 150);
});

document.addEventListener('touchstart', () => {}, { passive: true }); // enables :active on iOS

build();

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !local) navigator.serviceWorker.register('sw.js');
if (local) window.__murmur = { fields }; // dev handle for poking the sims from the console
