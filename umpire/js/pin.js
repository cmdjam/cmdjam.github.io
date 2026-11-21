// The parent PIN: a privacy screen that keeps a child holding the device on their scoreboard.
// It is not encryption: the data in localStorage stays readable to anyone with DevTools. Only a
// salted SHA-256 of the PIN is stored, per device under umpire-pin (never in umpire-v1, so it is
// not in backups and an import can't remove or replace it). Modelled on Daymark's src/lib/pin.js.

export const PIN_KEY = 'umpire-pin';
export const LOCK_AFTER = 5 * 60 * 1000; // lock again after this long in the background

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hash(pin, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('A PIN needs a secure (https) connection.');
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
}

export const isPin = pin => typeof pin === 'string' && /^\d{4}$/.test(pin);

/** @returns {Promise<{salt:string, hash:string}>} */
export async function makePin(pin) {
  if (!isPin(pin)) throw new Error('A PIN is 4 digits.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hash(pin, salt) };
}

export async function checkPin(pin, stored) {
  return !!stored && isPin(pin) && (await hash(pin, stored.salt)) === stored.hash;
}

const valid = p => !!p && typeof p === 'object' && /^[0-9a-f]{32}$/.test(p.salt) && /^[0-9a-f]{64}$/.test(p.hash);

/** The stored PIN record, or null when none is set (or it is unreadable). */
export function loadPin(storage = globalThis.localStorage) {
  try {
    const p = JSON.parse(storage.getItem(PIN_KEY));
    return valid(p) ? { salt: p.salt, hash: p.hash } : null;
  } catch {
    return null;
  }
}

/** Stores a record from makePin(), or removes the PIN with null. Returns false if storage failed. */
export function savePin(record, storage = globalThis.localStorage) {
  try {
    if (record) storage.setItem(PIN_KEY, JSON.stringify({ salt: record.salt, hash: record.hash }));
    else storage.removeItem(PIN_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a route must show the PIN screen before its view renders.
 * `boardOk` says the route is a scoreboard for a child that exists (an unknown child falls back to
 * the parent board, which is locked). The scoreboard itself never needs the PIN.
 */
export function needsPin({ hasPin, unlocked, view, boardOk }) {
  if (!hasPin || unlocked) return false;
  return !(view === 'board' && boardOk);
}

/**
 * The unlocked state after visiting a route: opening a scoreboard locks the session, so leaving
 * it needs the PIN even if the parent had unlocked before handing the device over.
 */
export function unlockedAfterRoute({ hasPin, unlocked, view, boardOk }) {
  return hasPin && view === 'board' && boardOk ? false : unlocked;
}

/** Whether returning to the app after being hidden since `hiddenAt` locks it again. */
export const relockOnReturn = (hiddenAt, now) => !!hiddenAt && now - hiddenAt > LOCK_AFTER;

// Wrong-PIN throttle: after PIN_TRIES wrong PINs in a row, entry is blocked for PIN_DELAY, and each
// further wrong PIN blocks it again (the delay stays short and doesn't grow). A correct PIN resets
// it. Kept in memory only: this makes guessing a 4-digit PIN tedious, nothing more.
export const PIN_TRIES = 3;
export const PIN_DELAY = 5 * 1000;
export const NO_TRIES = Object.freeze({ wrong: 0, blockedUntil: 0 });

/** The throttle state after a wrong PIN at `now`. */
export function afterWrongPin(state, now) {
  const wrong = (state?.wrong || 0) + 1;
  return { wrong, blockedUntil: wrong >= PIN_TRIES ? now + PIN_DELAY : 0 };
}

/** Whether PIN entry is blocked at `now`. */
export const pinBlocked = (state, now) => !!state && state.blockedUntil > now;
