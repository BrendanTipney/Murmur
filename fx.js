// Juice: particle shards, shock rings, element springs, sound, haptics.

const cv = document.getElementById('fx');
const ctx = cv.getContext('2d');
let dpr = 1;
let parts = [];
let rings = [];
let running = false;
let last = 0;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
}
resize();
addEventListener('resize', resize);

// pastel thin-film colour, t in turns
function film(t, a) {
  const c = (o) => Math.round(165 + 90 * (0.5 + 0.5 * Math.cos(6.283 * (t + o))));
  return `rgba(${c(0)},${c(0.33)},${c(0.67)},${a})`;
}

function hexPath(x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * Math.PI) / 3;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

export function burst(x, y, { power = 1, count = 24 } = {}) {
  const hue = Math.random();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (120 + Math.random() * 280) * power;
    parts.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 60 * power,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 16,
      s: 2 + Math.random() * 4 * Math.sqrt(power),
      life: 0,
      max: 0.5 + Math.random() * 0.55 * power,
      hue: hue + Math.random() * 0.35,
      white: Math.random() < 0.35,
      hex: Math.random() < 0.65,
    });
  }
  rings.push({ x, y, life: 0, max: 0.55 + 0.15 * power, r0: 26, r1: 95 * power, hue });
  kick();
}

function kick() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(tick);
}

function tick(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.globalCompositeOperation = 'lighter';

  for (const r of rings) {
    r.life += dt;
    const t = Math.min(1, r.life / r.max);
    const e = 1 - Math.pow(1 - t, 3);
    const rad = r.r0 + (r.r1 - r.r0) * e;
    const a = (1 - t) * 0.55;
    ctx.lineWidth = 0.6 + (1 - t) * 4;
    for (let k = 0; k < 3; k++) {       // three offset rings = chromatic, iridescent edge
      ctx.strokeStyle = film(r.hue + k * 0.33 + t * 0.4, a);
      hexPath(r.x, r.y, rad + k * 2.5 * (1 - t) + k, 0);
      ctx.stroke();
    }
  }
  rings = rings.filter((r) => r.life < r.max);

  for (const p of parts) {
    p.life += dt;
    const drag = 1 - 2.4 * dt;
    p.vx *= drag;
    p.vy = p.vy * drag + 480 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const t = p.life / p.max;
    const a = Math.max(0, 1 - t * t);
    const s = p.s * (1 - 0.5 * t);
    ctx.fillStyle = p.white ? `rgba(255,255,255,${a * 0.9})` : film(p.hue + t * 0.6, a);
    if (p.hex) { hexPath(p.x, p.y, s, p.rot); ctx.fill(); }
    else { ctx.beginPath(); ctx.ellipse(p.x, p.y, s * 1.4, s * 0.45, p.rot, 0, 6.283); ctx.fill(); }
  }
  parts = parts.filter((p) => p.life < p.max);

  ctx.globalCompositeOperation = 'source-over';
  if (parts.length || rings.length) requestAnimationFrame(tick);
  else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}

// ---------- element springs ----------

export function pop(el) {
  el.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(0.8) rotate(-5deg)', offset: 0.16 },
    { transform: 'scale(1.16) rotate(2deg)', offset: 0.42 },
    { transform: 'scale(0.96) rotate(-0.5deg)', offset: 0.68 },
    { transform: 'scale(1.01)', offset: 0.86 },
    { transform: 'scale(1)' },
  ], { duration: 680, easing: 'cubic-bezier(.25,.7,.3,1)' });
}

export function unpop(el) {
  el.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(0.9)', offset: 0.3 },
    { transform: 'scale(1.03)', offset: 0.7 },
    { transform: 'scale(1)' },
  ], { duration: 420, easing: 'ease-out' });
}

/** Neighbouring hexes bump in sequence, like a flock turning. */
export function wave(els, idx) {
  els.forEach((el, i) => {
    const d = Math.abs(i - idx);
    if (!d) return;
    const amp = 0.08 / (1 + d * 0.9);
    if (amp < 0.008) return;
    el.animate([
      { transform: 'scale(1)' },
      { transform: `scale(${1 + amp}) rotate(${(i < idx ? -1 : 1) * amp * 25}deg)`, offset: 0.35 },
      { transform: 'scale(1)' },
    ], { duration: 460, delay: 60 + d * 70, easing: 'ease-out' });
  });
}

export function appear(els) {
  els.forEach((el, i) => el.animate([
    { opacity: 0, transform: 'scale(0.6)' },
    { opacity: 1, transform: 'scale(1.06)', offset: 0.6 },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: 520, delay: i * 60, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }));
}

export function shake(el) {
  el.animate([
    { transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' },
    { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' },
  ], { duration: 320 });
}

// ---------- haptics ----------

export function haptic() {
  // iOS 18+: toggling a switch input produces a light system haptic.
  try { document.getElementById('haptic').click(); } catch {}
  try { navigator.vibrate?.(12); } catch {}
}

// ---------- sound ----------

let ac = null;
let out = null;

function audio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    out = ac.createGain();
    out.gain.value = 0.55;
    out.connect(comp);
    comp.connect(ac.destination);
  }
  if (ac.state !== 'running') ac.resume();
  return ac;
}

function bell(freq, when = 0, gain = 0.18, decay = 1.3) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + when;
  const partials = [[1, 1, decay], [2.76, 0.28, decay * 0.4], [5.4, 0.08, decay * 0.18], [0.5, 0.12, decay * 0.8]];
  for (const [mult, g, dec] of partials) {
    const o = a.createOscillator();
    const env = a.createGain();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain * g, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(env);
    env.connect(out);
    o.start(t);
    o.stop(t + dec + 0.05);
  }
}

const SCALE = [0, 2, 4, 7, 9];
function noteFor(i) {
  i = Math.max(0, Math.min(14, i));
  return 523.25 * Math.pow(2, (SCALE[i % 5] + 12 * Math.floor(i / 5)) / 12);
}

/** Pitch climbs with the streak, so each day sounds a little brighter. */
export function chime(streak, on) {
  if (!on) return;
  const f = noteFor(Math.floor((streak - 1) / 2));
  bell(f, 0, 0.2);
  bell(f * 1.5, 0.07, 0.07, 0.8);
}

export function unchime(on) {
  if (!on) return;
  bell(261.6, 0, 0.1, 0.5);
  bell(196, 0.08, 0.08, 0.6);
}

export function fanfare(on) {
  if (!on) return;
  [0, 2, 4, 5, 7, 10].forEach((n, i) => bell(noteFor(n), i * 0.075, 0.16, 1.6));
}
