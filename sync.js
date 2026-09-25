// Optional Supabase sync.
//
// Deliberately no SDK: GoTrue and PostgREST are plain HTTP, so this file caches
// offline with the rest of the app and adds nothing to the load. Sign-in is a
// magic link, so there is no password to type on a phone.
//
// The device stays the source of truth. Every sync pushes what we hold and
// merges what comes back, last-write-wins per habit and per day using client
// timestamps. Un-ticking a day writes done=false rather than deleting the row,
// so an undo on one device doesn't get resurrected by another.

import { SUPABASE } from './config.js';

const TOKEN_KEY = 'murmur.session';
let tok = null;
let handoff = null;
const listeners = [];

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/** A session captured in the browser that the installed app can be handed. */
export const handoffCode = () => handoff;
export const clearHandoff = () => { handoff = null; };

/** The current session, in a form another device can adopt. Always available
 *  while signed in, so it can be grabbed whenever it is needed. */
export const transferCode = () => tok?.refresh_token ?? null;

export const configured = () => !!(SUPABASE.url && SUPABASE.anonKey);
export const signedIn = () => !!tok;
export const onChange = (fn) => listeners.push(fn);
const emit = (s) => listeners.forEach((fn) => fn(s));

function payload(jwt) {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}
export const account = () => (tok ? payload(tok.access_token)?.email ?? null : null);
const userId = () => (tok ? payload(tok.access_token)?.sub ?? null : null);

function store() {
  try {
    if (tok) localStorage.setItem(TOKEN_KEY, JSON.stringify(tok));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** Pick up a saved session, or the tokens a magic link just dropped in the URL. */
export function init() {
  if (!configured()) return;
  try { tok = JSON.parse(localStorage.getItem(TOKEN_KEY)) || null; } catch {}
  const hash = new URLSearchParams(location.hash.slice(1));
  const access = hash.get('access_token');
  if (access) {
    tok = { access_token: access, refresh_token: hash.get('refresh_token') };
    store();
    // A link from Mail always lands in the browser, never in the installed app,
    // and the two have separate storage. So when we are not the installed app,
    // offer this session for transfer instead of stranding it here.
    if (!standalone()) handoff = tok.refresh_token;
    history.replaceState(null, '', location.pathname + location.search);
  }
  const err = hash.get('error_description');
  if (err) {
    history.replaceState(null, '', location.pathname + location.search);
    emit({ error: decodeURIComponent(err.replace(/\+/g, ' ')) });
  }
}

/**
 * Verify the six-digit code from the email. This is the path that works for an
 * installed app: a link from Mail always opens in Safari, which has its own
 * storage, so the session would land in the wrong place.
 */
export async function verifyCode(address, token) {
  const attempt = (type) => fetch(`${SUPABASE.url}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, email: address, token: token.trim() }),
  });
  let res = await attempt('email');
  if (!res.ok) res = await attempt('magiclink'); // depending on how the mail was generated
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || body.error_description || 'That code was not accepted');
  }
  const j = await res.json();
  tok = { access_token: j.access_token, refresh_token: j.refresh_token };
  store();
  emit({ signedIn: true });
}

/** Adopt a session handed over from the browser (see handoffCode). */
export async function signInWithTransfer(refreshToken) {
  const res = await fetch(`${SUPABASE.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken.trim() }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || body.error_description || body.error || `Not accepted (${res.status})`);
  }
  const j = await res.json();
  tok = { access_token: j.access_token, refresh_token: j.refresh_token };
  store();
  emit({ signedIn: true });
}

export async function sendLink(address) {
  const redirect = location.origin + location.pathname;
  const res = await fetch(`${SUPABASE.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    headers: { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: address, create_user: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || body.error_description || 'Could not send the link');
  }
}

export function signOut() {
  fetch(`${SUPABASE.url}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${tok?.access_token}` },
  }).catch(() => {});
  tok = null;
  store();
  emit({ signedOut: true });
}

async function refresh() {
  if (!tok?.refresh_token) return false;
  const res = await fetch(`${SUPABASE.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tok.refresh_token }),
  });
  if (!res.ok) { tok = null; store(); emit({ signedOut: true }); return false; }
  const j = await res.json();
  tok = { access_token: j.access_token, refresh_token: j.refresh_token };
  store();
  return true;
}

async function api(path, opts = {}, retry = true) {
  const res = await fetch(`${SUPABASE.url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE.anonKey,
      Authorization: `Bearer ${tok.access_token}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  if (res.status === 401 && retry && (await refresh())) return api(path, opts, false);
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`${res.status} ${text}`.trim());
  // Upserts sent with return=minimal reply 201 with an empty body.
  return text ? JSON.parse(text) : null;
}

function merge(state, remoteHabits, remoteDays) {
  let changed = false;
  const byId = new Map(state.habits.map((h) => [h.id, h]));

  for (const r of remoteHabits) {
    const local = byId.get(r.id);
    const fields = {
      name: r.name,
      trigger: r.trigger || '',
      goal: r.goal || '',
      created: r.created || '',
      updated: r.updated_ms || 0,
    };
    if (!local) {
      const h = { id: r.id, ...fields, log: {} };
      if (r.deleted_ms) h.deleted = r.deleted_ms;
      state.habits.push(h);
      byId.set(h.id, h);
      changed = true;
    } else if ((r.updated_ms || 0) > (local.updated || 0)) {
      Object.assign(local, fields);
      if (r.deleted_ms) local.deleted = r.deleted_ms;
      else delete local.deleted;
      changed = true;
    }
  }

  for (const r of remoteDays) {
    const h = byId.get(r.habit_id);
    if (!h) continue;
    h.log = h.log || {};
    const mine = h.log[r.day];
    if (!mine || (r.updated_ms || 0) > (mine.t || 0)) {
      h.log[r.day] = { d: r.done ? 1 : 0, t: r.updated_ms || 0 };
      changed = true;
    }
  }
  return changed;
}

/** Returns true when the merge changed local state (so the caller can rebuild). */
export async function sync(state) {
  if (!configured() || !tok) return false;
  const user = userId();
  if (!user) return false;

  const [remoteHabits, remoteDays] = await Promise.all([
    api('habits?select=*'),
    api('habit_days?select=*'),
  ]);
  const changed = merge(state, remoteHabits, remoteDays);

  const habits = state.habits.map((h) => ({
    id: h.id,
    user_id: user,
    name: h.name,
    trigger: h.trigger || '',
    goal: h.goal || '',
    created: h.created || '',
    deleted_ms: h.deleted || null,
    updated_ms: h.updated || 0,
  }));
  const days = [];
  for (const h of state.habits) {
    for (const [day, mark] of Object.entries(h.log || {})) {
      days.push({ habit_id: h.id, day, user_id: user, done: !!mark.d, updated_ms: mark.t || 0 });
    }
  }

  const upsert = { headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, method: 'POST' };
  // Habits first: the day rows reference them.
  if (habits.length) await api('habits?on_conflict=id', { ...upsert, body: JSON.stringify(habits) });
  if (days.length) await api('habit_days?on_conflict=habit_id,day', { ...upsert, body: JSON.stringify(days) });
  return changed;
}
