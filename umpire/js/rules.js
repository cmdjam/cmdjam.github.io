// Pure rule logic: counting strikes, expiry windows and the state of each call.
// Everything is a function of (rule, strikes, now) with times as epoch milliseconds,
// so it runs the same in the page and under `node --test`.

export const UNITS = ['day', 'week', 'month'];

// The moment `amount` units after `t`, in local calendar terms (DST-safe). A month step
// clamps to the end of a shorter month: 31 Jan + 1 month is 28/29 Feb, not 2/3 Mar.
export function addPeriod(t, amount, unit) {
  const d = new Date(t);
  if (unit === 'month') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + amount);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  } else {
    d.setDate(d.getDate() + amount * (unit === 'week' ? 7 : 1));
  }
  return d.getTime();
}

// When a strike stops counting, or Infinity for a rule whose strikes never expire.
export function expiresAt(strike, rule) {
  return rule.expiry ? addPeriod(strike.at, rule.expiry.amount, rule.expiry.unit) : Infinity;
}

export function ruleStrikes(rule, strikes) {
  return strikes.filter(s => s.ruleId === rule.id).sort((a, b) => a.at - b.at);
}

// Strikes counting at time t: logged at or before t and not yet expired.
export function liveStrikes(rule, strikes, t) {
  return ruleStrikes(rule, strikes).filter(s => s.at <= t && expiresAt(s, rule) > t);
}

export function countAt(rule, strikes, t) {
  return liveStrikes(rule, strikes, t).length;
}

export function sortedCalls(rule) {
  return rule.calls.slice().sort((a, b) => a.threshold - b.threshold);
}

export function lastEnforcement(call) {
  return call.enforcements.reduce((m, e) => (!m || e.at > m.at ? e : m), null);
}

// A call's last enforcement still stands while the count has stayed at or above its threshold
// ever since. The count only falls when a strike expires, so checking the enforcement moment
// and each expiry after it is enough. When it falls below, the call re-arms: its history stays,
// and it is due again once the count climbs back.
export function enforcementStands(rule, call, strikes, now) {
  const last = lastEnforcement(call);
  if (!last || last.at > now) return false;
  if (countAt(rule, strikes, last.at) < call.threshold) return false;
  for (const s of ruleStrikes(rule, strikes)) {
    const x = expiresAt(s, rule);
    if (x > last.at && x <= now && countAt(rule, strikes, x) < call.threshold) return false;
  }
  return true;
}

// 'enforced' | 'due' | 'pending'
export function callState(rule, call, strikes, now) {
  if (enforcementStands(rule, call, strikes, now)) return 'enforced';
  return countAt(rule, strikes, now) >= call.threshold ? 'due' : 'pending';
}

// Everything the views need about a rule at `now`.
export function ruleStatus(rule, strikes, now) {
  const count = countAt(rule, strikes, now);
  const calls = sortedCalls(rule).map((call, i, all) => ({
    call,
    state: callState(rule, call, strikes, now),
    final: i === all.length - 1,
  }));
  const top = calls.length ? calls[calls.length - 1].call.threshold : 0;
  const next = calls.find(c => c.call.threshold > count) || null;
  return {
    count,
    calls,
    due: calls.filter(c => c.state === 'due'),
    next,                                   // the next call still to be reached, if any
    overLimit: calls.length ? Math.max(0, count - top) : 0,
    limit: top,
  };
}

// The rule's story, newest first: strikes (flagged once expired) and enforcements.
export function history(rule, strikes, now) {
  const out = [];
  for (const s of ruleStrikes(rule, strikes)) {
    const x = expiresAt(s, rule);
    out.push({ kind: 'strike', at: s.at, strike: s, expiresAt: x, expired: x <= now });
  }
  for (const call of rule.calls) {
    for (const e of call.enforcements) out.push({ kind: 'enforced', at: e.at, call, enforcement: e });
  }
  return out.sort((a, b) => b.at - a.at || (a.kind === 'enforced' ? -1 : 1));
}

export function describeExpiry(expiry) {
  if (!expiry) return 'Strikes never expire';
  const u = expiry.amount === 1 ? expiry.unit : expiry.unit + 's';
  return `Strikes expire after ${expiry.amount} ${u}`;
}
