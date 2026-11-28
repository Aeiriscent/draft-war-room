// The player model: turns raw weekly stats + market values into a profile, projection, grades, risks and ranks
// for ONE league's scoring and lineup. Pure module (no DOM) so it is testable in Node.
import { POS, clamp, mean, sd, quantile, pctRanks, letter, ageOn, normName, slug, round, normTeam } from './util.js';
import { makeScorer, starterDemand, isSuperflex } from './league.js';

// Production multiplier for the coming season, by age at the start of that season.
const AGE_CURVE = {
  QB: [[23, 1.08], [24, 1.06], [25, 1.04], [26, 1.03], [32, 1.0], [33, 0.99], [34, 0.97], [35, 0.95], [36, 0.92], [37, 0.88], [99, 0.82]],
  RB: [[22, 1.10], [23, 1.06], [24, 1.03], [25, 1.0], [26, 0.97], [27, 0.93], [28, 0.88], [29, 0.82], [99, 0.75]],
  WR: [[22, 1.12], [23, 1.08], [24, 1.05], [25, 1.03], [26, 1.01], [27, 1.0], [28, 0.98], [29, 0.95], [30, 0.91], [31, 0.86], [99, 0.8]],
  TE: [[22, 1.15], [23, 1.12], [24, 1.08], [25, 1.05], [26, 1.03], [27, 1.01], [28, 1.0], [29, 0.98], [30, 0.95], [31, 0.91], [32, 0.86], [99, 0.8]],
};
export const CLIFF = { QB: 35, RB: 27, WR: 30, TE: 31 };
const BASE_MISS = { QB: 0.08, RB: 0.14, WR: 0.1, TE: 0.1 };
const SOFT_TISSUE = /hamstring|groin|calf|quad|achilles/i;
const PREV_W = 0.55; // weight of the older season vs the latest one
const YEAR_DISC = [1, 0.8, 0.64];

export function ageMult(pos, age) {
  if (age == null) return 1;
  const a = Math.floor(age);
  for (const [max, m] of AGE_CURVE[pos]) if (a <= max) return m;
  return 1;
}

function seasonStats(ws, thr) {
  const g = ws.length;
  if (!g) return null;
  const pts = ws.map((w) => w.pts);
  const m = mean(pts);
  const snaps = ws.map((w) => w.snap).filter((x) => x >= 0);
  const last = ws.slice(-4), early = ws.slice(0, -4);
  const avgOf = (a, k) => (a.length ? mean(a.map((w) => w[k]).filter((x) => x >= 0)) : null);
  return {
    g, ppg: m, sd: sd(pts), cv: m > 0 ? sd(pts) / m : 1,
    p25: quantile(pts, 0.25), p50: quantile(pts, 0.5), p90: quantile(pts, 0.9), max: Math.max(...pts),
    start: ws.filter((w) => w.rk <= thr.start).length / g,
    strong: ws.filter((w) => w.rk <= thr.strong).length / g,
    bust: ws.filter((w) => w.rk > thr.bust).length / g,
    snap: snaps.length ? mean(snaps) : null,
    ts: mean(ws.map((w) => w.ts)), cs: mean(ws.map((w) => w.cs)),
    tgt: mean(ws.map((w) => w.tgt)), car: mean(ws.map((w) => w.car)), rec: mean(ws.map((w) => w.rec)),
    att: mean(ws.map((w) => w.att)),
    last4: ws.length >= 6 ? {
      ppg: avgOf(last, 'pts'), snap: avgOf(last, 'snap'), ts: avgOf(last, 'ts'), cs: avgOf(last, 'cs'),
      ePpg: avgOf(early, 'pts'), eSnap: avgOf(early, 'snap'), eTs: avgOf(early, 'ts'), eCs: avgOf(early, 'cs'),
    } : null,
    last6: ws.length >= 6 ? mean(pts.slice(-6)) : null,
  };
}

// least squares fit of y on ln(x+200)
function fitLog(pairs) {
  if (pairs.length < 5) return () => 6;
  const xs = pairs.map(([v]) => Math.log(v + 200)), ys = pairs.map(([, y]) => y);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  const b = den ? num / den : 0, a = my - b * mx;
  return (v) => clamp(a + b * Math.log((v || 0) + 200), 2, 32);
}

// market value for an overall ECR rank, interpolated from the veteran market
function ecrToValue(players, sf) {
  const pts = players.filter((p) => p.e2 && (sf ? p.v2 : p.v1)).map((p) => [p.e2, sf ? p.v2 : p.v1]).sort((a, b) => a[0] - b[0]);
  return (ecr) => {
    if (!pts.length) return 0;
    if (ecr <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (ecr <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (y1 - y0) * (ecr - x0) / (x1 - x0 || 1);
      }
    }
    return pts[pts.length - 1][1];
  };
}

/**
 * Build every player's profile for one league.
 * @param data      data/data.json
 * @param prospects data/prospects.json (may be null)
 * @param cfg       {teams, lineup, scoring}
 * @param opts      {sleeper: {sid: player}} optional Sleeper DB, {now: Date}
 */
export function buildModel(data, prospects, cfg, opts = {}) {
  const sc = cfg.scoring;
  const scorer = makeScorer(data.meta.fields);
  const FI = Object.fromEntries(data.meta.fields.map((f, i) => [f, i + 4]));
  const sf = isSuperflex(cfg.lineup);
  const tep = sc.bonus_rec_te || 0;
  const demand = starterDemand(cfg);
  const seasons = data.meta.seasons || [data.meta.season - 1, data.meta.season];
  const cur = seasons[seasons.length - 1], prev = seasons.length > 1 ? seasons[0] : null;
  const nextSeason = cur + 1;
  const sept1 = Date.UTC(nextSeason, 8, 1);
  const sleeper = opts.sleeper || null;
  const thr = {};
  for (const p of POS) {
    const n = Math.round(demand[p]);
    thr[p] = { start: n, strong: Math.max(3, Math.ceil(n / 2)), bust: Math.round(n * 1.5) };
  }

  // 1. weekly fantasy points in this league's scoring
  const all = data.players.map((p) => ({
    src: p,
    weeks: p.w.map((r) => ({
      s: 2000 + r[0], wk: r[1], tm: data.teams[r[2]], opp: data.teams[r[3]], pts: scorer(r, sc, p.p),
      snap: r[FI.snap], ts: r[FI.ts], cs: r[FI.cs], tgt: r[FI.tgt], car: r[FI.car], rec: r[FI.rec], att: r[FI.att],
      td: (r[FI.ptd] || 0) + (r[FI.rtd] || 0) + (r[FI.retd] || 0),
      tdPts: (r[FI.ptd] || 0) * (sc.pass_td ?? 4) + (r[FI.rtd] || 0) * (sc.rush_td ?? 6) + (r[FI.retd] || 0) * (sc.rec_td ?? 6),
      yd: (r[FI.pyd] || 0) + (r[FI.ryd] || 0) + (r[FI.reyd] || 0),
    })),
  }));

  // 2. weekly positional finish
  const groups = new Map();
  for (const a of all) for (const w of a.weeks) {
    const k = `${w.s}|${w.wk}|${a.src.p}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  for (const arr of groups.values()) {
    arr.sort((x, y) => y.pts - x.pts);
    arr.forEach((w, i) => { w.rk = i + 1; });
  }

  // 3. market value (superflex or 1QB) with a TE-premium adjustment
  const mvOf = (p) => {
    let v = (sf ? p.v2 : p.v1) || 0;
    if (p.p === 'TE') v *= 1 + 0.15 * tep;
    return v;
  };
  const valueAtEcr = ecrToValue(data.players, sf);

  // 4. base records
  const recs = [];
  const byName = new Map();
  for (const a of all) {
    const p = a.src;
    const sCur = seasonStats(a.weeks.filter((w) => w.s === cur), thr[p.p]);
    const sPrev = prev ? seasonStats(a.weeks.filter((w) => w.s === prev), thr[p.p]) : null;
    const r = {
      id: p.sid || (p.gid ? 'g:' + p.gid : 'n:' + slug(p.n)), sid: p.sid, name: p.n, pos: p.p, team: p.t || 'FA',
      bd: p.bd, ageNow: p.age, college: p.col, draft: { year: p.dy, round: p.dr, ovr: p.do },
      mv: mvOf(p), ecr: p.e2, posEcr: p.ep, rosterStatus: p.st, depth: p.dc,
      inj: p.inj || {}, injBody: p.ib || [], weeks: a.weeks, s: { cur: sCur, prev: sPrev }, reportNow: p.iw || null,
      prospect: false, rookie: p.dy === nextSeason,
    };
    recs.push(r);
    byName.set(normName(p.n) + '|' + p.p, r);
  }

  // 5. prospects (next rookie class). Matched to an NFL player record once they exist.
  if (prospects?.players?.length) {
    const ecrs = data.pickEcr || [];
    for (const pr of prospects.players) {
      const k = pr.rank - 1;
      const ecr = k < ecrs.length ? ecrs[k] : (ecrs[ecrs.length - 1] || 150) + (k - ecrs.length + 1) * 8;
      let v = valueAtEcr(ecr);
      if (pr.p === 'TE') v *= 1 + 0.15 * tep;
      const existing = byName.get(normName(pr.n) + '|' + pr.p);
      if (existing) {
        existing.prospectRank = pr.rank;
        existing.rookie = true;
        if (!existing.mv) existing.mv = v;
        continue;
      }
      const r = {
        id: 'p:' + slug(pr.n), sid: null, name: pr.n, pos: pr.p, team: 'NCAA', bd: null, ageNow: null,
        college: pr.col, draft: { year: prospects.class, round: null, ovr: null }, mv: v, ecr: null, posEcr: null,
        inj: {}, injBody: [], weeks: [], s: { cur: null, prev: null }, prospect: true, rookie: true,
        prospectRank: pr.rank, prospectRanks: pr.ranks, note: pr.note,
      };
      recs.push(r);
      byName.set(normName(pr.n) + '|' + pr.p, r);
    }
  }

  // 6. Sleeper DB: live team, injury status, experience; adds rookies Sleeper knows about that our data does not yet
  if (sleeper) {
    const known = new Set(recs.map((r) => r.sid).filter(Boolean));
    for (const r of recs) {
      const sp = r.sid && sleeper[r.sid];
      if (!sp) continue;
      r.team = normTeam(sp.team) || r.team;
      r.injury = sp.injury_status || null;
      r.yearsExp = sp.years_exp;
      if (!r.bd && sp.birth_date) r.bd = sp.birth_date;
    }
    for (const [sid, sp] of Object.entries(sleeper)) {
      if (known.has(sid) || !POS.includes(sp.position) || !sp.team) continue;
      const k = normName(sp.full_name || `${sp.first_name} ${sp.last_name}`) + '|' + sp.position;
      const pr = byName.get(k);
      if (pr && pr.prospect) { // a prospect who has now been drafted into the NFL
        Object.assign(pr, { id: sid, sid, team: normTeam(sp.team), bd: sp.birth_date || null, prospect: false, rookie: true, yearsExp: 0 });
        known.add(sid);
        continue;
      }
      if (sp.years_exp === 0 && (sp.search_rank ?? 9999) < 600) {
        const r = {
          id: sid, sid, name: sp.full_name || `${sp.first_name} ${sp.last_name}`, pos: sp.position, team: normTeam(sp.team),
          bd: sp.birth_date || null, ageNow: sp.age, college: sp.college, draft: { year: nextSeason }, mv: 0, ecr: null,
          inj: {}, injBody: [], weeks: [], s: { cur: null, prev: null }, prospect: false, rookie: true, yearsExp: 0,
          injury: sp.injury_status || null,
        };
        recs.push(r);
        known.add(sid);
      }
    }
  }

  // 7. market -> ppg prior, per position
  const prior = {};
  for (const pos of POS) {
    const pairs = recs.filter((r) => r.pos === pos && r.mv > 0).map((r) => {
      const n = (r.s.cur?.g || 0) + PREV_W * (r.s.prev?.g || 0);
      if (n < 8) return null;
      const ppg = ((r.s.cur?.ppg || 0) * (r.s.cur?.g || 0) + PREV_W * (r.s.prev?.ppg || 0) * (r.s.prev?.g || 0)) / n;
      return [r.mv, ppg];
    }).filter(Boolean);
    prior[pos] = fitLog(pairs);
  }

  // 8. projections
  for (const r of recs) {
    const { cur: c, prev: pv } = r.s;
    const gC = c?.g || 0, gP = pv?.g || 0;
    const nEff = gC + PREV_W * gP;
    r.nEff = nEff;
    r.age = r.bd ? ageOn(r.bd, sept1) : (r.ageNow != null ? r.ageNow + (sept1 - Date.now()) / (365.25 * 864e5) : (r.prospect ? 21.8 : null));
    r.yearsExp = r.yearsExp ?? (r.draft.year ? nextSeason - r.draft.year : null);
    let base = nEff ? ((c?.ppg || 0) * gC + PREV_W * (pv?.ppg || 0) * gP) / nEff : 0;
    if (c?.last6 != null) base = 0.8 * base + 0.2 * c.last6;
    r.trailingPpg = nEff ? base : null;
    const pr = r.mv > 0 ? prior[r.pos](r.mv) : 5;
    const rel = nEff / (nEff + 5);
    const baseR = nEff ? rel * base + (1 - rel) * pr : pr;
    let mult = ageMult(r.pos, r.age);
    if (r.rookie && !nEff) mult *= 0.85; // rookie-year production discount
    let trend = 1;
    const l4 = c?.last4;
    if (l4) {
      const share = r.pos === 'RB' ? (l4.cs - l4.eCs) / 3 + (l4.ts - l4.eTs) : (l4.ts - l4.eTs);
      const snapT = (l4.snap ?? 0) - (l4.eSnap ?? l4.snap ?? 0);
      trend = 1 + clamp(0.003 * snapT + 0.006 * share, -0.06, 0.08);
      r.trend = { snap: snapT, share, ppg: l4.ppg - l4.ePpg };
    }
    r.proj = baseR * mult * trend;
    r.mult = mult;
    // availability
    let gp = 0, missed = 0;
    for (const v of Object.values(r.inj)) { gp += v[0]; missed += v[1]; }
    r.missRate = (missed + BASE_MISS[r.pos] * 6) / (gp + missed + 6);
    r.missed = missed; r.possible = gp + missed;
    r.expGames = 17 * (1 - r.missRate);
    // weekly shape (latest season if enough games)
    const src = (c && c.g >= 5) ? c : (pv || c);
    const scale = r.trailingPpg ? r.proj / r.trailingPpg : 1;
    r.ceilWeek = src ? src.p90 * scale : r.proj * 1.6;
    r.floorWeek = src ? src.p25 * scale : r.proj * 0.5;
    r.consistency = nEff ? (((c?.start || 0) * gC + PREV_W * (pv?.start || 0) * gP) / nEff) : null;
    r.boomRate = nEff ? (((c?.strong || 0) * gC + PREV_W * (pv?.strong || 0) * gP) / nEff) : null;
    r.bustRate = nEff ? (((c?.bust || 0) * gC + PREV_W * (pv?.bust || 0) * gP) / nEff) : null;
    r.cv = src?.cv ?? null;
  }

  // 9. replacement level and value over replacement
  const repl = {};
  for (const pos of POS) {
    const pool = recs.filter((r) => r.pos === pos && !r.prospect && (r.nEff > 0 || r.mv > 0)).map((r) => r.proj).sort((a, b) => b - a);
    repl[pos] = pool[Math.min(pool.length - 1, Math.round(demand[pos]))] || 0;
  }
  for (const r of recs) {
    const rp = repl[r.pos];
    r.repl = rp;
    r.vorp = (r.proj - rp) * r.expGames;
    let ppg = r.proj, dyn = 0;
    r.years = [];
    for (let y = 0; y < 3; y++) {
      if (y > 0) ppg *= ageMult(r.pos, (r.age ?? 26) + y) * (r.rookie && y === 1 && !r.nEff ? 1.12 : 1);
      r.years.push(ppg);
      const v = (ppg - rp) * r.expGames;
      dyn += YEAR_DISC[y] * (v > 0 ? v : v * 0.3);
    }
    r.dyn = dyn;
  }

  // 10. team context (latest season) -> supporting cast
  const tctx = data.teamCtx?.[String(cur)] || {};
  const teamList = Object.keys(tctx);
  const tPpg = pctRanks(teamList.map((t) => tctx[t].ppg));
  const tQb = pctRanks(teamList.map((t) => tctx[t].qbppg));
  const tPos = Object.fromEntries(POS.map((pos) => [pos, pctRanks(teamList.map((t) => tctx[t].fp[pos] || 0))]));
  const castOf = {};
  teamList.forEach((t, i) => { castOf[t] = { ppg: tPpg[i], qb: tQb[i], pos: Object.fromEntries(POS.map((p) => [p, tPos[p][i]])) }; });
  for (const r of recs) {
    const t = tctx[r.team], cp = castOf[r.team];
    r.cast = t ? {
      teamPpg: t.ppg, qbPpg: t.qbppg, qb: t.qb, passAtt: t.pa, rushAtt: t.ra, posPts: t.fp[r.pos],
      score: r.pos === 'QB' ? 0.6 * cp.ppg + 0.4 * cp.pos.WR : 0.45 * cp.ppg + 0.35 * cp.qb + 0.2 * cp.pos[r.pos],
    } : null;
  }

  // 11. role, risk, grades, flags
  for (const r of recs) {
    const s = (r.s.cur && r.s.cur.g >= 3) ? r.s.cur : (r.s.prev || r.s.cur);
    r.role = s ? {
      snap: s.snap, ts: s.ts, cs: s.cs, tgt: s.tgt, car: s.car, rec: s.rec, att: s.att,
      metric: r.pos === 'QB' ? (s.snap ?? 0) + 3 * s.car
        : r.pos === 'RB' ? (s.snap ?? 0) + s.cs + 2 * s.ts
          : r.pos === 'WR' ? 0.5 * (s.snap ?? 0) + 2.5 * s.ts : 0.6 * (s.snap ?? 0) + 3 * s.ts,
    } : null;
    // risk 0-100
    const parts = [];
    const add = (pts, why) => { if (pts > 0) parts.push([pts, why]); };
    add(Math.min(35, Math.max(0, r.missRate - BASE_MISS[r.pos]) * 120 + r.missRate * 25), `misses ${Math.round(r.missRate * 100)}% of games`);
    const soft = r.injBody.filter(([b, n]) => SOFT_TISSUE.test(b) && n >= 2);
    if (soft.length) add(8, `recurring ${soft.map(([b]) => b.toLowerCase()).join('/')}`);
    if (r.age != null && r.age >= CLIFF[r.pos]) add(Math.min(25, (Math.floor(r.age) - CLIFF[r.pos] + 1) * 8), `age ${Math.floor(r.age)} ${r.pos}`);
    const hurt = r.rosterStatus === 'RES' || ['IR', 'Out', 'PUP', 'Sus', 'Doubtful'].includes(r.injury);
    if (hurt) add(12, r.injury ? `currently ${r.injury}` : 'on reserve/IR now');
    if (r.pos === 'RB' && r.role?.snap != null && r.role.snap < 50) add(8, 'committee back');
    if (r.cv != null && r.cv > 0.75 && r.pos !== 'QB') add(6, 'week-to-week volatility');
    if (!r.prospect && r.nEff < 6) add(10, 'small NFL sample');
    if (r.prospect) add(25, 'pre-draft: landing spot unknown');
    if (!r.prospect && (r.team === 'FA' || !r.team)) add(10, 'no team');
    r.risk = { score: Math.min(100, Math.round(parts.reduce((x, [p]) => x + p, 0))), parts };
    r.risk.label = r.risk.score < 22 ? 'Low' : r.risk.score < 42 ? 'Medium' : 'High';
    r.hurt = hurt;
  }

  // grades: percentile within a relevant pool at the position
  const POOL = { QB: 48, RB: 80, WR: 110, TE: 50 };
  for (const pos of POS) {
    const pool = recs.filter((r) => r.pos === pos).sort((a, b) => (b.dyn + b.vorp) - (a.dyn + a.vorp)).slice(0, POOL[pos] * 2);
    const vets = pool.filter((r) => r.nEff > 0);
    const g = (arr, f) => { const pr = pctRanks(arr.map(f)); return new Map(arr.map((r, i) => [r, pr[i]])); };
    const out = g(pool, (r) => r.proj), dy = g(pool, (r) => r.dyn);
    const ceil = g(vets, (r) => r.ceilWeek), cons = g(vets, (r) => r.consistency ?? 0);
    const role = g(vets.filter((r) => r.role), (r) => r.role.metric);
    const cast = g(pool.filter((r) => r.cast), (r) => r.cast.score);
    for (const r of recs.filter((x) => x.pos === pos)) {
      r.grades = {
        outlook: letter(out.get(r) ?? 0.05), dynasty: letter(dy.get(r) ?? 0.05),
        ceiling: ceil.has(r) ? letter(ceil.get(r)) : '–', floor: cons.has(r) ? letter(cons.get(r)) : '–',
        role: role.has(r) ? letter(role.get(r)) : '–', cast: cast.has(r) ? letter(cast.get(r)) : '–',
        safety: letter(1 - r.risk.score / 100 - 0.05),
      };
    }
  }

  const byId = new Map(recs.map((r) => [r.id, r]));
  // what a rookie pick slot (1 = 1.01) is worth on the market, from the consensus ECR of each pick slot
  const pickEcr = data.pickEcr || [];
  const pickValue = (overall) => {
    const k = overall - 1;
    const ecr = k < pickEcr.length ? pickEcr[k] : (pickEcr[pickEcr.length - 1] || 150) + (k - pickEcr.length + 1) * 8;
    return valueAtEcr(ecr);
  };
  const model = { profiles: recs, byId, demand, repl, thr, nextSeason, cur, prev, sf, tep, cfg, pickValue };
  rank(model, { horizon: 0.5, marketTrust: 0.4 });
  for (const r of recs) r.flags = flagsFor(r, model);
  return model;
}

/** Re-rank with a time horizon (0 win-now .. 1 dynasty) and trust in market (0 model .. 1 market). Cheap. */
export function rank(model, { horizon = 0.5, marketTrust = 0.4 } = {}) {
  const recs = model.profiles;
  const soft = (x) => (x > 0 ? x : x * 0.2);
  const maxV = Math.max(...recs.map((r) => soft(r.vorp)), 1);
  const maxD = Math.max(...recs.map((r) => soft(r.dyn)), 1);
  const maxM = Math.max(...recs.map((r) => r.mv), 1);
  for (const r of recs) {
    r.idx = {
      now: 100 * soft(r.vorp) / maxV, dyn: 100 * soft(r.dyn) / maxD, market: 100 * r.mv / maxM,
    };
    r.idx.model = (1 - horizon) * r.idx.now + horizon * r.idx.dyn;
    r.score = (1 - marketTrust) * r.idx.model + marketTrust * r.idx.market;
  }
  const sorted = [...recs].sort((a, b) => b.score - a.score);
  sorted.forEach((r, i) => { r.rank = i + 1; });
  const posCount = {};
  for (const r of sorted) { posCount[r.pos] = (posCount[r.pos] || 0) + 1; r.posRank = posCount[r.pos]; }
  [...recs].sort((a, b) => b.mv - a.mv).forEach((r, i) => { r.mktRank = r.mv > 0 ? i + 1 : null; });
  [...recs].sort((a, b) => b.proj - a.proj).forEach((r, i) => { r.projRank = i + 1; });
  const posProj = {};
  [...recs].sort((a, b) => b.proj - a.proj).forEach((r) => { posProj[r.pos] = (posProj[r.pos] || 0) + 1; r.posProjRank = posProj[r.pos]; });
  assignTiers(sorted.slice(0, 360), 'tier');
  for (const pos of POS) assignTiers(sorted.filter((r) => r.pos === pos).slice(0, 90), 'posTier');
  model.sorted = sorted;
  model.weights = { horizon, marketTrust };
  return sorted;
}

function assignTiers(list, key) {
  if (!list.length) return;
  const gaps = list.slice(1).map((r, i) => list[i].score - r.score);
  const typical = mean(gaps.slice(0, 120)) || 1;
  let tier = 1, size = 0;
  list[0][key] = 1;
  for (let i = 1; i < list.length; i++) {
    size++;
    if (gaps[i - 1] > typical * 2.3 || size >= 16) { tier++; size = 0; }
    list[i][key] = tier;
  }
}

function flagsFor(r, model) {
  const f = [];
  const add = (label, tone, why) => f.push({ label, tone, why });
  const age = r.age != null ? Math.floor(r.age) : null;
  if (r.prospect) add('Pre-draft prospect', 'info', `Consensus rookie #${r.prospectRank}. Grades come from rankings until the NFL draft sets landing spot and draft capital.`);
  if (r.note) add('Check status', 'warn', r.note);
  const c = r.s.cur, pv = r.s.prev;
  const rising = c && pv && c.g >= 4 && pv.g >= 4 && c.ppg > pv.ppg * 1.25;
  if (age != null && age <= 24 && (r.yearsExp ?? 9) <= 2 && !r.prospect &&
    ((r.draft.round && r.draft.round <= 2) || rising || (r.trend && (r.trend.snap > 8 || r.trend.share > 4))) && r.posProjRank > 6) {
    add('Breakout candidate', 'good', `Age ${age}, ${r.yearsExp ?? 0} yrs in, ${r.draft.round ? `round ${r.draft.round} pick` : 'rising usage'}${rising ? ', PPG up 25%+ this year' : ''}.`);
  }
  if (age != null && age >= CLIFF[r.pos] && r.posProjRank <= 30) add('Age cliff', 'bad', `${r.pos}s typically decline from ${CLIFF[r.pos]}. Value now, sell before it drops.`);
  else if (age != null && age === CLIFF[r.pos] - 1 && r.posProjRank <= 24) add('Sell window', 'warn', `One year from the usual ${r.pos} decline age (${CLIFF[r.pos]}).`);
  if (r.missRate >= 0.2 && r.possible >= 8) add('Injury risk', 'bad', `Missed ${r.missed} of ${r.possible} games over two seasons.`);
  const soft = r.injBody.filter(([b, n]) => SOFT_TISSUE.test(b) && n >= 2);
  if (soft.length) add('Soft-tissue history', 'warn', soft.map(([b, n]) => `${b} on report ${n} wks`).join(', '));
  if (r.hurt) add('Injured now', 'bad', r.injury ? `Sleeper status: ${r.injury}` : 'On reserve/IR in the latest roster report.');
  if (r.consistency != null && r.nEff >= 6) {
    if (r.consistency >= 0.7 && (r.cv ?? 1) < 0.5) add('Steady floor', 'good', `Startable in ${Math.round(r.consistency * 100)}% of games.`);
    else if ((r.boomRate ?? 0) >= 0.3 && (r.bustRate ?? 0) >= 0.3) add('Boom/bust', 'warn', `Top-half starter ${Math.round(r.boomRate * 100)}% of weeks but outside startable ${Math.round(r.bustRate * 100)}%.`);
  }
  if (r.pos === 'RB' && r.role?.cs >= 60) add('Workhorse', 'good', `${Math.round(r.role.cs)}% of team carries.`);
  if (r.pos === 'RB' && r.role?.snap != null && r.role.snap < 50 && r.nEff >= 4) add('Committee', 'warn', `${Math.round(r.role.snap)}% snap share.`);
  if ((r.pos === 'WR' || r.pos === 'TE') && r.role?.ts >= 24) add('Target hog', 'good', `${Math.round(r.role.ts)}% target share.`);
  if (r.pos === 'QB' && r.role?.car >= 5.5) add('Rushing floor', 'good', `${r.role.car.toFixed(1)} rush att/game.`);
  if (r.pos === 'TE' && model.tep && (r.role?.rec ?? 0) >= 4) add('TE premium boost', 'good', `${r.role.rec.toFixed(1)} catches/game × +${model.tep}/rec.`);
  if (r.trend && Math.abs(r.trend.snap) >= 10) add(r.trend.snap > 0 ? 'Role growing' : 'Role shrinking', r.trend.snap > 0 ? 'good' : 'bad', `Snap share ${r.trend.snap > 0 ? '+' : ''}${Math.round(r.trend.snap)} pts over the last 4 games.`);
  if (!r.prospect && r.nEff > 0 && r.nEff < 6) add('Small sample', 'warn', `${Math.round(r.nEff)} weighted games of data.`);
  if (r.draft.round >= 4 && (r.yearsExp ?? 9) <= 2 && !r.prospect) add('Day 3 pick', 'info', `Round ${r.draft.round}: teams invest less, so the role can vanish faster.`);
  if (r.mktRank && r.rank <= 220) {
    const d = r.mktRank - r.rank;
    if (d >= 20) add('Model > market', 'good', `Model rank ${r.rank} vs market ${r.mktRank}: likely available later than he should be.`);
    else if (d <= -25) add('Market > model', 'warn', `Market rank ${r.mktRank} vs model ${r.rank}: you'd pay for name value.`);
  }
  if (r.team === 'FA' && !r.prospect) add('Free agent', 'warn', 'No NFL team right now.');
  return f;
}

/** Best possible starting lineup (projected PPG) from a set of profiles. Greedy: strict slots first, then flex. */
export function bestLineup(profiles, lineup, key = 'proj') {
  const order = [...lineup].sort((a, b) => rankSlot(a) - rankSlot(b));
  const pool = [...profiles].filter((p) => p && !p.prospect).sort((a, b) => (b[key] || 0) - (a[key] || 0));
  const used = new Set();
  const filled = [];
  let total = 0;
  const ELIG = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'] };
  for (const slot of order) {
    const p = pool.find((x) => !used.has(x.id) && (ELIG[slot] || []).includes(x.pos));
    if (p) { used.add(p.id); total += p[key] || 0; }
    filled.push({ slot, p: p || null });
  }
  return { total, filled };
}
const rankSlot = (s) => ({ QB: 0, RB: 0, WR: 0, TE: 0, WRRB_FLEX: 1, REC_FLEX: 1, FLEX: 2, SUPER_FLEX: 3 }[s] ?? 4);

export const fmtAge = (a) => (a == null ? '–' : round(a, 1).toFixed(1));
