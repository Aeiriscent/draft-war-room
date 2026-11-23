// Weekly start/sit engine: per-player projection for one NFL week in a league's scoring, built from recent form,
// Sleeper's projection, opponent defense, Vegas implied totals, game script, weather, injury/practice status,
// teammate absences, QB changes and role trends. Plus a lineup optimizer and win probabilities. Pure module.
import { clamp, mean, sd, normCdf, normTeam, easternToUtc } from './util.js';

const OUT = new Set(['Out', 'IR', 'PUP', 'Sus', 'DNR', 'NA', 'COV', 'NFI']);
const SOFT = /hamstring|groin|calf|quad|achilles|ankle/i;
export const SLOT_OK = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'],
};
const SLOT_ORDER = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0, REC_FLEX: 1, WRRB_FLEX: 1, FLEX: 2, SUPER_FLEX: 3 };
export const RISK_K = { safe: -0.45, balanced: 0, upside: 0.45 };

/** Score a Sleeper projected stat line in this league's scoring. */
export function scoreProjection(stats, sc, pos) {
  if (!stats) return null;
  if (pos === 'K' || pos === 'DEF') return stats.pts_ppr ?? stats.pts_std ?? null;
  let p = 0;
  for (const [k, v] of Object.entries(sc)) {
    if (k.startsWith('bonus_rec_')) continue;
    if (stats[k] != null) p += v * stats[k];
  }
  if (stats.rec) p += (sc['bonus_rec_' + pos.toLowerCase()] || 0) * stats.rec;
  return p;
}

/** Schedule rows -> per-team game info for a week. rows: [week, day, time, away, home, spread(home+), total, roof, stadium, awayScore, homeScore] */
export function gamesForWeek(rows, week, stadiums = {}) {
  const out = new Map();
  for (const r of rows) {
    if (r[0] !== week) continue;
    const [, day, time, away, home, spread, total, roof, stadium, as, hs] = r;
    const kick = day ? easternToUtc(day, time || '13:00') : null;
    const st = stadiums[stadium] || null;
    const roofType = roof === 'dome' || roof === 'closed' ? 'dome' : st?.[2] === 'dome' ? 'dome' : st?.[2] === 'retractable' ? 'retractable' : 'outdoors';
    const base = { week, day, time, kick, stadium, lat: st?.[0], lon: st?.[1], roof: roofType, total, final: as != null && hs != null };
    if (home) out.set(home, { ...base, team: home, opp: away, home: true, spread: spread != null ? spread : null });
    if (away) out.set(away, { ...base, team: away, opp: home, home: false, spread: spread != null ? -spread : null });
  }
  return out;
}

/** Fantasy points allowed per game by each defense to each position, in this league's scoring, vs league average. */
export function defenseVsPosition(M, season) {
  const allowed = {}, games = {};
  for (const p of M.profiles) {
    for (const w of p.weeks) {
      if (w.s !== season || !w.opp) continue;
      const k = w.opp;
      (allowed[k] ||= { QB: 0, RB: 0, WR: 0, TE: 0 })[p.pos] += w.pts;
      (games[k] ||= new Set()).add(w.wk);
    }
  }
  const per = {};
  for (const t of Object.keys(allowed)) {
    const n = games[t].size || 1;
    per[t] = { n, pts: Object.fromEntries(Object.entries(allowed[t]).map(([pos, v]) => [pos, v / n])) };
  }
  const avg = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) avg[pos] = mean(Object.values(per).map((x) => x.pts[pos]));
  const rank = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const s = Object.keys(per).sort((a, b) => per[b].pts[pos] - per[a].pts[pos]);
    s.forEach((t, i) => { (rank[t] ||= {})[pos] = i + 1; });
  }
  return { per, avg, rank, teams: Object.keys(per).length };
}

/** Context shared by every player for a given week. */
export function buildWeek({ data, M, week, season, sleeper = null, projections = null, schedule = null, weather = {}, now = new Date() }) {
  const rows = schedule || data.schedule || [];
  const games = gamesForWeek(rows, week, data.stadiums || {});
  const dvp = defenseVsPosition(M, season);
  const ctx = data.teamCtx?.[String(season)] || {};
  // team games already played this season, in order
  const played = {};
  for (const r of rows) {
    if (r[0] >= week || r[9] == null) continue;
    (played[r[3]] ||= []).push(r[0]);
    (played[r[4]] ||= []).push(r[0]);
  }
  for (const t of Object.keys(played)) played[t].sort((a, b) => a - b);
  // live status per profile
  const statusOf = (p) => {
    const sp = p.sid && sleeper?.[p.sid];
    const report = p.reportNow;
    return {
      injury: sp?.injury_status ?? p.injury ?? (report && report[0] === week ? report[1] : null),
      body: sp?.injury_body_part || (report ? report[3] : null),
      practice: normPractice(sp?.practice_participation) || (report && report[0] === week ? report[2] : null),
      depth: sp?.depth_chart_order ?? null,
      team: normTeam(sp?.team || p.team),
    };
  };
  // team rosters (fantasy-relevant players) for teammate-injury logic
  const byTeam = new Map();
  for (const p of M.profiles) {
    if (p.prospect || !p.weeks.length) continue;
    const st = statusOf(p);
    if (!st.team) continue;
    if (!byTeam.has(st.team)) byTeam.set(st.team, []);
    byTeam.get(st.team).push({ p, st });
  }
  return { week, season, games, dvp, ctx, played, statusOf, byTeam, projections, weather, sleeper, now, sc: M.cfg.scoring };
}

function normPractice(x) {
  if (!x) return null;
  const s = String(x).toUpperCase();
  if (s.startsWith('DNP') || s.includes('DID NOT')) return 'DNP';
  if (s.startsWith('L')) return 'LP';
  if (s.startsWith('F')) return 'FP';
  return null;
}

function recentUsage(p, season, n = 6) {
  const ws = p.weeks.filter((w) => w.s === season).slice(-n);
  return {
    ts: mean(ws.map((w) => w.ts || 0)), cs: mean(ws.map((w) => w.cs || 0)),
    weeks: new Set(p.weeks.filter((w) => w.s === season).map((w) => w.wk)),
  };
}

/** Expected points for one player in one week, with the reasons. */
export function projectWeek(p, W) {
  const pos = p.pos;
  const st = W.statusOf(p);
  const team = st.team;
  const g = W.games.get(team) || null;
  const factors = [];
  const add = (label, mult, tone, why) => factors.push({ label, mult, tone, why });
  const base = { p, pos, team, game: g, status: st, factors };
  if (!g) return { ...base, bye: true, proj: 0, exp: 0, sd: 0, floor: 0, ceil: 0, pPlay: 0, locked: false, note: 'Bye week' };
  const locked = g.kick && W.now >= g.kick;

  // 1. recent form in league scoring (exponential decay, regressed toward season rate)
  const cur = p.weeks.filter((w) => w.s === W.season && w.wk < W.week);
  let form = null, n = cur.length;
  if (n) {
    let num = 0, den = 0;
    cur.forEach((w, i) => { const wt = 0.85 ** (n - 1 - i); num += wt * w.pts; den += wt; });
    const decay = num / den;
    const seasonRate = p.trailingPpg ?? decay;
    form = (n * decay + 3 * seasonRate) / (n + 3);
  } else if (p.trailingPpg) form = p.trailingPpg * 0.9;
  // 2. Sleeper's projection, rescored
  const projStats = p.sid && W.projections?.[p.sid];
  const sleeperPts = projStats ? scoreProjection(projStats, W.sc, pos) : null;

  // 3. matchup multipliers applied to our form
  let m = 1;
  const opp = g.opp;
  const dv = W.dvp.per[opp];
  if (dv && ['QB', 'RB', 'WR', 'TE'].includes(pos) && W.dvp.avg[pos] > 0) {
    const ratio = dv.pts[pos] / W.dvp.avg[pos];
    const shrink = dv.n / (dv.n + 4);
    const f = clamp(1 + 0.5 * (ratio - 1) * shrink, 0.85, 1.15);
    m *= f;
    const rk = W.dvp.rank[opp]?.[pos];
    const T = W.dvp.teams;
    const easy = rk <= Math.ceil(T / 3), hard = rk > Math.floor(2 * T / 3);
    add(`vs ${opp} defense`, f, easy ? 'good' : hard ? 'bad' : 'muted', `${opp} allows ${dv.pts[pos].toFixed(1)} PPG to ${pos}s (${ordinalTxt(rk)} most of ${T}).`);
  }
  const tc = W.ctx[team];
  if (pos === 'DEF' && g.total != null && g.spread != null) {
    const oppImplied = (g.total - g.spread) / 2;
    const f = clamp(1 - 0.03 * (oppImplied - 22), 0.8, 1.25);
    m *= f;
    add('Opponent total', f, f > 1.04 ? 'good' : f < 0.96 ? 'bad' : 'muted', `${opp} implied for ${oppImplied.toFixed(1)} pts (O/U ${g.total}). Low totals mean sacks, turnovers and fewer points allowed.`);
  } else if (g.total != null && g.spread != null && tc) {
    const implied = (g.total + g.spread) / 2;
    const f = clamp(1 + 0.6 * (implied / tc.ppg - 1), 0.82, 1.22);
    m *= f;
    add('Vegas team total', f, f > 1.04 ? 'good' : f < 0.96 ? 'bad' : 'muted', `Implied ${implied.toFixed(1)} pts vs a ${tc.ppg.toFixed(1)} season average (O/U ${g.total}, ${g.spread > 0 ? `favored by ${g.spread}` : g.spread < 0 ? `${-g.spread}-pt underdog` : 'pick’em'}).`);
    const s = g.spread;
    if (Math.abs(s) >= 6 && pos !== 'K') {
      const gs = pos === 'RB' ? clamp(1 + 0.006 * s, 0.94, 1.06) : pos === 'WR' || pos === 'TE' ? clamp(1 - 0.003 * s, 0.97, 1.03) : 1;
      if (gs !== 1) { m *= gs; add('Game script', gs, gs > 1 ? 'good' : 'bad', s > 0 ? 'Big favorite: expect more rushing late.' : 'Big underdog: expect more passing.'); }
    }
  }
  if (g.home) { m *= 1.015; add('Home', 1.015, 'muted', 'Home teams score ~1.5% more.'); }
  // weather (outdoor; retractable counted at half strength in case the roof is open)
  const wx = W.weather?.[g.stadium + '|' + g.day];
  if (wx && g.roof !== 'dome' && ['QB', 'WR', 'TE', 'RB', 'K'].includes(pos)) {
    const k = g.roof === 'retractable' ? 0.5 : 1;
    let f = 1;
    const bits = [];
    if (wx.wind >= 15) { f *= 1 - k * Math.min(0.15, 0.012 * (wx.wind - 12)) * (pos === 'RB' ? -0.3 : 1); bits.push(`${Math.round(wx.wind)} mph wind`); }
    if (wx.pop >= 60 && wx.precip >= 0.04) { f *= 1 - k * (pos === 'RB' ? -0.02 : 0.05); bits.push(`${Math.round(wx.pop)}% chance of rain/snow`); }
    if (wx.temp <= 25) { f *= 1 - k * (pos === 'RB' ? 0 : 0.04); bits.push(`${Math.round(wx.temp)}°F`); }
    if (bits.length) { m *= f; add('Weather', f, f < 0.99 ? 'bad' : f > 1.01 ? 'good' : 'muted', `${bits.join(', ')} at kickoff${g.roof === 'retractable' ? ' (retractable roof may close)' : ''}.`); }
  } else if (g.roof === 'dome' && ['QB', 'WR', 'TE'].includes(pos)) {
    m *= 1.02; add('Dome', 1.02, 'good', 'Indoors: no weather risk.');
  }
  // teammates: new absences open up targets/carries; starting QB out hurts pass catchers
  const mates = (W.byTeam.get(team) || []).filter((x) => x.p !== p);
  const teamPlayed = W.played[team] || [];
  const lastTeamGames = teamPlayed.slice(-3);
  const newlyOut = (x) => {
    if (!(OUT.has(x.st.injury) || x.st.injury === 'Doubtful')) return false;
    const u = recentUsage(x.p, W.season);
    return lastTeamGames.filter((wk) => u.weeks.has(wk)).length >= 2; // was playing until now -> not already in form
  };
  const myU = recentUsage(p, W.season);
  if (['WR', 'TE', 'RB'].includes(pos)) {
    const outRec = mates.filter((x) => ['WR', 'TE', 'RB'].includes(x.p.pos) && newlyOut(x));
    const vacTs = outRec.reduce((s, x) => s + recentUsage(x.p, W.season).ts, 0);
    if (vacTs >= 6) {
      const healthy = mates.filter((x) => ['WR', 'TE', 'RB'].includes(x.p.pos) && !outRec.includes(x) && !OUT.has(x.st.injury));
      const pool = healthy.reduce((s, x) => s + recentUsage(x.p, W.season).ts, 0) + myU.ts;
      const gain = pool > 0 ? vacTs * 0.8 * (myU.ts / pool) : 0;
      const f = clamp(1 + 0.7 * gain / Math.max(myU.ts, 5), 1, 1.35);
      if (f > 1.02) { m *= f; add('Teammate out', f, 'good', `${outRec.map((x) => x.p.name).join(', ')} out: ~${Math.round(vacTs)}% of targets to redistribute.`); }
    }
  }
  if (pos === 'RB') {
    const outRb = mates.filter((x) => x.p.pos === 'RB' && newlyOut(x));
    const vacCs = outRb.reduce((s, x) => s + recentUsage(x.p, W.season).cs, 0);
    if (vacCs >= 15) {
      const healthy = mates.filter((x) => x.p.pos === 'RB' && !outRb.includes(x) && !OUT.has(x.st.injury));
      const w = (x, u) => u.cs + (x.st.depth === 2 || x.st.depth === 1 ? 20 : 0);
      const mine = w({ st }, myU);
      const pool = healthy.reduce((s, x) => s + w(x, recentUsage(x.p, W.season)), 0) + mine;
      const gain = pool > 0 ? vacCs * 0.9 * mine / pool : 0;
      const f = clamp(1 + 0.8 * gain / Math.max(myU.cs, 10), 1, 1.6);
      if (f > 1.02) { m *= f; add('Backfield opens up', f, 'good', `${outRb.map((x) => x.p.name).join(', ')} out: ~${Math.round(vacCs)}% of carries free.`); }
    }
  }
  if (['WR', 'TE', 'RB'].includes(pos) && tc?.qb) {
    const qb = mates.find((x) => x.p.pos === 'QB' && x.p.name === tc.qb);
    if (qb && newlyOut(qb)) {
      const f = pos === 'RB' ? 0.96 : 0.88;
      m *= f; add('Starting QB out', f, 'bad', `${qb.p.name} is ${qb.st.injury}: backup QB downgrades the passing game.`);
    }
  }
  // role trend and return from absence
  const last3 = cur.slice(-3).map((w) => w.snap).filter((x) => x >= 0);
  const allSnaps = cur.map((w) => w.snap).filter((x) => x >= 0);
  if (last3.length === 3 && allSnaps.length >= 6) {
    const d = mean(last3) - mean(allSnaps);
    if (Math.abs(d) >= 10) { const f = d > 0 ? 1.04 : 0.96; m *= f; add(d > 0 ? 'Role growing' : 'Role shrinking', f, d > 0 ? 'good' : 'bad', `Snap share ${d > 0 ? '+' : ''}${Math.round(d)} pts over the last 3 games.`); }
  }
  const lastTeam = teamPlayed[teamPlayed.length - 1];
  if (lastTeam && n >= 3 && !myU.weeks.has(lastTeam) && !OUT.has(st.injury)) {
    m *= 0.93; add('First game back', 0.93, 'warn', 'Missed his team’s last game: snaps are often managed on return.');
  }
  m = clamp(m, 0.6, 1.6);

  // 4. blend with Sleeper's projection (which already prices in some matchup info)
  let proj;
  if (form != null && sleeperPts != null) proj = 0.55 * sleeperPts + 0.45 * form * m;
  else if (sleeperPts != null) proj = sleeperPts * (0.55 + 0.45 * m); // same weight our adjustments get in the blend
  else if (form != null) proj = form * m;
  else proj = 0;
  proj = Math.max(0, proj);

  // 5. availability
  let pPlay = 0.985, eff = 1;
  const inj = st.injury;
  if (OUT.has(inj)) pPlay = 0;
  else if (inj === 'Doubtful') pPlay = 0.15;
  else if (inj === 'Questionable') {
    pPlay = st.practice === 'FP' ? 0.93 : st.practice === 'LP' ? 0.78 : st.practice === 'DNP' ? 0.45 : 0.75;
    eff = SOFT.test(st.body || '') ? 0.92 : 0.95;
  }
  if (inj && inj !== 'Questionable' && !OUT.has(inj) && inj !== 'Doubtful') pPlay = 0.9;
  if (inj) {
    const tone = pPlay === 0 ? 'bad' : pPlay < 0.6 ? 'bad' : 'warn';
    add('Injury', pPlay * eff, tone, `${inj}${st.body ? ` (${st.body})` : ''}${st.practice ? `, practice: ${({ DNP: 'did not participate', LP: 'limited', FP: 'full' })[st.practice]}` : ''}. About ${Math.round(pPlay * 100)}% to play${eff < 1 && pPlay > 0 ? `; ${SOFT.test(st.body || '') ? 'soft-tissue injuries' : 'playing hurt'} can cap snaps` : ''}.`);
  } else if (st.practice === 'LP' || st.practice === 'DNP') {
    add('Practice', 1, 'warn', `Listed ${st.practice === 'DNP' ? 'DNP' : 'limited'} this week without a game status yet.`);
  }
  const ifPlays = proj * eff;
  const exp = ifPlays * pPlay;
  // variance from his own weekly distribution
  const pts = p.weeks.slice(-16).map((w) => w.pts);
  const cv = pts.length >= 4 && mean(pts) > 0 ? clamp(sd(pts) / mean(pts), 0.3, 1.0) : 0.6;
  const sdv = Math.sqrt(pPlay * (ifPlays * cv) ** 2 + pPlay * (1 - pPlay) * ifPlays ** 2);
  return {
    ...base, locked, bye: false, form, sleeperPts, matchupMult: m, proj: ifPlays, exp, pPlay, sd: sdv,
    floor: Math.max(0, exp - 0.84 * sdv), ceil: exp + 0.84 * sdv,
    gameTimeDecision: inj === 'Questionable' && g.kick && g.kick.getUTCHours() >= 20,
  };
}

/** Best lineup for a roster. locked: Map(playerId -> slot index) for players whose game has started. */
export function optimize(entries, slots, risk = 'balanced', locked = new Map()) {
  const k = RISK_K[risk] ?? 0;
  const val = (e) => (e.bye ? -1 : e.exp + k * e.sd);
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => (SLOT_ORDER[a.s] ?? 4) - (SLOT_ORDER[b.s] ?? 4));
  const used = new Set();
  const filled = new Array(slots.length).fill(null);
  for (const [id, i] of locked) {
    const e = entries.find((x) => x.p.id === id);
    if (e && i < slots.length) { filled[i] = e; used.add(id); }
  }
  const lockedBench = new Set(entries.filter((e) => e.locked && !locked.has(e.p.id)).map((e) => e.p.id));
  const pool = [...entries].sort((a, b) => val(b) - val(a));
  for (const { s, i } of order) {
    if (filled[i]) continue;
    const e = pool.find((x) => !used.has(x.p.id) && !lockedBench.has(x.p.id) && (SLOT_OK[s] || []).includes(x.pos));
    if (e) { filled[i] = e; used.add(e.p.id); }
  }
  const total = filled.reduce((s, e) => s + (e ? e.exp : 0), 0);
  const variance = filled.reduce((s, e) => s + (e ? e.sd ** 2 : 0), 0);
  return { slots, filled, total, sd: Math.sqrt(variance) };
}

export function winProb(a, b) {
  const s = Math.sqrt(a.sd ** 2 + b.sd ** 2) || 1;
  return normCdf((a.total - b.total) / s);
}

const ordinalTxt = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
