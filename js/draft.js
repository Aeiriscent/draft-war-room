// Draft mechanics: pick order (snake / 3rd-round reversal / linear, traded picks), board state,
// survival odds, and the "your pick" recommendation engine. Pure module.
import { clamp, mean } from './util.js';
import { bestLineup } from './model.js';

export function buildOrder({ teams, rounds, type = 'snake', reversalRound = 0, slotKey, traded = [] }) {
  const tradeMap = new Map(traded.map((t) => [`${t.round}|${t.orig}`, t.owner]));
  const out = [];
  for (let r = 1; r <= rounds; r++) {
    let reversed = type === 'snake' ? r % 2 === 0 : false;
    if (type === 'snake' && reversalRound > 0 && r >= reversalRound) reversed = !reversed;
    for (let i = 0; i < teams; i++) {
      const slot = reversed ? teams - i : i + 1;
      const orig = slotKey[slot] ?? `s${slot}`;
      out.push({ no: (r - 1) * teams + i + 1, round: r, inRound: i + 1, slot, orig, owner: tradeMap.get(`${r}|${orig}`) ?? orig });
    }
  }
  return out;
}

export const pickLabel = (o) => `${o.round}.${String(o.inRound).padStart(2, '0')}`;

/**
 * Normalize a Sleeper draft (+ optional league/rosters/users) into the app's draft context.
 * Team keys: 'r<roster_id>' in league drafts, 'u<user_id>' or 's<slot>' in mock drafts.
 */
export function fromSleeper({ draft, picks = [], traded = [], rosters = [], users = [], myUserId, names = {} }) {
  const T = draft.settings?.teams || Object.keys(draft.draft_order || {}).length || 12;
  const R = draft.settings?.rounds || 15;
  const slotKey = {};
  if (draft.slot_to_roster_id) for (const [s, rid] of Object.entries(draft.slot_to_roster_id)) slotKey[+s] = rid != null ? `r${rid}` : `s${s}`;
  else if (draft.draft_order) for (const [uid, s] of Object.entries(draft.draft_order)) slotKey[+s] = `u${uid}`;
  for (let s = 1; s <= T; s++) slotKey[s] = slotKey[s] || `s${s}`;
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const rosterById = new Map(rosters.map((r) => [r.roster_id, r]));
  const teamName = (key) => {
    if (key.startsWith('r')) {
      const ro = rosterById.get(+key.slice(1));
      const u = ro && userById.get(ro.owner_id);
      return u ? (u.metadata?.team_name || u.display_name) : `Team ${key.slice(1)}`;
    }
    if (key.startsWith('u')) return names[key.slice(1)] || userById.get(key.slice(1))?.display_name || 'Drafter';
    return `Slot ${key.slice(1)}`;
  };
  const order = buildOrder({
    teams: T, rounds: R, type: draft.type === 'linear' ? 'linear' : 'snake', reversalRound: draft.settings?.reversal_round || 0,
    slotKey, traded: traded.map((t) => ({ round: t.round, orig: `r${t.roster_id}`, owner: `r${t.owner_id}` })),
  });
  const keys = [...new Set(Object.values(slotKey))];
  const teams = keys.map((k) => ({
    key: k, name: teamName(k), slot: +Object.keys(slotKey).find((s) => slotKey[s] === k),
    roster: k.startsWith('r') ? (rosterById.get(+k.slice(1))?.players || []).map(String) : [],
    ownerId: k.startsWith('r') ? rosterById.get(+k.slice(1))?.owner_id : k.startsWith('u') ? k.slice(1) : null,
  }));
  let myKey = null;
  if (myUserId) {
    const ro = rosters.find((r) => r.owner_id === myUserId || (r.co_owners || []).includes(myUserId));
    if (ro && keys.includes(`r${ro.roster_id}`)) myKey = `r${ro.roster_id}`;
    else if (draft.draft_order?.[myUserId]) myKey = slotKey[draft.draft_order[myUserId]];
  }
  const normPicks = picks.map((p) => {
    const o = order[p.pick_no - 1];
    const key = (p.roster_id != null && keys.includes(`r${p.roster_id}`)) ? `r${p.roster_id}` : (o?.owner || slotKey[p.draft_slot]);
    const m = p.metadata || {};
    return {
      no: p.pick_no, round: p.round, key, pid: String(p.player_id), name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
      pos: m.position, nfl: m.team, yearsExp: m.years_exp != null ? +m.years_exp : null, keeper: !!p.is_keeper,
    };
  }).sort((a, b) => a.no - b.no);
  return {
    source: 'sleeper', id: draft.draft_id, status: draft.status, type: draft.type, teams, order, picks: normPicks,
    rounds: R, numTeams: T, myKey, startTime: draft.start_time, season: draft.season,
    playerType: draft.settings?.player_type ?? null, name: draft.metadata?.name || 'Draft',
  };
}

export function boardState(ctx, extraPicks = []) {
  const picks = [...ctx.picks, ...extraPicks].sort((a, b) => a.no - b.no);
  const made = new Map(picks.map((p) => [p.no, p]));
  const taken = new Set(picks.map((p) => p.pid));
  const onClock = ctx.order.find((o) => !made.has(o.no)) || null;
  const mine = ctx.order.filter((o) => o.owner === ctx.myKey && !made.has(o.no));
  const myNext = mine[0] || null;
  const picksUntil = myNext && onClock ? myNext.no - onClock.no : null;
  const afterNext = mine[1] || null;
  return { picks, made, taken, onClock, myNext, afterNext, picksUntil, complete: !onClock };
}

/** Rosters per team key: existing league players + this draft's picks. */
export function teamRosters(ctx, state, model) {
  const out = new Map(ctx.teams.map((t) => [t.key, { team: t, existing: [], drafted: [] }]));
  for (const t of ctx.teams) {
    for (const pid of t.roster) {
      const p = model.byId.get(pid);
      if (p) out.get(t.key).existing.push(p);
    }
  }
  for (const pk of state.picks) {
    const slot = out.get(pk.key);
    if (!slot) continue;
    slot.drafted.push({ pick: pk, p: model.byId.get(pk.pid) || null });
  }
  return out;
}

/** Probability a player is still there after `g` more picks, using market rank among the available pool as ADP. */
export function survival(mktPos, g) {
  if (g <= 0) return 1;
  const s = 1.6 + 0.16 * mktPos;
  return 1 / (1 + Math.exp((g - mktPos + 0.5) / s));
}

/**
 * Rank the available players for MY next pick.
 * @returns [{p, score, reasons:[{t,tone}], survive, gain, startFrac}]
 */
export function recommend({ available, myPlayers, lineup, picksUntil, horizon = 0.5, tags = {}, limit = 15 }) {
  const byMkt = [...available].filter((p) => p.mv > 0).sort((a, b) => b.mv - a.mv);
  const mktPos = new Map(byMkt.map((p, i) => [p.id, i + 1]));
  const g = Math.max(0, picksUntil ?? 0);
  const base = bestLineup(myPlayers, lineup).total;
  const counts = {};
  for (const p of myPlayers) counts[p.pos] = (counts[p.pos] || 0) + 1;
  const CAP = { QB: 4, RB: 7, WR: 8, TE: 4 };
  const pool = [...available].sort((a, b) => b.score - a.score).slice(0, 150);
  const surviveNext = (p) => survival(mktPos.get(p.id) ?? (byMkt.length + 10), g);
  const nextBestAtPos = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const cands = pool.filter((p) => p.pos === pos);
    nextBestAtPos[pos] = cands;
  }
  const out = pool.map((p) => {
    const reasons = [];
    const gain = bestLineup([...myPlayers, p], lineup).total - base;
    const worth = Math.max(0.5, p.proj - p.repl);
    const startFrac = p.prospect ? 0.4 : clamp(gain / worth, 0, 1);
    const w = 0.3 * (1 - horizon) + 0.08;
    let score = p.score * (1 - w + w * startFrac);
    // urgency: how much value at this position disappears before my next turn
    const surv = surviveNext(p);
    const others = nextBestAtPos[p.pos].filter((q) => q.id !== p.id);
    let exp = 0, remain = 1;
    for (const q of others.slice(0, 12)) {
      const s = surviveNext(q);
      exp += remain * s * q.score;
      remain *= 1 - s;
    }
    const drop = Math.max(0, p.score - exp);
    const urgency = 0.3 * drop * (1 - surv);
    score += urgency;
    if ((counts[p.pos] || 0) >= CAP[p.pos]) { score *= 0.8; reasons.push({ t: `You already have ${counts[p.pos]} ${p.pos}s`, tone: 'bad' }); }
    const tag = tags[p.id]?.t;
    if (tag === 'target') { score += 4; reasons.push({ t: 'On your target list', tone: 'good' }); }
    if (tag === 'avoid') { score -= 15; reasons.push({ t: 'On your avoid list', tone: 'bad' }); }
    if (gain > 0.3) reasons.push({ t: `+${gain.toFixed(1)} PPG to your starting lineup`, tone: 'good' });
    else if (!p.prospect && horizon < 0.6) reasons.push({ t: 'Bench depth for now', tone: 'muted' });
    if (drop > 6 && surv < 0.6) reasons.push({ t: `${p.pos} drop-off: next one at your turn ≈ ${Math.round(drop)} pts worse`, tone: 'warn' });
    reasons.push({ t: `${Math.round(surv * 100)}% chance he's still there at your next turn`, tone: surv < 0.35 ? 'warn' : 'muted' });
    return { p, score, reasons, survive: surv, gain, startFrac, drop };
  });
  out.sort((a, b) => b.score - a.score);
  if (out[0]) out[0].reasons.unshift({ t: 'Best fit on the board', tone: 'good' });
  const bestValue = [...pool].sort((a, b) => b.score - a.score)[0];
  const bv = out.find((x) => x.p === bestValue);
  if (bv && bv !== out[0]) bv.reasons.unshift({ t: 'Highest-rated player left', tone: 'good' });
  return out.slice(0, limit);
}

/** Which positions do teams picking before my next turn still need? (to anticipate runs) */
export function threats(ctx, state, rosters, lineup) {
  if (!state.onClock || !state.myNext) return [];
  const between = ctx.order.filter((o) => o.no >= state.onClock.no && o.no < state.myNext.no).map((o) => o.owner);
  const need = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const key of between) {
    const r = rosters.get(key);
    if (!r) continue;
    const players = [...r.existing, ...r.drafted.map((d) => d.p).filter(Boolean)];
    const { filled } = bestLineup(players, lineup);
    const empty = new Set(filled.filter((f) => !f.p).map((f) => (['QB', 'RB', 'WR', 'TE'].includes(f.slot) ? f.slot : null)).filter(Boolean));
    for (const pos of empty) need[pos]++;
  }
  return Object.entries(need).map(([pos, n]) => ({ pos, n, of: between.length })).sort((a, b) => b.n - a.n);
}

export const avgOf = (arr, f) => mean(arr.map(f).filter((x) => x != null));
