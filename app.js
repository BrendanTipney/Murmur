import { FieldSystem } from './field.js';
import * as fx from './fx.js';

const GOAL = 27;
const KEY = 'murmur.v1';
const $ = (s) => document.querySelector(s);

// ---------- storage ----------

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.habits)) return { sound: true, ...s };
  } catch {}
  return { habits: [], sound: true };
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
navigator.storage?.persist?.();

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
  const set = new Set(h.days);
  let k = todayKey();
  if (!set.has(k)) k = prevKey(k);
  let n = 0;
  while (set.has(k)) { n++; k = prevKey(k); }
  return n;
}
const doneToday = (h) => h.days.includes(todayKey());

// ---------- geometry ----------

const col = $('#col');
const fields = new FieldSystem();
let geo = null;
let rows = []; // [{h, row, info, hex, cv, fieldW, mirror}]

function computeGeo() {
  const W = Math.min(window.innerWidth, 520);
  const hexW = Math.round(Math.max(78, Math.min(108, W * 0.22)));
  const hexH = hexW * 0.866;
  const step = hexH * 0.86;       // rows interlock like a loose honeycomb
  return {
    W, hexW, hexH, step,
    off: hexW * 0.6,               // horizontal zig-zag between rows
    ph: step - 5,                  // panel height
    pad: 10,
    top: 10,
    radius: Math.min(14, (step - 5) / 2),
  };
}

function rowGeo(i) {
  const g = geo;
  const left = i % 2 === 0; // hex left of centre: details left, pattern right
  const cx = g.W / 2 + (left ? -g.off / 2 : g.off / 2);
  const cy = g.top + i * g.step + g.hexH / 2;
  return {
    left, cx, cy,
    py: cy - g.ph / 2,
    info: left ? { x: g.pad, w: cx - g.pad } : { x: cx, w: g.W - g.pad - cx },
    field: left ? { x: cx, w: g.W - g.pad - cx } : { x: g.pad, w: cx - g.pad },
  };
}

function place(el, x, y, w, h) {
  Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
}

function extentFor(s, fieldW) {
  if (s >= GOAL) return 1;
  const e0 = Math.min(0.5, (geo.hexW * 0.5 + 8) / fieldW); // a bud just peeking past the hex
  return e0 + (1 - e0) * (s / GOAL);
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
  place(info, r.info.x, r.py, r.info.w, geo.ph);
  info.style.setProperty('--r', geo.radius + 'px');
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
  place(cv, r.field.x, r.py, r.field.w, geo.ph);

  const hex = makeHex(r, HEX_HTML, h.name);
  row.append(cv, info, hex);
  col.appendChild(row);

  const e = { h, row, info, hex, cv, fieldW: r.field.w, mirror: !r.left };
  const s = streakOf(h);
  if (fields.ok) {
    fields.attach(h.id, cv, { w: r.field.w, h: geo.ph, mirror: !r.left, radius: geo.radius, extent: extentFor(s, r.field.w) });
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
  info.querySelector('.goal').textContent = state.habits.length ? '' : `Keep it for ${GOAL} days`;
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
  rows = state.habits.map((h, i) => makeRow(h, i));
  makeAddRow(rows.length);
  const last = rowGeo(rows.length);
  col.style.height = last.cy + geo.hexH / 2 + 40 + 'px';
  fields.prune(new Set(state.habits.map((h) => h.id)));
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
  const n = state.habits.length;
  const done = state.habits.filter(doneToday).length;
  $('#today').textContent = n ? `${date} · ${done}/${n}` : date;
}

// ---------- the tap ----------

function onHex(e) {
  const { h, hex, info } = e;
  const t = todayKey();
  const was = doneToday(h);
  h.days = was ? h.days.filter((d) => d !== t) : [...h.days, t];
  save();

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
  const data = { name, trigger: fTrig.value.trim(), goal: fGoal.value.trim() };
  let newId = null;
  const existing = editingId && state.habits.find((h) => h.id === editingId);
  if (existing) Object.assign(existing, data);
  else {
    newId = uid();
    state.habits.push({ id: newId, ...data, created: todayKey(), days: [] });
  }
  save();
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
  state.habits = state.habits.filter((h) => h.id !== editingId);
  save();
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
    const habits = s.habits
      .filter((h) => h && typeof h.name === 'string')
      .map((h) => ({
        id: String(h.id || uid()),
        name: h.name.slice(0, 40),
        trigger: String(h.trigger || '').slice(0, 60),
        goal: String(h.goal || '').slice(0, 80),
        created: String(h.created || todayKey()),
        days: Array.isArray(h.days) ? h.days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [],
      }));
    if (!confirm(`Replace your current habits with ${habits.length} from this backup?`)) return;
    state = { ...state, habits };
    save();
    closeSheet();
    build();
  } catch {
    alert("That file doesn't look like a Murmur backup.");
  }
});

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
  if (document.hidden) fields.stop();
  else { checkDay(); fields.start(); }
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
