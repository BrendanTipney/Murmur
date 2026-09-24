// Gray-Scott reaction-diffusion "fields" — one simulation per habit, all driven
// by a single shared WebGL2 context. Each frame a field steps its sim, renders
// into the shared canvas, then gets copied into that habit's own 2D canvas.
//
// Sim texture channels: r = U (substrate), g = V (pattern), b = activity
// (recent |dV|, which the display shader turns into the iridescent wave).

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SIM_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uS;
uniform vec2 uTexel;
uniform vec2 uSize;
uniform float uF, uK;
uniform float uExtent;    // 0..1 along x: how far the pattern may live
uniform float uHidden;    // the stretch tucked behind the hex
uniform vec4 uRipR;       // ripple radii in cells (<0 = inactive)
uniform vec4 uRipA;       // ripple amplitudes (+ feeds V, - starves it)
uniform vec2 uRipO[4];    // ripple origins in cells

void main() {
  vec4 c = texture(uS, vUv);
  vec2 lap = -c.rg;
  lap += 0.2 * (texture(uS, vUv + vec2(uTexel.x, 0.0)).rg + texture(uS, vUv - vec2(uTexel.x, 0.0)).rg
              + texture(uS, vUv + vec2(0.0, uTexel.y)).rg + texture(uS, vUv - vec2(0.0, uTexel.y)).rg);
  lap += 0.05 * (texture(uS, vUv + uTexel).rg + texture(uS, vUv - uTexel).rg
               + texture(uS, vUv + vec2(uTexel.x, -uTexel.y)).rg + texture(uS, vUv + vec2(-uTexel.x, uTexel.y)).rg);

  float u = c.r, v = c.g;
  // The frontier is a ramp, not a wall: the kill rate climbs across the last
  // stretch so the pattern thins out toward the leading edge.
  // ...and once the lane is full the frontier firms up again
  float ramp = clamp((uExtent - uHidden) * 0.3, 0.02, 0.1) * (1.0 - 0.85 * smoothstep(0.97, 1.0, uExtent));
  float outside = smoothstep(uExtent - ramp, uExtent + 0.02, vUv.x);

  // Ripples perturb the chemistry itself; the reaction does the rest.
  vec2 p = vUv * uSize;
  float feed = 0.0, starve = 0.0;
  for (int i = 0; i < 4; i++) {
    float r = uRipR[i];
    if (r >= 0.0) {
      float d = distance(p, uRipO[i]) - r;
      // sharp leading edge, longer trailing wake
      float b = d / (d > 0.0 ? 2.5 : 6.0);
      float band = exp(-b * b) * uRipA[i];
      feed += max(band, 0.0);
      starve += max(-band, 0.0);
    }
  }
  feed = min(feed, 1.5) * (1.0 - outside);
  starve = min(starve, 1.5);

  // The front is a pulse of feed: F climbs steeply, kill dips, and the diffusion
  // rates diverge (V slows right down relative to U), sharpening the Turing
  // instability so spots bud and split and stripes wrinkle and branch.
  float Fr = uF + feed * 0.022;
  float k = uK + outside * 0.07 - feed * 0.008 + starve * 0.005;
  float Dv = 0.5 - feed * 0.28;
  float uvv = u * v * v;
  float du = lap.x - uvv + Fr * (1.0 - u);
  float dv = Dv * lap.y + uvv - (Fr + k) * v;

  // Feed alone cannot start anything on bare ground: V = 0 is a stable state, so
  // there has to be a spark. Sample a ring to find ground that is genuinely open
  // (not just the gap between two spots) and nucleate there, unevenly, so the
  // front leaves seeds that grow into pattern rather than a flat sheet of V.
  float r6 = 6.0;
  float around = max(
    max(texture(uS, vUv + vec2(r6, 0.0) * uTexel).g, texture(uS, vUv - vec2(r6, 0.0) * uTexel).g),
    max(texture(uS, vUv + vec2(0.0, r6) * uTexel).g, texture(uS, vUv - vec2(0.0, r6) * uTexel).g));
  float open = 1.0 - smoothstep(0.02, 0.12, max(around, v));
  // Blobs, not speckle: a seed only a cell or two across diffuses away before it
  // can sustain itself, so nucleate in 5-cell blocks like the initial seeding.
  float grain = fract(sin(dot(floor(p / 5.0), vec2(12.9898, 78.233))) * 43758.5453);
  float spark = feed * open * step(0.7, grain);

  float nu = clamp(u + du, 0.0, 1.0);
  float nv = clamp(v + dv, 0.0, 1.0);
  // Below roughly F + k a seed just decays away, so the front deposits catalyst
  // at a level that survives instead of dribbling it in.
  // A seed has to beat (F + k) / u to survive, so deposit a fixed viable level
  // wherever the front sparks rather than a level proportional to it, and leave
  // U high — starving the substrate at the same time is what killed earlier tries.
  float on = step(0.12, spark);
  nv = max(nv, on * 0.45);
  nu = min(nu, 1.0 - on * 0.25);
  float act = max(c.b * 0.975, min(1.0, abs(nv - v) * 45.0));
  o = vec4(nu, nv, act, 1.0);
}`;

const DISP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uS;
uniform vec2 uTexel, uPx;
uniform float uMirror, uTime, uExtent, uMaster, uPhase, uRadius, uDpr, uHidden;

vec3 iri(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  float sx = mix(vUv.x, 1.0 - vUv.x, uMirror);   // sim x: 0 at the hex
  vec2 su = vec2(sx, vUv.y);
  vec4 s = texture(uS, su);
  float v = s.g;
  float gx = texture(uS, su + vec2(uTexel.x, 0.0)).g - texture(uS, su - vec2(uTexel.x, 0.0)).g;
  float gy = texture(uS, su + vec2(0.0, uTexel.y)).g - texture(uS, su - vec2(0.0, uTexel.y)).g;
  gx *= 1.0 - 2.0 * uMirror;
  float act = s.b;
  // active regions read as a swelling surface: steeper normals, stronger sheen
  vec3 n = normalize(vec3(-gx * 5.0 * (1.0 + 2.0 * act), -gy * 5.0 * (1.0 + 2.0 * act), 1.0));

  float fade = clamp((uExtent - uHidden) * 0.35, 0.03, 0.12) * (1.0 - 0.85 * uMaster);
  float ink = smoothstep(0.11, 0.27, v) * smoothstep(uExtent + 0.02, uExtent - fade, sx);

  // thin-film hue: shifts with surface slope, position, time and activity
  float h = dot(n.xy, vec2(0.6, 0.4)) + vUv.x * 0.3 + vUv.y * 0.1 + uTime * 0.035 + uPhase + act * 0.5;
  vec3 film = iri(h);
  vec3 L = normalize(vec3(cos(uTime * 0.25) * 0.6, 0.5, 0.75));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 28.0);
  float slope = clamp(1.0 - n.z, 0.0, 1.0);

  vec3 pearl = vec3(0.93, 0.925, 0.915) * (0.8 + 0.2 * diff);
  float irAmt = clamp(0.08 + slope * 3.0, 0.0, 1.0) * mix(0.4, 0.95, uMaster);
  vec3 lit = mix(pearl, pearl * (0.5 + 0.65 * film), irAmt);
  lit += spec * 0.25 * (0.6 + 0.4 * film);

  float reached = smoothstep(uExtent + 0.02, uExtent - fade, sx);
  vec3 bg = mix(vec3(0.035, 0.035, 0.04), vec3(0.058, 0.058, 0.066), reached);
  vec3 col = mix(bg, lit, ink);

  // the wave: activity tints the pearl and glows softly in the dark
  vec3 glow = iri(h + 0.5 + act * 0.4);
  col = mix(col, col * (0.45 + 0.9 * glow), min(1.0, act * 1.2) * ink);
  col += glow * act * 0.5 * (1.0 - ink);

  // panel shape: square under the hex, rounded at the far end
  vec2 px = vec2(sx * uPx.x, vUv.y * uPx.y);
  float d = sdBox(px - vec2(-uDpr, uPx.y * 0.5), vec2(uPx.x, uPx.y * 0.5 - uDpr), uRadius * uDpr);
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.0, 1.2 * uDpr, abs(d + 0.6 * uDpr));
  col = mix(col, vec3(0.15) + film * 0.1, edge * 0.7 * (1.0 - ink));

  o = vec4(col * alpha, alpha);
}`;

// The chemistry itself is the progress bar: a path through Gray-Scott space from
// starved (sparse dots) to fed (dense, joined-up pattern). Habits differ by their
// seed and hue, not by regime, so two habits at the same level look related.
const PATH = [
  { t: 0.00, F: 0.052, k: 0.0665 }, // barely alive: scattered dots
  { t: 0.25, F: 0.052, k: 0.0645 }, // dots multiply
  { t: 0.50, F: 0.0545, k: 0.062 }, // coral: dots joining up
  { t: 0.75, F: 0.045, k: 0.0595 }, // labyrinth
  { t: 1.00, F: 0.0458, k: 0.0588 }, // dense: ~85% covered, dark veins left for contrast
];

export function paramsAt(level) {
  const t = Math.max(0, Math.min(1, level));
  let i = 1;
  while (i < PATH.length - 1 && PATH[i].t < t) i++;
  const a = PATH[i - 1], b = PATH[i];
  const u = (t - a.t) / (b.t - a.t);
  return { F: a.F + (b.F - a.F) * u, k: a.k + (b.k - a.k) * u };
}
const SIM_SCALE = 1.25;     // sim cells per CSS pixel: higher means finer detail
const RIPPLE_SPEED = 0.3;   // cells per step

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

export class FieldSystem {
  constructor() {
    this.fields = new Map();
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 1;
    this.ok = false;
    this.time = 0;
    this.last = 0;
    this.running = false;
    this._R = new Float32Array(4);
    this._A = new Float32Array(4);
    this._O = new Float32Array(8);
    this._frame = (t) => this.frame(t);
    this.io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => { for (const e of es) if (e.target.__field) e.target.__field.visible = e.isIntersecting; }, { rootMargin: '60px' })
      : null;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.initGL();
      for (const f of this.fields.values()) { f.tex = null; this.alloc(f); }
    });
    this.initGL();
  }

  initGL() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, preserveDrawingBuffer: true,
    });
    this.gl = gl;
    if (!gl) return;
    gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    try {
      this.sim = program(gl, SIM_FS);
      this.disp = program(gl, DISP_FS);
    } catch (err) {
      console.warn('Murmur: shader error', err);
      return;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Probe: can we render to half-float textures?
    const t = this.makeTex(4, 4, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    this.ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(t);
  }

  makeTex(w, h, data) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Bind a habit's field to a (possibly new) canvas. opts: {w, h, mirror, radius, extent} */
  attach(id, canvas, o) {
    let f = this.fields.get(id);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!f) {
      const hs = hash(id);
      f = {
        id, hs,
        phase: ((hs >>> 8) % 1000) / 1000,
        extent: o.extent, target: o.extent,
        level: o.level, levelTarget: o.level,
        master: 0, masterTarget: 0,
        ripples: [], busyUntil: 0, cur: 0,
      };
      this.fields.set(id, f);
    }
    if (f.canvas && this.io) this.io.unobserve(f.canvas);
    f.canvas = canvas;
    f.pw = Math.max(1, Math.round(o.w * dpr));
    f.ph = Math.max(1, Math.round(o.h * dpr));
    canvas.width = f.pw;
    canvas.height = f.ph;
    f.ctx = canvas.getContext('2d');
    f.dpr = dpr;
    f.mirror = o.mirror;
    f.radius = o.radius;
    f.originY = o.originY ?? 0.5;
    f.hidden = o.hidden ?? 0;
    f.visible = true;
    canvas.__field = f;
    this.io?.observe(canvas);

    const sw = Math.max(8, Math.round(o.w * SIM_SCALE));
    const sh = Math.max(8, Math.round(o.h * SIM_SCALE));
    if (this.ok && (f.sw !== sw || f.sh !== sh || !f.tex)) {
      f.sw = sw;
      f.sh = sh;
      this.alloc(f);
    }
    this.fitCanvas();
    this.start();
    return f;
  }

  alloc(f) {
    if (!this.ok) return;
    const gl = this.gl;
    if (f.tex) { f.tex.forEach((t) => gl.deleteTexture(t)); f.fb.forEach((b) => gl.deleteFramebuffer(b)); }
    const { sw, sh } = f;
    const r = rng(f.hs);
    const d = new Float32Array(sw * sh * 4);
    for (let i = 0; i < sw * sh; i++) d[i * 4] = 1;
    // Blocky noise over the reached region: ~25% of 4x4 blocks start "on".
    // A habit with no progress seeds nothing, so its lane stays bare.
    const lim = f.target > 0 ? Math.max(8, Math.floor(f.target * sw)) : 0;
    const bw = Math.ceil(sw / 4);
    const blocks = Array.from({ length: bw * Math.ceil(sh / 4) }, () => r() < 0.25);
    for (let y = 0; y < sh; y++) for (let x = 0; x < lim; x++) {
      if (!blocks[(y >> 2) * bw + (x >> 2)]) continue;
      const i = (y * sw + x) * 4;
      d[i] = 0.5; d[i + 1] = 0.25 + r() * 0.05;
    }

    f.tex = [this.makeTex(sw, sh, d), this.makeTex(sw, sh, null)];
    f.fb = f.tex.map((t) => {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return fb;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    f.cur = 0;
    f.extent = f.target;
    this.step(f, 700); // warm up so the pattern exists on first paint
  }

  fitCanvas() {
    let w = 1, h = 1;
    for (const f of this.fields.values()) { w = Math.max(w, f.pw || 1); h = Math.max(h, f.ph || 1); }
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  prune(keep) {
    for (const [id, f] of this.fields) {
      if (keep.has(id)) continue;
      if (this.ok && f.tex) { f.tex.forEach((t) => this.gl.deleteTexture(t)); f.fb.forEach((b) => this.gl.deleteFramebuffer(b)); }
      this.io?.unobserve(f.canvas);
      this.fields.delete(id);
    }
  }

  setTarget(id, extent, level, master, immediate) {
    const f = this.fields.get(id);
    if (!f) return;
    f.target = extent;
    f.levelTarget = level;
    f.masterTarget = master;
    if (immediate) { f.extent = extent; f.level = level; f.master = master; }
  }

  /** Send a wave out from the hex (or from a poke point in canvas CSS px). */
  ripple(id, amp, at) {
    const f = this.fields.get(id);
    if (!f || !f.sw) return;
    let ox = 0, oy = f.sh * (1 - f.originY);
    if (at) {
      const w = f.pw / f.dpr, h = f.ph / f.dpr;
      const fx = at.x / w;
      ox = (f.mirror ? 1 - fx : fx) * f.sw;
      oy = (1 - at.y / h) * f.sh;
    }
    const far = Math.hypot(Math.max(ox, f.sw - ox), Math.max(oy, f.sh - oy)) + 14;
    f.ripples.push({ r: 0, amp, ox, oy, max: at ? Math.min(far, 28) : far });
    if (f.ripples.length > 4) f.ripples.shift();
    f.busyUntil = this.time + 2.5;
  }

  step(f, n) {
    const gl = this.gl, { p, u } = this.sim;
    gl.useProgram(p);
    gl.viewport(0, 0, f.sw, f.sh);
    gl.uniform2f(u.uTexel, 1 / f.sw, 1 / f.sh);
    gl.uniform2f(u.uSize, f.sw, f.sh);
    const chem = paramsAt(f.level);
    gl.uniform1f(u.uF, chem.F + 0.0005 * Math.sin(this.time * 0.23 + f.phase * 6.283));
    gl.uniform1f(u.uK, chem.k);
    gl.uniform1f(u.uExtent, f.extent);
    gl.uniform1f(u.uHidden, f.hidden);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.uS, 0);
    const R = this._R, A = this._A, O = this._O;
    for (let s = 0; s < n; s++) {
      R.fill(-1); A.fill(0);
      for (let i = 0; i < f.ripples.length; i++) {
        const rp = f.ripples[i];
        R[i] = rp.r; A[i] = rp.amp; O[i * 2] = rp.ox; O[i * 2 + 1] = rp.oy;
        rp.r += RIPPLE_SPEED;
      }
      gl.uniform4fv(u.uRipR, R);
      gl.uniform4fv(u.uRipA, A);
      gl.uniform2fv(u.uRipO, O);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb[1 - f.cur]);
      gl.bindTexture(gl.TEXTURE_2D, f.tex[f.cur]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      f.cur = 1 - f.cur;
    }
    if (f.ripples.length) f.ripples = f.ripples.filter((rp) => rp.r < rp.max);
  }

  draw(f) {
    const gl = this.gl, { p, u } = this.disp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, f.pw, f.ph);
    gl.useProgram(p);
    gl.uniform2f(u.uTexel, 1 / f.sw, 1 / f.sh);
    gl.uniform2f(u.uPx, f.pw, f.ph);
    gl.uniform1f(u.uMirror, f.mirror ? 1 : 0);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uExtent, f.extent);
    gl.uniform1f(u.uMaster, f.master);
    gl.uniform1f(u.uHidden, f.hidden);
    gl.uniform1f(u.uPhase, f.phase);
    gl.uniform1f(u.uRadius, f.radius);
    gl.uniform1f(u.uDpr, f.dpr);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.tex[f.cur]);
    gl.uniform1i(u.uS, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    f.ctx.clearRect(0, 0, f.pw, f.ph);
    f.ctx.drawImage(this.canvas, 0, this.canvas.height - f.ph, f.pw, f.ph, 0, 0, f.pw, f.ph);
  }

  start() {
    if (this.running || !this.ok) return;
    this.running = true;
    this.last = 0;
    requestAnimationFrame(this._frame);
  }
  stop() { this.running = false; }

  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.time += dt;
    if (!this.ok) return;
    for (const f of this.fields.values()) {
      if (!f.tex || !f.visible || !f.canvas.isConnected) continue;
      // Open new ground quickly so it is ready when the wave front arrives;
      // give it back slowly, so a missed day reads as a gentle retreat.
      f.extent += (f.target - f.extent) * Math.min(1, dt * (f.target > f.extent ? 7 : 1.2));
      f.level += (f.levelTarget - f.level) * Math.min(1, dt * 0.8);
      f.master += (f.masterTarget - f.master) * Math.min(1, dt * 1.5);
      const busy = f.ripples.length || this.time < f.busyUntil
        || Math.abs(f.target - f.extent) > 0.003 || Math.abs(f.levelTarget - f.level) > 0.004;
      this.step(f, busy ? 8 : 2);
      this.draw(f);
    }
  }
}
