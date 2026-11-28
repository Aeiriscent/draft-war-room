// Trade values and trade suggestions for one league. Values are on the dynasty market scale (DynastyProcess /
// FantasyPros consensus, superflex + TE-premium adjusted), so "market" is what other managers will pay and the
// model's view is mapped onto the same scale by rank. Pure module.
import { clamp, mean, fmt, logistic, ordinal } from './util.js';
import { bestLineup, CLIFF } from './model.js';

const PKG_W = [1, 0.86, 0.74, 0.64, 0.56, 0.5]; // a package of smaller pieces is worth less than the sum
const soft = (x) => (x > 0 ? x : x * 0.15);
const H = { Contender: 0.2, Middle: 0.5, Rebuilding: 0.82 };

/** Per-player trade values on the market scale: market, model-now, model-dynasty. Cached per outlook context. */
export function playerValues(M, X) {
  const key = X ? `${X.nextWeek}|${X.lastWeek}` : 'none';
  M._tv ||= {};
  if (M._tv[key]) return M._tv[key];
  const pool = M.profiles.filter((p) => !p.prospect && ((p.mv || 0) > 0 || (p.vorp || 0) > 0));
  // rest-of-season value over a replacement starter, so a contender values this year's games too
  const replRos = {};
  if (X) for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const list = [...X.ros.entries()].filter(([id]) => M.byId.get(id)?.pos === pos).map(([, r]) => r.ppg).sort((a, b) => b - a);
    replRos[pos] = list[Math.min(list.length - 1, Math.round(M.demand[pos]))] || 0;
  }
  const gamesLeft = X ? X.weeksLeft.length : 0;
  const nowScore = new Map(), dynScore = new Map();
  for (const p of pool) {
    const R = X?.ros.get(p.id);
    const ros = R ? (R.ppg - replRos[p.pos]) * Math.min(gamesLeft, R.games) : 0;
    nowScore.set(p, soft(p.vorp || 0) + soft(ros));
    dynScore.set(p, soft(p.dyn || 0));
  }
  // The model re-orders players WITHIN a position and borrows the market's price for that slot. That keeps the
  // market's positional pricing (superflex QB premium, TE premium) and only disagrees about who is better.
  const byPos = {};
  for (const p of pool) (byPos[p.pos] ||= []).push(p);
  const mkPos = Object.fromEntries(Object.entries(byPos).map(([pos, list]) => [pos, list.map((p) => p.mv || 0).sort((a, b) => b - a)]));
  const byRank = (score) => {
    const m = new Map();
    for (const [pos, list] of Object.entries(byPos)) [...list].sort((a, b) => score.get(b) - score.get(a)).forEach((p, i) => m.set(p.id, mkPos[pos][i] || 0));
    return m;
  };
  const nowV = byRank(nowScore), dynV = byRank(dynScore);
  const out = new Map();
  for (const p of pool) {
    const market = p.mv || 0, now = nowV.get(p.id), dyn = dynV.get(p.id);
    // trade value = what he'd fetch (market); the model's view is kept separately as now/dyn/model
    out.set(p.id, { market, now, dyn, model: 0.5 * now + 0.5 * dyn, value: Math.round(market > 0 ? market : 0.3 * (0.5 * now + 0.5 * dyn)) });
  }
  const sorted = [...out.entries()].sort((a, b) => b[1].value - a[1].value);
  const posN = {};
  sorted.forEach(([id, v], i) => { v.rank = i + 1; const pos = M.byId.get(id).pos; posN[pos] = (posN[pos] || 0) + 1; v.posRank = posN[pos]; });
  M._tv[key] = out;
  return out;
}

export const valueFor = (a, h) => (a.kind === 'pick' ? a.market * (0.8 + 0.4 * h) : (1 - h) * a.now + h * a.dyn);
export function pkg(list, f) {
  return list.map(f).sort((a, b) => b - a).reduce((s, v, i) => s + v * (PKG_W[i] ?? 0.45), 0);
}

const pickWord = (r) => ({ 1: '1st', 2: '2nd', 3: '3rd' }[r] || `${r}th`);

/**
 * League trade context. sl: {league, rosters, users, traded} straight from Sleeper.
 * opts: {myRid, myWindow: 'auto'|'contend'|'rebuild'}
 */
export function tradeContext(M, X, sl, opts = {}) {
  const vals = playerValues(M, X);
  const league = sl.league || {};
  const rosters = sl.rosters || [];
  const teamsN = rosters.length || M.cfg.teams || 12;
  const users = new Map((sl.users || []).map((u) => [u.user_id, u]));
  const lineup = M.cfg.lineup;
  const next = M.nextSeason;
  const rounds = league.settings?.draft_rounds || 4;
  const seasons = [next, next + 1, next + 2];

  const assets = new Map();
  const teams = rosters.map((r) => {
    const u = users.get(r.owner_id);
    const name = u ? (u.metadata?.team_name || u.display_name) : `Team ${r.roster_id}`;
    const players = (r.players || []).map(String).map((id) => M.byId.get(id)).filter(Boolean);
    const s = r.settings || {};
    return {
      rid: r.roster_id, name, ownerId: r.owner_id, co: r.co_owners || [], players,
      record: { w: s.wins || 0, l: s.losses || 0, t: s.ties || 0, pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100 },
      picks: [],
    };
  });
  const byRid = new Map(teams.map((t) => [t.rid, t]));

  // lineup strength now (rest of season) and next season
  const wrap = (p) => ({ id: p.id, pos: p.pos, ros: X?.ros.get(p.id)?.ppg ?? 0, proj: p.proj || 0 });
  const strength = (players) => ({ ros: bestLineup(players.map(wrap), lineup, 'ros').total, next: bestLineup(players.map(wrap), lineup, 'proj').total });
  for (const t of teams) {
    t.str = strength(t.players);
    const bl = bestLineup(t.players.map(wrap), lineup, X ? 'ros' : 'proj');
    t.starters = new Set(bl.filled.filter((f) => f.p).map((f) => f.p.id));
    t.age = mean(t.players.filter((p) => vals.get(p.id)?.value > 1500 && p.age != null).map((p) => p.age)) || null;
  }
  const pctRank = (arr, f) => {
    const s = [...arr].sort((a, b) => f(a) - f(b));
    return new Map(s.map((t, i) => [t.rid, s.length > 1 ? i / (s.length - 1) : 0.5]));
  };
  const played = teams.some((t) => t.record.w + t.record.l + t.record.t > 0);
  const recP = pctRank(teams, (t) => t.record.w + 0.5 * t.record.t + t.record.pf / 1e4);
  const strP = pctRank(teams, (t) => t.str.ros + t.str.next * 0.3);
  const nextP = pctRank(teams, (t) => t.str.next);
  for (const t of teams) {
    const score = played ? 0.5 * recP.get(t.rid) + 0.5 * strP.get(t.rid) : 0.7 * strP.get(t.rid) + 0.3 * nextP.get(t.rid);
    const label = score >= 0.62 ? 'Contender' : score <= 0.38 ? 'Rebuilding' : 'Middle';
    const rankOf = (m) => teams.length - Math.round(m.get(t.rid) * (teams.length - 1));
    t.window = {
      label, score, h: H[label], auto: true,
      why: `${played ? `${t.record.w}-${t.record.l}${t.record.t ? `-${t.record.t}` : ''}, ` : ''}${ordinal(rankOf(strP))}-best lineup now, ${ordinal(rankOf(nextP))} for next season${t.age ? `, core age ${fmt(t.age, 1)}` : ''}`,
    };
  }
  // my window override
  const me = byRid.get(opts.myRid);
  if (me && opts.myWindow && opts.myWindow !== 'auto') {
    const label = opts.myWindow === 'contend' ? 'Contender' : 'Rebuilding';
    me.window = { ...me.window, label, h: H[label], auto: false };
  }

  // projected draft slot for next year's picks: worst record (then fewest points) picks first
  const order = [...teams].sort((a, b) => (played ? (a.record.w - b.record.w) || (a.record.pf - b.record.pf) : a.str.next - b.str.next));
  const slotOf = new Map(order.map((t, i) => [t.rid, i + 1]));
  // pick ownership: everyone owns their own picks unless traded
  const owner = new Map();
  for (const s of seasons) for (let rd = 1; rd <= rounds; rd++) for (const t of teams) owner.set(`${s}|${rd}|${t.rid}`, t.rid);
  for (const tp of sl.traded || []) {
    const k = `${tp.season}|${tp.round}|${tp.roster_id}`;
    if (owner.has(k)) owner.set(k, tp.owner_id);
  }
  for (const [k, rid] of owner) {
    const [s, rd, orig] = k.split('|').map(Number);
    const slot = s === next ? slotOf.get(orig) : Math.ceil(teamsN / 2);
    const disc = s === next ? 1 : s === next + 1 ? 0.9 : 0.82;
    const market = M.pickValue((rd - 1) * teamsN + slot) * disc;
    const tier = s === next ? (slot <= teamsN / 3 ? 'early' : slot > (2 * teamsN) / 3 ? 'late' : 'mid') : null;
    const origT = byRid.get(orig);
    const a = {
      id: `pk:${s}:${rd}:${orig}`, kind: 'pick', season: s, round: rd, orig, owner: rid, slot: s === next ? slot : null, market, now: market * 0.8, dyn: market * 1.2,
      label: `${s} ${tier ? `${tier} ` : ''}${pickWord(rd)}`, detail: s === next ? `projected ${rd}.${String(slot).padStart(2, '0')}` : 'slot unknown',
      via: orig !== rid ? origT?.name : null, value: Math.round(market),
    };
    assets.set(a.id, a);
    byRid.get(rid)?.picks.push(a);
  }
  for (const t of teams) {
    t.picks.sort((a, b) => a.season - b.season || a.round - b.round || (a.slot ?? 99) - (b.slot ?? 99));
    for (const p of t.players) {
      const v = vals.get(p.id) || { market: 0, now: 0, dyn: 0, model: 0, value: 0 };
      assets.set(p.id, { id: p.id, kind: 'player', p, pos: p.pos, owner: t.rid, label: p.name, ...v, starter: t.starters.has(p.id) });
    }
  }
  // needs and surplus by position: starter quality vs the league, on the team's own horizon
  const perTeamSlots = (pos) => Math.max(1, Math.round(M.demand[pos] / teamsN));
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const k = perTeamSlots(pos);
    const q = teams.map((t) => {
      const h = t.window.h;
      const vs = t.players.filter((p) => p.pos === pos).map((p) => assets.get(p.id)).map((a) => valueFor(a, h)).sort((a, b) => b - a);
      return { t, q: vs.slice(0, k).reduce((s, v) => s + v, 0), depth: vs.slice(k, k + 2).reduce((s, v) => s + v, 0) };
    }).sort((a, b) => a.q - b.q);
    q.forEach((x, i) => {
      const p = q.length > 1 ? i / (q.length - 1) : 0.5;
      x.t.posRank ||= {};
      x.t.posRank[pos] = q.length - i; // 1 = best
      if (p <= 0.3) (x.t.needs ||= []).push({ pos, sev: 1 - p / 0.3 });
      if (p >= 0.7 && x.depth > 0) (x.t.strong ||= []).push(pos);
    });
  }
  for (const t of teams) {
    t.needs ||= []; t.strong ||= [];
    t.needs.sort((a, b) => b.sev - a.sev);
    t.bench = t.players.filter((p) => !t.starters.has(p.id)).map((p) => assets.get(p.id)).filter((a) => a.market > 0).sort((a, b) => b.market - a.market);
    t.totalValue = [...t.players.map((p) => assets.get(p.id)), ...t.picks].reduce((s, a) => s + (a.value || 0), 0);
  }
  return { M, X, vals, teams, byRid, assets, lineup, me: me || null, trust: M.weights?.marketTrust ?? 0.4, next, rounds, teamsN, slotOf, rosterMax: (league.roster_positions || []).filter((s) => s !== 'IR').length || null };
}

/** Minimal context (no rosters): enough for a player's value read in any league. */
export function liteTrade(M, X) {
  return { M, X, vals: playerValues(M, X), teams: [], byRid: new Map(), assets: new Map(), me: null, next: M.nextSeason, teamsN: M.cfg.teams || 12, trust: M.weights?.marketTrust ?? 0.4 };
}

/** Plain-language trade value read for one player in this league. */
export function valueReport(T, id) {
  const a = T.assets.get(id) || (() => {
    const v = T.vals.get(id);
    const p = T.M.byId.get(id);
    return v && p ? { id, kind: 'player', p, pos: p.pos, owner: null, ...v } : null;
  })();
  if (!a || a.kind !== 'player') return null;
  const own = a.owner != null ? T.byRid.get(a.owner) : null;
  const me = T.me;
  const h = me ? me.window.h : 0.5;
  const mine = me && a.owner === me.rid;
  const forMe = myVal(T, a, h);
  const gap = a.market > 0 ? (forMe - a.market) / a.market : 0;
  // what it's equivalent to in next year's rookie draft
  const n = T.teamsN;
  let pickEq = null;
  for (let k = 1; k <= n * 4; k++) {
    if (T.M.pickValue(k) <= a.market) { pickEq = k === 1 ? 'more than the 1.01' : `about pick ${Math.ceil(k / n)}.${String(((k - 1) % n) + 1).padStart(2, '0')}`; break; }
  }
  const p = a.p;
  const reasons = [];
  const age = p.age != null ? Math.floor(p.age) : null;
  if (age != null && age >= CLIFF[p.pos]) reasons.push(`Will be ${age} next season, past the usual ${p.pos} decline age: value drops every offseason.`);
  if (a.now > a.dyn * 1.25) reasons.push('Worth more to a team winning now than to a rebuild.');
  if (a.dyn > a.now * 1.25) reasons.push('Worth more as a long-term piece than for this season.');
  if (a.model > a.market * 1.2) reasons.push(`Production says he should be valued ~${Math.round((a.model / a.market - 1) * 100)}% higher than the market does.`);
  if (a.model < a.market * 0.8 && a.market > 0) reasons.push(`The market values him ~${Math.round((1 - a.model / a.market) * 100)}% above what his production supports.`);
  const R = T.X?.ros.get(p.id);
  if (R?.tdAdj <= -1) reasons.push('Touchdown luck is inflating his recent numbers; sell before it evens out.');
  if (p.injury && ['Out', 'IR', 'Doubtful', 'PUP'].includes(p.injury)) reasons.push(`Currently ${p.injury}: buyers will discount him until he’s back.`);
  let verdict, tone;
  if (mine) {
    if (gap <= -0.15) { verdict = 'Sell'; tone = 'bad'; }
    else if (gap >= 0.12) { verdict = 'Hold: worth more to you than to the market'; tone = 'good'; }
    else { verdict = 'Hold'; tone = 'muted'; }
  } else if (gap >= 0.15) { verdict = 'Buy'; tone = 'good'; }
  else if (gap <= -0.15) { verdict = 'Pass at market price'; tone = 'bad'; }
  else { verdict = 'Fair at market price'; tone = 'muted'; }
  // who would want him
  const buyers = T.teams.filter((t) => t.rid !== a.owner && t.needs.some((x) => x.pos === p.pos))
    .map((t) => ({ t, fit: (t.needs.find((x) => x.pos === p.pos)?.sev || 0) + (a.now > a.dyn ? (t.window.label === 'Contender' ? 0.5 : 0) : (t.window.label === 'Rebuilding' ? 0.5 : 0)) }))
    .sort((x, y) => y.fit - x.fit).slice(0, 3).map((x) => x.t);
  return { a, own, mine, forMe, gap, pickEq, reasons, verdict, tone, buyers, h, season: T.next };
}

// ---------------- evaluation ----------------
function lineupDelta(T, team, giveIds, getIds) {
  const set = new Set(giveIds);
  const after = [...team.players.filter((p) => !set.has(p.id)), ...getIds.map((id) => T.assets.get(id)).filter((a) => a?.kind === 'player').map((a) => a.p)];
  const s = (players) => {
    const w = players.map((p) => ({ id: p.id, pos: p.pos, ros: T.X?.ros.get(p.id)?.ppg ?? 0, proj: p.proj || 0 }));
    return { ros: bestLineup(w, T.lineup, 'ros').total, next: bestLineup(w, T.lineup, 'proj').total };
  };
  const a = s(after);
  return { ros: a.ros - team.str.ros, next: a.next - team.str.next };
}

// How another manager sees an asset: the market price, tilted toward the future for a rebuilder and toward
// this season for a contender. (They don't see our model, so its opinions don't enter here.)
export function perceived(a, h) {
  const lean = a.kind === 'pick' ? 0.8 : clamp((a.dyn - a.now) / Math.max(a.dyn, a.now, 1), -1, 1);
  return a.market * (1 + 0.6 * (h - 0.5) * lean);
}

/** My valuation: the model's view on my horizon, blended with the market by the league's Model ↔ Market slider. */
export const myVal = (T, a, h) => T.trust * perceived(a, h) + (1 - T.trust) * valueFor(a, h);

function acceptance(T, them, giveA, getA) {
  // giveA = what THEY give, getA = what THEY get
  const h = them.window.h;
  const give = pkg(giveA, (a) => perceived(a, h)), get = pkg(getA, (a) => perceived(a, h));
  const mPct = (get - give) / Math.max(give, get, 1);
  let fit = 0;
  for (const a of getA) if (a.kind === 'player' && them.needs.some((n) => n.pos === a.pos)) fit += 0.04;
  for (const a of giveA) if (a.kind === 'player' && them.starters.has(a.id) && them.needs.some((n) => n.pos === a.pos)) fit -= 0.05;
  const extra = getA.filter((a) => a.kind === 'player').length - giveA.filter((a) => a.kind === 'player').length;
  if (extra > 1) fit -= 0.03 * (extra - 1); // they'd have to cut players to make room
  const x = mPct + fit;
  return { p: logistic((x + 0.01) * 13), mPct, fit };
}
const acceptLabel = (p) => (p >= 0.65 ? ['Likely accepted', 'good'] : p >= 0.42 ? ['Worth sending', 'good'] : p >= 0.22 ? ['Long shot', 'warn'] : ['Unlikely', 'bad']);

/** Grade a trade from my side. giveIds: my assets out, getIds: their assets in. */
export function evaluateTrade(T, me, them, giveIds, getIds) {
  const give = giveIds.map((id) => T.assets.get(id)).filter(Boolean);
  const get = getIds.map((id) => T.assets.get(id)).filter(Boolean);
  const h = me.window.h;
  const mGive = pkg(give, (a) => a.market), mGet = pkg(get, (a) => a.market);
  const vGive = pkg(give, (a) => myVal(T, a, h)), vGet = pkg(get, (a) => myVal(T, a, h));
  const mPct = (mGet - mGive) / Math.max(mGive, mGet, 1);
  const vPct = (vGet - vGive) / Math.max(vGive, vGet, 1);
  const acc = acceptance(T, them, get, give);
  const myLine = lineupDelta(T, me, giveIds, getIds);
  const theirLine = lineupDelta(T, them, getIds, giveIds);
  const lines = [];
  const pctTxt = (x) => `${Math.round(Math.abs(x) * 100)}%`;
  lines.push(Math.abs(mPct) < 0.06 ? 'By market value this is an even trade.' : mPct > 0 ? `By market value you receive ${pctTxt(mPct)} more than you send.` : `By market value you send ${pctTxt(mPct)} more than you get back.`);
  lines.push(Math.abs(vPct) < 0.06 ? `For a ${me.window.label.toLowerCase()} team like yours, it’s about even.` : vPct > 0 ? `For a ${me.window.label.toLowerCase()} team like yours, you gain ${pctTxt(vPct)} in value.` : `For a ${me.window.label.toLowerCase()} team like yours, you lose ${pctTxt(vPct)} in value.`);
  if (T.X) lines.push(`Your starting lineup: ${myLine.ros >= 0 ? '+' : '−'}${fmt(Math.abs(myLine.ros))} PPG rest of this season, ${myLine.next >= 0 ? '+' : '−'}${fmt(Math.abs(myLine.next))} PPG next season.`);
  else lines.push(`Your starting lineup next season: ${myLine.next >= 0 ? '+' : '−'}${fmt(Math.abs(myLine.next))} PPG.`);
  const best = [...give, ...get].sort((a, b) => b.market - a.market)[0];
  if (best && give.length + get.length > 2) lines.push(get.includes(best) ? `You get the best asset in the deal (${best.label}); consolidating into a stud is usually the winning side.` : `They get the best asset in the deal (${best.label}).`);
  const myNeedsHit = get.filter((a) => a.kind === 'player' && me.needs.some((n) => n.pos === a.pos));
  if (myNeedsHit.length) lines.push(`Fills a need at ${[...new Set(myNeedsHit.map((a) => a.pos))].join('/')}.`);
  const theirNeedsHit = give.filter((a) => a.kind === 'player' && them.needs.some((n) => n.pos === a.pos));
  if (theirNeedsHit.length) lines.push(`It fills their need at ${[...new Set(theirNeedsHit.map((a) => a.pos))].join('/')}, which helps it get accepted.`);
  if (T.rosterMax && me.players.length + get.filter((a) => a.kind === 'player').length - give.filter((a) => a.kind === 'player').length > T.rosterMax) lines.push('You’d need to drop a player to fit them on your roster.');
  // overall grade for me (value on my horizon, plus a nudge for lineup change)
  const lineupTerm = clamp((h < 0.5 ? myLine.ros * 0.04 : 0) + myLine.next * 0.02, -0.12, 0.12);
  const score = vPct + lineupTerm;
  const grade = score >= 0.15 ? ['Great for you', 'good'] : score >= 0.05 ? ['Good for you', 'good'] : score > -0.05 ? ['Fair', 'muted'] : score > -0.15 ? ['Slight overpay', 'warn'] : ['Overpay', 'bad'];
  // balancing ideas
  const balance = [];
  const diff = mGet - mGive; // + means they are short-changed
  if (give.length || get.length) {
    if (diff > 0.08 * Math.max(mGive, mGet)) {
      const pool = [...me.bench.filter((a) => !giveIds.includes(a.id)), ...me.picks.filter((a) => !giveIds.includes(a.id))];
      balance.push(...closest(pool, diff, 3).map((a) => ({ side: 'give', a, why: `Adding ${a.label} closes most of the gap so they’ll say yes.` })));
    } else if (diff < -0.08 * Math.max(mGive, mGet)) {
      const pool = [...them.bench.filter((a) => !getIds.includes(a.id)), ...them.picks.filter((a) => !getIds.includes(a.id))];
      balance.push(...closest(pool, -diff, 3).map((a) => ({ side: 'get', a, why: `Ask for ${a.label} too; you’re overpaying by about that much.` })));
    }
  }
  return { give, get, mGive, mGet, vGive, vGet, mPct, vPct, acc: { ...acc, label: acceptLabel(acc.p) }, myLine, theirLine, lines, grade, balance };
}

function closest(pool, target, n) {
  return [...pool].filter((a) => a.market > 0 && a.market <= target * 1.6).sort((a, b) => Math.abs(a.market * 0.86 - target) - Math.abs(b.market * 0.86 - target)).slice(0, n);
}

// ---------------- suggestions ----------------
function combos(arr, maxK, cb) {
  const n = arr.length;
  const rec = (start, chosen) => {
    if (chosen.length) cb(chosen);
    if (chosen.length === maxK) return;
    for (let i = start; i < n; i++) { chosen.push(arr[i]); rec(i + 1, chosen); chosen.pop(); }
  };
  rec(0, []);
}

/** Realistic packages from my roster for a target asset on another team. */
export function offersFor(T, me, targetId, { limit = 5, exclude = [] } = {}) {
  const tgt = T.assets.get(targetId);
  if (!tgt || tgt.owner === me.rid) return [];
  const them = T.byRid.get(tgt.owner);
  const h = me.window.h;
  const cands = [...me.players.map((p) => T.assets.get(p.id)), ...me.picks]
    .filter((a) => a && a.market >= tgt.market * 0.06 && a.market <= tgt.market * 1.35 && !exclude.includes(a.id))
    // most expendable first: the market likes them more than my window does, and they don't start for me
    .map((a) => ({ a, exp: (a.market - myVal(T, a, h)) / Math.max(a.market, 1) + (a.kind === 'player' && !a.starter ? 0.15 : 0) + (a.kind === 'pick' && h < 0.5 ? 0.1 : 0) }))
    .sort((x, y) => y.exp - x.exp || y.a.market - x.a.market).slice(0, 22).map((x) => x.a);
  const out = [];
  const tgtFor = myVal(T, tgt, h);
  combos(cands, 3, (c) => {
    const m = pkg(c, (a) => a.market);
    if (m < tgt.market * 0.92 || m > tgt.market * 1.45) return;
    const acc = acceptance(T, them, [tgt], c);
    if (acc.p < 0.3) return;
    const give = pkg(c, (a) => myVal(T, a, h));
    const gain = (tgtFor - give) / Math.max(tgtFor, give, 1);
    const over = Math.max(0, m / tgt.market - 1.12); // paying well above market for no reason
    out.push({ ids: c.map((a) => a.id), gain, p: acc.p, score: gain + 0.25 * acc.p - 0.05 * (c.length - 1) - 0.6 * over });
  });
  out.sort((a, b) => b.score - a.score);
  // keep variety: no two offers led by the same main piece
  const seen = new Set(), picked = [];
  for (const o of out) {
    const lead = o.ids.map((id) => T.assets.get(id)).sort((a, b) => b.market - a.market)[0].id;
    if (seen.has(lead)) continue;
    seen.add(lead);
    picked.push(o);
    if (picked.length >= limit) break;
  }
  return picked.map((o) => ({ them, ...evaluateTrade(T, me, them, o.ids, [targetId]), giveIds: o.ids, getIds: [targetId] }));
}

/** What the rest of the league could realistically give me for one of my assets. */
export function shopAsset(T, me, myId, { limit = 6 } = {}) {
  const mine = T.assets.get(myId);
  if (!mine || mine.owner !== me.rid) return [];
  const h = me.window.h;
  const out = [];
  for (const them of T.teams) {
    if (them.rid === me.rid) continue;
    const wants = mine.kind === 'pick' || them.needs.some((n) => n.pos === mine.pos) || (mine.now > mine.dyn ? them.window.label === 'Contender' : them.window.label !== 'Contender');
    if (!wants) continue;
    const cands = [...them.players.map((p) => T.assets.get(p.id)), ...them.picks]
      .filter((a) => a && a.market >= mine.market * 0.1 && a.market <= mine.market * 1.1)
      .map((a) => ({ a, sc: (myVal(T, a, h) - a.market) / Math.max(a.market, 1) + (me.needs.some((n) => n.pos === a.pos) ? 0.15 : 0) }))
      .sort((x, y) => y.sc - x.sc || y.a.market - x.a.market).slice(0, 14).map((x) => x.a);
    combos(cands, 2, (c) => {
      const m = pkg(c, (a) => a.market);
      if (m < mine.market * 0.7 || m > mine.market * 1.08) return;
      const acc = acceptance(T, them, c, [mine]);
      if (acc.p < 0.3) return;
      const got = pkg(c, (a) => myVal(T, a, h)), gave = myVal(T, mine, h);
      const gain = (got - gave) / Math.max(got, gave, 1);
      out.push({ them, ids: c.map((a) => a.id), gain, p: acc.p, score: gain + 0.25 * acc.p });
    });
  }
  out.sort((a, b) => b.score - a.score);
  const perTeam = new Map(), picked = [];
  for (const o of out) {
    if ((perTeam.get(o.them.rid) || 0) >= 2) continue;
    perTeam.set(o.them.rid, (perTeam.get(o.them.rid) || 0) + 1);
    picked.push(o);
    if (picked.length >= limit) break;
  }
  return picked.map((o) => ({ them: o.them, ...evaluateTrade(T, me, o.them, [myId], o.ids), giveIds: [myId], getIds: o.ids }));
}

/** My players worth moving, most urgent first. */
export function sellCandidates(T, me, { limit = 8 } = {}) {
  const h = me.window.h;
  return me.players.map((p) => T.assets.get(p.id)).filter((a) => a && a.market >= 800).map((a) => {
    const p = a.p, why = [];
    let s = (a.market - myVal(T, a, h)) / a.market;
    const age = p.age != null ? Math.floor(p.age) : null;
    if (age != null && age >= CLIFF[p.pos] - 1) { s += age >= CLIFF[p.pos] ? 0.2 : 0.08; why.push(`will be ${age} next season (${p.pos}s decline from ~${CLIFF[p.pos]})`); }
    const R = T.X?.ros.get(p.id);
    if (R?.tdAdj <= -1) { s += 0.08; why.push('touchdown-inflated numbers'); }
    if (!a.starter) { s += 0.06; why.push('doesn’t start for you'); }
    if (me.strong.includes(p.pos) && !a.starter) { s += 0.05; why.push(`you’re deep at ${p.pos}`); }
    if (h > 0.6 && a.now > a.dyn * 1.15) { s += 0.1; why.push('worth more to a contender than to your rebuild'); }
    if (h < 0.4 && a.dyn > a.now * 1.3 && !a.starter) { s += 0.06; why.push('a future piece you can turn into help now'); }
    if (a.model < a.market * 0.85) why.push(`market pays ${Math.round((1 - a.model / a.market) * 100)}% more than his production supports`);
    if (p.injury && ['Out', 'IR', 'PUP'].includes(p.injury)) { s -= 0.15; why.push('injured: wait until he’s healthy to sell'); }
    const buyers = T.teams.filter((t) => t.rid !== me.rid && t.needs.some((n) => n.pos === p.pos) && (a.now > a.dyn ? t.window.label !== 'Rebuilding' : true)).slice(0, 3);
    return { a, s, why, buyers };
  }).filter((x) => x.s > 0.05 && x.why.length).sort((x, y) => y.s - x.s).slice(0, limit);
}

/** Players on other teams who are worth more to me than they cost. */
export function buyTargets(T, me, { limit = 10 } = {}) {
  const h = me.window.h;
  const budget = [...me.players.map((p) => T.assets.get(p.id)), ...me.picks].filter((a) => a && !a.starter).reduce((s, a) => s + a.market, 0) + 0.5 * me.players.map((p) => T.assets.get(p.id)).filter((a) => a?.starter).reduce((s, a) => s + a.market, 0);
  const out = [];
  for (const them of T.teams) {
    if (them.rid === me.rid) continue;
    for (const p of them.players) {
      const a = T.assets.get(p.id);
      if (!a || a.market < 1200 || a.market > budget * 0.6) continue;
      const why = [];
      let s = (myVal(T, a, h) - a.market) / a.market;
      const need = me.needs.find((n) => n.pos === p.pos);
      if (need) { s += 0.12 + 0.1 * need.sev; why.push(`fills your ${p.pos} need`); }
      const old = p.age != null && p.age >= CLIFF[p.pos] - 1;
      if (h > 0.6 && old) s -= 0.35; // a rebuild shouldn't spend on players about to age out
      if (h < 0.4 && !a.starter && (p.age ?? 30) < 23 && a.now < a.market * 0.8) s -= 0.15; // nor a contender on stashes
      if (h > 0.6 && a.dyn > a.market * 1.1 && !old) why.push('long-term value above his price');
      if (h < 0.4 && a.now > a.market * 1.1) why.push('more help this season than his price');
      if (a.model > a.market * 1.15) why.push(`model values him ${Math.round((a.model / a.market - 1) * 100)}% above market`);
      // motivated sellers: rebuilders with vets, contenders with non-starting youth
      if (them.window.label === 'Rebuilding' && a.now > a.dyn) { s += 0.08; why.push(`${them.name} is rebuilding and he helps now`); }
      if (them.window.label === 'Contender' && !a.starter && a.dyn > a.now) { s += 0.06; why.push(`${them.name} is contending and he isn’t starting for them`); }
      const R = T.X?.ros.get(p.id);
      if (R?.tdAdj >= 1) { s += 0.04; why.push('scoring should tick up as TDs even out'); }
      if (s > 0.08 && why.length) out.push({ a, them, s, why });
    }
  }
  return out.sort((x, y) => y.s - x.s).slice(0, limit);
}

/** Ready-made offers: the best realistic package for each of my top buy targets. */
export function readyOffers(T, me, { limit = 6 } = {}) {
  const out = [];
  const used = new Map(); // don't build every offer around the same player of mine
  for (const b of buyTargets(T, me, { limit: limit * 2 })) {
    const opts = offersFor(T, me, b.a.id, { limit: 4 }).filter((o) => o.vPct > -0.02 && o.acc.p >= 0.4);
    const o = opts.find((x) => x.giveIds.every((id) => (used.get(id) || 0) < 1)) || opts.find((x) => x.giveIds.every((id) => (used.get(id) || 0) < 2));
    if (!o) continue;
    o.giveIds.forEach((id) => used.set(id, (used.get(id) || 0) + 1));
    out.push({ ...o, target: b });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => (b.vPct + 0.3 * b.acc.p) - (a.vPct + 0.3 * a.acc.p));
}
