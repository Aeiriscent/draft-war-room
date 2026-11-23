// Reads each team's draft: what strategy they appear to be running, value vs market, needs, strength.
import { mean, median, clamp } from './util.js';
import { bestLineup } from './model.js';

const POSS = ['QB', 'RB', 'WR', 'TE'];

/**
 * @param drafted  [{pick:{no,round}, p: profile|null}]  this draft's picks for the team
 * @param existing [profile] players already on the roster (existing leagues)
 * @param ctx      {lineup, repl, mktPos: Map(id -> market rank among draft-eligible pool), rookieDraft}
 */
export function teamReport(drafted, existing, ctx) {
  const known = drafted.filter((d) => d.p);
  const rounds = drafted.map((d) => d.pick.round);
  const maxRound = rounds.length ? Math.max(...rounds) : 0;
  const inFirst = (n, pos) => known.filter((d) => d.pick.round <= n && d.p.pos === pos).length;
  const first = {};
  for (const d of [...known].sort((a, b) => a.pick.no - b.pick.no)) if (!first[d.p.pos]) first[d.p.pos] = d.pick.round;
  const ages = known.map((d) => d.p.age).filter((a) => a != null);
  const avgAge = ages.length ? mean(ages) : null;
  const deltas = known.map((d) => {
    const m = ctx.mktPos?.get(d.p.id);
    return m ? { d, delta: d.pick.no - m } : null;
  }).filter(Boolean);
  // typical value vs market: median of clamped deltas, so one deep-sleeper pick doesn't swamp the read
  const avgDelta = deltas.length ? median(deltas.map((x) => clamp(x.delta, -40, 40))) : 0;
  const rookies = known.filter((d) => d.p.rookie).length;

  const labels = [];
  const add = (label, why, strength = 1) => labels.push({ label, why, strength });
  if (!ctx.rookieDraft) {
    if (first.QB === 1 || inFirst(3, 'QB') >= 2) add('QB-first', `${inFirst(3, 'QB')} QB${inFirst(3, 'QB') === 1 ? '' : 's'} in rounds 1-3`, 1.2);
    else if (maxRound >= 6 && !first.QB) add('Waiting on QB', 'No QB through round 6', 1.1);
    else if (first.QB >= 6) add('Late QB', `First QB in round ${first.QB}`);
    if (first.TE && first.TE <= 3) add('Elite-TE anchor', `TE in round ${first.TE} (TE premium)`, 1.1);
    if (maxRound >= 5 && inFirst(5, 'RB') === 0) add('Zero RB', 'No RB in the first 5 rounds', 1.2);
    else if (maxRound >= 6 && inFirst(2, 'RB') === 1 && inFirst(6, 'RB') === 1) add('Hero RB', 'One early RB, then none through round 6');
    else if (inFirst(5, 'RB') >= 3) add('Robust RB', `${inFirst(5, 'RB')} RBs in rounds 1-5`);
    if (inFirst(5, 'WR') >= 3) add('WR-heavy', `${inFirst(5, 'WR')} WRs in rounds 1-5`);
    if (known.length >= 6 && rookies / known.length >= 0.35) add('Rookie-heavy', `${rookies} of ${known.length} picks are rookies/prospects`);
  } else {
    const top = POSS.map((pos) => [pos, known.filter((d) => d.p.pos === pos).length]).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2 && top[1] / known.length >= 0.5) add(`${top[0]}-focused`, `${top[1]} of ${known.length} picks at ${top[0]}`);
  }
  if (avgAge != null && known.length >= 4) {
    if (avgAge <= 24.8) add('Youth movement', `Average age ${avgAge.toFixed(1)}`, 1.1);
    else if (avgAge >= 27) add('Win-now', `Average age ${avgAge.toFixed(1)}`, 1.1);
  }
  if (deltas.length >= 4) {
    if (avgDelta >= 4) add('Value hunter', `Typical pick came ${avgDelta.toFixed(1)} spots after market`);
    else if (avgDelta <= -5) add('Reaches for targets', `Typical pick came ${Math.abs(avgDelta).toFixed(1)} spots ahead of market`);
    else if (Math.abs(avgDelta) < 2.5) add('Follows the market', 'Picks track consensus closely');
  }
  if (!labels.length && known.length) add('Best available', 'No strong positional or age lean yet');
  labels.sort((a, b) => b.strength - a.strength);

  const roster = [...existing, ...known.map((d) => d.p)];
  const lu = bestLineup(roster, ctx.lineup);
  const lineupDyn = bestLineup(roster, ctx.lineup, 'dyn');
  const needs = [];
  for (const f of lu.filled) {
    const slot = ['QB', 'RB', 'WR', 'TE'].includes(f.slot) ? f.slot : f.slot === 'SUPER_FLEX' ? 'QB' : 'FLEX';
    if (!f.p) needs.push({ pos: slot, why: 'empty starter slot' });
    else if (ctx.repl && f.p.proj < ctx.repl[f.p.pos] * 0.95) needs.push({ pos: slot, why: `${f.p.name} is below starter level` });
  }
  const steals = [...deltas].sort((a, b) => b.delta - a.delta).filter((x) => x.delta >= 5).slice(0, 2);
  const reaches = [...deltas].sort((a, b) => a.delta - b.delta).filter((x) => x.delta <= -8).slice(0, 2);
  const counts = Object.fromEntries(POSS.map((p) => [p, roster.filter((x) => x.pos === p).length]));
  const lean = labels[0]?.label;
  const needPos = [...new Set(needs.map((n) => n.pos))];
  const nextGuess = needPos.length ? needPos.slice(0, 2) : (lean === 'QB-first' ? ['QB'] : []);

  const parts = [];
  if (labels.length) parts.push(`Leaning ${labels.slice(0, 2).map((l) => l.label).join(' + ')}`);
  if (avgAge != null) parts.push(`avg age ${avgAge.toFixed(1)}`);
  if (deltas.length) parts.push(avgDelta >= 0 ? `typical pick ${avgDelta.toFixed(1)} spots after market` : `typical pick ${Math.abs(avgDelta).toFixed(1)} spots ahead of market`);
  return {
    labels, avgAge, avgDelta, steals, reaches, counts, first, needs, needPos, nextGuess,
    lineupPpg: lu.total, lineup: lu.filled, dynValue: lineupDyn.total,
    rosterValue: roster.reduce((s, p) => s + Math.max(0, p.score || 0), 0),
    summary: parts.join(' · '), size: roster.length,
  };
}

/** League-wide ranks for lineup strength, roster value and each position. */
export function leagueTable(reports) {
  const arr = [...reports.entries()];
  const rankBy = (f) => {
    const s = [...arr].sort((a, b) => f(b[1]) - f(a[1]));
    return new Map(s.map(([k], i) => [k, i + 1]));
  };
  const now = rankBy((r) => r.lineupPpg), val = rankBy((r) => r.rosterValue);
  const out = new Map();
  for (const [k, r] of arr) {
    const n = now.get(k), v = val.get(k), T = arr.length;
    const window = n <= Math.ceil(T / 3) ? 'Contender' : v <= Math.ceil(T / 3) && n > Math.ceil(T / 2) ? 'Rebuilding' : n > Math.ceil(2 * T / 3) && v > Math.ceil(2 * T / 3) ? 'Stuck' : 'Middle';
    out.set(k, { nowRank: n, valueRank: v, window, strength: clamp(1 - (n - 1) / Math.max(1, T - 1), 0, 1) });
  }
  return out;
}
