// Player outlook: how he is producing, whether it will last, strengths, risks, rest-of-season schedule,
// and where his next three seasons are headed. Everything is in the league's own scoring. Pure module.
import { POS, clamp, mean, sum, fmt, ordinal, normTeam } from './util.js';
import { defenseVsPosition } from './weekly.js';
import { CLIFF } from './model.js';

const PEAK = { QB: [25, 33], RB: [22, 26], WR: [23, 28], TE: [25, 29] };
const SOFT = /hamstring|groin|calf|quad|achilles/i;
const OUT = new Set(['Out', 'IR', 'PUP', 'Sus', 'NFI', 'DNR']);
const pct = (x) => `${Math.round(x * 100)}%`;
const first = (p) => p.name.split(' ')[0];
const opps = (pos, w) => (pos === 'QB' ? (w.att || 0) + (w.car || 0) : pos === 'RB' ? (w.car || 0) + (w.tgt || 0) : (w.tgt || 0));
const oppWord = { QB: 'pass attempts and rushes', RB: 'touches and targets', WR: 'targets', TE: 'targets' };

/** Decay-weighted current-season scoring rate, pulled toward the season average. */
export function currentForm(p, season) {
  const cur = p.weeks.filter((w) => w.s === season);
  const n = cur.length;
  if (!n) return null;
  let num = 0, den = 0;
  cur.forEach((w, i) => { const wt = 0.85 ** (n - 1 - i); num += wt * w.pts; den += wt; });
  const seasonRate = mean(cur.map((w) => w.pts));
  return (n * (num / den) + 3 * seasonRate) / (n + 3);
}

/**
 * Shared context for outlooks in one league: per-position norms, defense-vs-position, rest-of-season table.
 * opts: {nextWeek: first unplayed NFL week, playoffStart: fantasy playoff start week (default 15), schedule}
 */
export function outlookContext(M, data, opts = {}) {
  const season = M.cur;
  const schedule = opts.schedule || data.schedule || [];
  const lastPlayed = Math.max(0, ...schedule.filter((r) => r[9] != null).map((r) => r[0]));
  const nextWeek = opts.nextWeek || lastPlayed + 1;
  const playoffStart = opts.playoffStart || 15;
  const lastWeek = Math.min(18, opts.lastWeek || playoffStart + 2);
  const key = `${nextWeek}|${playoffStart}|${lastWeek}`;
  M._outlook ||= {};
  if (M._outlook[key]) return M._outlook[key];
  const dvp = defenseVsPosition(M, season);

  // norms: TD rate, TD share of points, yards per opportunity, season PPG lists for ranking
  const norms = {};
  for (const pos of POS) {
    const rows = [];
    for (const p of M.profiles) {
      if (p.pos !== pos) continue;
      const ws = p.weeks.filter((w) => w.s === season);
      if (ws.length < 4) continue;
      const o = sum(ws.map((w) => opps(pos, w)));
      rows.push({ p, g: ws.length, ppg: mean(ws.map((w) => w.pts)), pts: sum(ws.map((w) => w.pts)), tdPts: sum(ws.map((w) => w.tdPts || 0)), td: sum(ws.map((w) => w.td || 0)), yd: sum(ws.map((w) => w.yd || 0)), opp: o });
    }
    const vol = rows.filter((r) => r.opp >= 25);
    norms[pos] = {
      tdPerOpp: sum(vol.map((r) => r.td)) / Math.max(1, sum(vol.map((r) => r.opp))),
      tdShare: sum(vol.map((r) => r.tdPts)) / Math.max(1, sum(vol.map((r) => r.pts))),
      ydPerOpp: sum(vol.map((r) => r.yd)) / Math.max(1, sum(vol.map((r) => r.opp))),
      ppg: rows.map((r) => r.ppg).sort((a, b) => b - a),
      years: [0, 1, 2].map((k) => M.profiles.filter((x) => x.pos === pos && !x.prospect && x.years?.[k] != null).map((x) => x.years[k]).sort((a, b) => b - a)),
    };
  }
  // team schedule for the rest of the fantasy season
  const games = new Map();
  for (const r of schedule) {
    if (r[0] < nextWeek || r[0] > lastWeek) continue;
    games.set(`${r[0]}|${r[3]}`, { wk: r[0], opp: r[4], home: false });
    games.set(`${r[0]}|${r[4]}`, { wk: r[0], opp: r[3], home: true });
  }
  const weeksLeft = [];
  for (let w = nextWeek; w <= lastWeek; w++) weeksLeft.push(w);
  const matchMult = (pos, opp) => {
    const d = dvp.per[opp];
    if (!d || !(dvp.avg[pos] > 0)) return 1;
    const ratio = d.pts[pos] / dvp.avg[pos];
    return clamp(1 + 0.5 * (ratio - 1) * (d.n / (d.n + 4)), 0.85, 1.15);
  };
  const scheduleFor = (pos, team) => weeksLeft.map((wk) => {
    const g = games.get(`${wk}|${team}`);
    if (!g) return { wk, bye: true, playoff: wk >= playoffStart };
    const m = matchMult(pos, g.opp);
    const rk = dvp.rank[g.opp]?.[pos];
    return { ...g, mult: m, rank: rk, tone: m >= 1.04 ? 'good' : m <= 0.96 ? 'bad' : 'muted', playoff: wk >= playoffStart };
  });
  // rest-of-season PPG for everyone, so ranks are comparable (empty once the fantasy season is over)
  const ros = new Map();
  if (weeksLeft.length) for (const p of M.profiles) {
    if (p.prospect || !POS.includes(p.pos)) continue;
    const form = currentForm(p, season);
    if (form == null) continue;
    const team = normTeam(p.team);
    const sch = scheduleFor(p.pos, team);
    const played = sch.filter((g) => !g.bye);
    const mult = played.length ? mean(played.map((g) => g.mult)) : 1;
    const po = sch.filter((g) => g.playoff && !g.bye);
    // half of any touchdown over/under-performance is expected to wash out
    let tdAdj = 0;
    const ws = p.weeks.filter((w) => w.s === season);
    const o = sum(ws.map((w) => opps(p.pos, w)));
    if (ws.length >= 4 && o >= 20) {
      const td = sum(ws.map((w) => w.td || 0)), tdPts = sum(ws.map((w) => w.tdPts || 0));
      const perTd = td ? tdPts / td : (p.pos === 'QB' ? 4 : 6);
      tdAdj = clamp(0.5 * ((o * norms[p.pos].tdPerOpp - td) * perTd) / ws.length, -3, 2);
    }
    ros.set(p.id, { form, tdAdj, ppg: Math.max(0, form * mult + tdAdj), mult, playoffMult: po.length ? mean(po.map((g) => g.mult)) : null, sch, games: played.length });
  }
  for (const pos of POS) {
    const list = [...ros.entries()].filter(([id]) => M.byId.get(id)?.pos === pos).sort((a, b) => b[1].ppg - a[1].ppg);
    list.forEach(([, r], i) => { r.rank = i + 1; });
  }
  const ctx = { season, nextWeek, playoffStart, lastWeek, dvp, norms, ros, scheduleFor, weeksLeft };
  M._outlook[key] = ctx;
  return ctx;
}

const rankIn = (sortedDesc, v) => 1 + sortedDesc.filter((x) => x > v + 1e-9).length;

/** Direction of a player's role over the last 4 games: snaps and share of team opportunities together. */
export function roleDirection(tr) {
  if (!tr) return null;
  if ((tr.snap >= 8 && tr.share >= -1) || (tr.share >= 4 && tr.snap >= -3)) return 'up';
  if ((tr.snap <= -8 && tr.share <= 1) || (tr.share <= -4 && tr.snap <= 3)) return 'down';
  if (Math.abs(tr.snap) >= 8 || Math.abs(tr.share) >= 4) return 'mixed';
  return null;
}

function seasonBox(p, season) {
  const ws = p.weeks.filter((w) => w.s === season);
  if (!ws.length) return null;
  const o = sum(ws.map((w) => opps(p.pos, w)));
  return { ws, g: ws.length, pts: sum(ws.map((w) => w.pts)), tdPts: sum(ws.map((w) => w.tdPts || 0)), td: sum(ws.map((w) => w.td || 0)), yd: sum(ws.map((w) => w.yd || 0)), opp: o, oppPg: o / ws.length };
}

/** Role in the fantasy lineup, from rest-of-season rank vs how many starters the league uses at the position. */
export function lineupRole(p, M, rosRank) {
  const d = M.demand[p.pos] || 12;
  if (rosRank == null) {
    if (p.prospect) return { label: 'Prospect', tone: 'info' };
    if ((p.idx?.dyn ?? 0) > 20 || (p.age ?? 30) <= 23) return { label: 'Stash', tone: 'info' };
    return { label: 'Bench', tone: 'muted' };
  }
  if (rosRank <= Math.max(2, Math.round(d * 0.4))) return { label: 'Every-week starter', tone: 'good' };
  if (rosRank <= Math.round(d * 0.85)) return { label: 'Starter', tone: 'good' };
  if (rosRank <= Math.round(d * 1.35)) return { label: 'Flex / matchup play', tone: 'warn' };
  if (rosRank <= Math.round(d * 2)) return { label: 'Bench depth', tone: 'muted' };
  if ((p.idx?.dyn ?? 0) > 15 || ((p.age ?? 30) <= 24 && (p.yearsExp ?? 9) <= 2)) return { label: 'Stash', tone: 'info' };
  return { label: 'Cut candidate', tone: 'bad' };
}

/** Full outlook for one player. status: optional live Sleeper status {injury, body}. */
export function playerOutlook(p, M, X, status = {}) {
  const pos = p.pos;
  const season = X.season;
  const N = X.norms[pos];
  const c = p.s?.cur, pv = p.s?.prev;
  const box = seasonBox(p, season);
  const R = X.ros.get(p.id) || null;
  const thr = M.thr[pos];
  const adv = [], risk = [];
  const A = (title, why, w = 1) => adv.push({ title, why, w });
  const K = (title, why, w = 1) => risk.push({ title, why, w });
  const injury = status.injury ?? p.injury ?? null;
  const body = status.body || null;
  const age = p.age != null ? Math.floor(p.age) : null;
  const nm = first(p);

  // ---------- what he's doing now ----------
  const now = [];
  let ppgRank = null;
  if (box && c) {
    ppgRank = box.g >= 4 ? rankIn(N.ppg, c.ppg) : null;
    now.push(`${p.name} is averaging ${fmt(c.ppg)} points per game in this league’s scoring over ${c.g} game${c.g === 1 ? '' : 's'}${ppgRank ? `, ${ordinal(ppgRank)} among ${pos}s` : ''}.`);
    if (pos === 'QB') now.push(`He’s throwing ${fmt(c.att, 1)} passes and running ${fmt(c.car, 1)} times a game${c.car >= 5 ? ', and that rushing volume is a weekly floor most QBs don’t have' : ''}.`);
    else if (pos === 'RB') now.push(`He handles ${Math.round(c.cs)}% of his team’s carries (${fmt(c.car, 1)} a game) and sees ${fmt(c.tgt, 1)} targets a game${c.snap != null ? ` on ${Math.round(c.snap)}% of snaps` : ''}.`);
    else now.push(`He’s earning ${Math.round(c.ts)}% of his team’s targets (${fmt(c.tgt, 1)} a game, ${fmt(c.rec, 1)} catches)${c.snap != null ? ` on ${Math.round(c.snap)}% of snaps` : ''}${pos === 'TE' && M.tep ? `, and every catch is worth ${1 + M.tep} points here` : ''}.`);
    if (c.g >= 4) now.push(`He’s been a startable ${pos} (top ${thr.start}) in ${pct(c.start)} of games and a top-${thr.strong} week ${pct(c.strong)} of the time, with a typical range of ${fmt(c.p25)}–${fmt(c.p90)} points.`);
    const l4 = c.last4;
    if (l4 && l4.ePpg != null) {
      const d = l4.ppg - l4.ePpg;
      const roleBits = [];
      if (l4.snap != null && l4.eSnap != null && Math.abs(l4.snap - l4.eSnap) >= 5) roleBits.push(`snap share ${l4.snap > l4.eSnap ? 'up' : 'down'} to ${Math.round(l4.snap)}%`);
      if (pos !== 'QB' && Math.abs(l4.ts - l4.eTs) >= 3) roleBits.push(`target share ${l4.ts > l4.eTs ? 'up' : 'down'} to ${Math.round(l4.ts)}%`);
      if (pos === 'RB' && Math.abs(l4.cs - l4.eCs) >= 8) roleBits.push(`carry share ${l4.cs > l4.eCs ? 'up' : 'down'} to ${Math.round(l4.cs)}%`);
      now.push(`Over his last four games he’s at ${fmt(l4.ppg)} PPG, ${Math.abs(d) < 1.5 ? 'right in line with' : d > 0 ? 'up from' : 'down from'} ${fmt(l4.ePpg)} before${roleBits.length ? `, with ${roleBits.join(' and ')}` : ''}.`);
    }
  } else if (pv && pv.g) {
    now.push(`${p.name} hasn’t played this season${injury ? ` (${injury}${body ? `, ${body.toLowerCase()}` : ''})` : ''}. Last year he averaged ${fmt(pv.ppg)} PPG in this scoring over ${pv.g} games.`);
  } else if (p.prospect) {
    now.push(`${p.name} is a ${p.draft?.year || M.nextSeason} rookie prospect out of ${p.college || 'college'}, ranked ${ordinal(p.prospectRank)} on the consensus rookie board.${p.note ? ` ${p.note}` : ''}`);
  } else {
    now.push(`${p.name} has no NFL production in the data yet${p.rookie ? ' as a rookie' : ''}.`);
  }

  // ---------- will it continue? ----------
  const cont = [];
  if (box && box.g >= 4 && box.opp >= 20) {
    const rate = box.td / box.opp;
    const exp = box.opp * N.tdPerOpp;
    const tdShare = box.pts > 0 ? box.tdPts / box.pts : 0;
    const perTd = box.td ? box.tdPts / box.td : (pos === 'QB' ? 4 : 6);
    const swing = ((exp - box.td) * perTd) / box.g; // PPG he'd gain (+) or lose (−) at a normal TD rate
    if (box.td >= 3 && rate >= 1.5 * N.tdPerOpp && swing <= -1.5) {
      cont.push(`Touchdowns are doing a lot of the work: ${pct(tdShare)} of his points come from scores (a typical ${pos} is ~${pct(N.tdShare)}), and he’s scored on ${(rate * 100).toFixed(1)}% of his ${oppWord[pos]} against a ${(N.tdPerOpp * 100).toFixed(1)}% norm. At a normal rate he’d be about ${fmt(Math.abs(swing))} PPG lower, so expect some cooling.`);
      K('Touchdown-dependent', `${pct(tdShare)} of his points are from TDs vs ~${pct(N.tdShare)} for a typical ${pos}; a normal TD rate would cost ~${fmt(Math.abs(swing))} PPG.`, 1.2);
    } else if (box.opp / box.g >= (pos === 'QB' ? 30 : pos === 'RB' ? 14 : 6) && rate <= 0.6 * N.tdPerOpp && swing >= 1.2) {
      cont.push(`He’s been unlucky in the end zone: ${box.td} TD${box.td === 1 ? '' : 's'} on ${Math.round(box.opp)} ${oppWord[pos]}, well under the ${pos} norm. Volume like his usually converts, which is worth about +${fmt(swing)} PPG if it evens out.`);
      A('Positive TD regression', `Scoring rate is well below normal for his volume; worth ~+${fmt(swing)} PPG if it evens out.`, 1.1);
    } else {
      cont.push(`His scoring isn’t propped up by touchdown luck: ${pct(tdShare)} of his points come from TDs, close to the ${pos} norm, so the production is mostly volume-driven.`);
    }
    const ypo = box.yd / box.opp;
    if (N.ydPerOpp > 0 && box.opp >= 40) {
      const r = ypo / N.ydPerOpp;
      if (r >= 1.25) cont.push(`He’s efficient at ${fmt(ypo, 1)} yards per ${pos === 'QB' ? 'play' : pos === 'RB' ? 'touch' : 'target'} (${pos} average ${fmt(N.ydPerOpp, 1)}). Elite efficiency tends to drift back a little, but it also earns more volume.`);
      else if (r <= 0.75) cont.push(`Efficiency is the weak spot at ${fmt(ypo, 1)} yards per ${pos === 'QB' ? 'play' : pos === 'RB' ? 'touch' : 'target'} (${pos} average ${fmt(N.ydPerOpp, 1)}); he needs the volume to stay to keep producing.`);
    }
  }
  const tr = p.trend;
  const dir = roleDirection(tr);
  const shareWord = pos === 'RB' ? 'touches' : 'targets';
  if (dir === 'up') cont.push(`The role is growing (snaps ${tr.snap >= 0 ? '+' : ''}${Math.round(tr.snap)} pts, share of ${shareWord} ${tr.share >= 0 ? '+' : ''}${fmt(tr.share, 1)} pts over the last four games), and usage tends to lead production.`);
  else if (dir === 'down') cont.push(`The role is shrinking (snaps ${Math.round(tr.snap)} pts, share of ${shareWord} ${fmt(tr.share, 1)} pts over the last four games), and that usually shows up in the box score next.`);
  else if (dir === 'mixed') cont.push(tr.snap < 0 ? `He’s playing fewer snaps (${Math.round(tr.snap)} pts) but getting more of the ${shareWord} when he’s on the field (+${fmt(tr.share, 1)} pts): fine while it lasts, but a smaller snap count is less stable.` : `He’s on the field more (+${Math.round(tr.snap)} pts of snaps) without more of the ${shareWord} yet (${fmt(tr.share, 1)} pts): opportunity is there if the looks follow.`);
  if (p.cast) {
    if (p.cast.score >= 0.7) cont.push(`He’s in a good offense (${fmt(p.cast.teamPpg)} points a game${p.cast.qb && pos !== 'QB' ? `, ${p.cast.qb} at QB` : ''}), which supports the scoring chances.`);
    else if (p.cast.score <= 0.3) cont.push(`The offense around him is a drag (${fmt(p.cast.teamPpg)} points a game${p.cast.qb && pos !== 'QB' ? `, ${p.cast.qb} at QB` : ''}), which caps his touchdown upside.`);
  }
  if (injury) cont.push(`He’s currently ${injury}${body ? ` with a ${body.toLowerCase()} injury` : ''}${SOFT.test(body || '') ? ', and soft-tissue injuries are the kind that linger and recur' : ''}.`);
  if (R) {
    const tone = R.mult >= 1.03 ? 'friendly' : R.mult <= 0.97 ? 'tough' : 'neutral';
    const po = R.playoffMult == null ? '' : R.playoffMult >= 1.03 ? ' The fantasy playoff matchups look good.' : R.playoffMult <= 0.97 ? ' The fantasy playoff matchups are tough.' : '';
    cont.push(`Net: about ${fmt(R.ppg)} PPG the rest of the way (${ordinal(R.rank)} among ${pos}s)${Math.abs(R.tdAdj) >= 0.5 ? `, after ${R.tdAdj < 0 ? 'some touchdown cooling' : 'some touchdown bounce-back'},` : ''} against a ${tone} schedule.${po}`);
  }

  // ---------- advantages ----------
  if (c && c.g >= 3) {
    if ((pos === 'WR' || pos === 'TE') && c.ts >= 22) A('Target hog', `${Math.round(c.ts)}% of team targets: volume is the most reliable predictor of fantasy points.`, 1.3);
    if (pos === 'RB' && c.cs >= 60) A('Workhorse', `${Math.round(c.cs)}% of team carries plus ${fmt(c.tgt, 1)} targets a game.`, 1.3);
    if (pos === 'RB' && c.tgt >= 4) A('Pass-game role', `${fmt(c.tgt, 1)} targets a game: catches are worth a full point here and hold up in losing game scripts.`);
    if (pos === 'QB' && c.car >= 5) A('Rushing floor', `${fmt(c.car, 1)} rushes a game: rushing yards and TDs are a weekly floor.`, 1.2);
    if (pos === 'TE' && M.tep && c.rec >= 4.5) A('Built for TE premium', `${fmt(c.rec, 1)} catches a game at ${1 + M.tep} points each.`, 1.2);
    if (c.snap != null && c.snap >= (pos === 'RB' ? 65 : pos === 'TE' ? 78 : 82) && pos !== 'QB') A('Every-down snaps', `On the field for ${Math.round(c.snap)}% of snaps.`);
    if (c.g >= 5 && c.start >= 0.7) A('Reliable floor', `Startable in ${pct(c.start)} of games.`, 1.1);
    if (c.g >= 5 && c.strong >= 0.35) A('Week-winning ceiling', `Top-${thr.strong} ${pos} in ${pct(c.strong)} of games; 90th-percentile week ${fmt(c.p90)} pts.`);
  }
  if (dir === 'up') A('Rising role', `Snap share ${tr.snap >= 0 ? '+' : ''}${Math.round(tr.snap)} pts${pos !== 'QB' ? `, share of opportunities ${tr.share >= 0 ? '+' : ''}${fmt(tr.share, 1)} pts` : ''} over the last 4 games.`, 1.1);
  if (p.cast?.score >= 0.75) A('Strong offense', `Team scores ${fmt(p.cast.teamPpg)} PPG; more drives and red-zone trips.`);
  if (R?.playoffMult >= 1.04) A('Soft playoff schedule', `Fantasy playoff opponents allow ${pct(R.playoffMult - 1)} more than average to ${pos}s.`);
  else if (R?.mult >= 1.04) A('Soft schedule ahead', `Remaining opponents allow ${pct(R.mult - 1)} more than average to ${pos}s.`);
  if (age != null && age <= PEAK[pos][0] && !p.prospect) A('Still ascending', `Will be ${age} next season: ${pos}s usually keep improving until ~${PEAK[pos][0] + 1}.`);
  if ((p.possible ?? 0) >= 20 && p.missRate <= 0.07) A('Durable', `Missed ${p.missed} of ${p.possible} possible games over two seasons.`);
  if (p.draft?.round === 1 && (p.yearsExp ?? 9) <= 3) A('First-round investment', `Round-1 draft capital: teams keep feeding players they paid for.`);
  if (p.mktRank && p.rank && p.mktRank - p.rank >= 20) A('Model likes him more than the market', `Model rank ${p.rank} vs market ${p.mktRank}: cheaper to acquire than his production says.`);

  // ---------- risks ----------
  if (OUT.has(injury) || injury === 'Doubtful') K('Injured now', `${injury}${body ? ` (${body})` : ''}.`, 1.5);
  else if (injury) K('Banged up', `${injury}${body ? ` (${body})` : ''}: check practice reports each week.`);
  if (p.missRate >= 0.18 && (p.possible ?? 0) >= 8) K('Injury history', `Missed ${p.missed} of ${p.possible} games over two seasons.`, 1.1);
  const soft = (p.injBody || []).filter(([b, n]) => SOFT.test(b) && n >= 2);
  if (soft.length) K('Recurring soft-tissue', soft.map(([b, n]) => `${b} on ${n} weekly reports`).join(', ') + '.');
  const y = p.years || [];
  if (age != null && age >= CLIFF[pos]) K('Age cliff', `Will be ${age} next season; ${pos}s usually decline from ${CLIFF[pos]}.${y.length === 3 ? ` Projected ${fmt(y[0])} → ${fmt(y[2])} PPG over three seasons.` : ''}`, 1.2);
  else if (age != null && age === CLIFF[pos] - 1) K('Sell window closing', `Will be ${age} next season, one year from the usual ${pos} decline age.`);
  if (pos === 'RB' && c?.snap != null && c.snap < 50 && c.g >= 3) K('Committee', `Only ${Math.round(c.snap)}% of snaps; touches depend on the split.`, 1.1);
  if (dir === 'down') K('Shrinking role', `Snap share ${Math.round(tr.snap)} pts${pos !== 'QB' ? `, share of ${shareWord} ${fmt(tr.share, 1)} pts` : ''} over the last 4 games.`, 1.2);
  if ((p.cv ?? 0) > 0.75 && pos !== 'QB' && c?.g >= 5) K('Volatile', `Week-to-week swings are large (bust week ${pct(c.bust)} of the time).`);
  if (p.cast && p.cast.score <= 0.25) K('Weak offense', `Team scores ${fmt(p.cast.teamPpg)} PPG; limits TD chances.`);
  if (R?.playoffMult != null && R.playoffMult <= 0.96) K('Tough playoff schedule', `Fantasy playoff opponents allow ${pct(1 - R.playoffMult)} less than average to ${pos}s.`);
  if (!p.prospect && (p.nEff ?? 0) < 6) K('Small sample', `${Math.round(p.nEff || 0)} weighted games of NFL data.`);
  if (p.mktRank && p.rank && p.rank - p.mktRank >= 25) K('Priced above his production', `Market rank ${p.mktRank} vs model rank ${p.rank}: you pay for the name.`);
  if (p.draft?.round >= 4 && (p.yearsExp ?? 9) <= 2 && !p.prospect) K('Day-3 pick', `Round ${p.draft.round}: less job security if he slips.`);
  if (p.team === 'FA' && !p.prospect) K('No team', 'Not on an NFL roster right now.', 1.3);
  if (p.prospect) K('Landing spot unknown', 'Pre-draft: value swings with draft capital and depth chart.', 1.2);

  adv.sort((a, b) => b.w - a.w);
  risk.sort((a, b) => b.w - a.w);
  const role = lineupRole(p, M, R?.rank ?? null);
  const headline = `${role.label}${adv[0] ? `: ${adv[0].title.toLowerCase()}` : ''}${risk[0] ? `, but ${risk[0].title.toLowerCase()}` : ''}.`;
  const tl = [adv[0]?.title, risk[0] ? `${adv[0] ? 'but ' : ''}${risk[0].title.toLowerCase()}` : null].filter(Boolean).join(', ');
  const tagline = tl ? tl[0].toUpperCase() + tl.slice(1) : '';

  return { role, headline, tagline, now: now.join(' '), cont: cont.join(' '), adv, risk, ros: R, future: futureOutlook(p, M, X, { risk, injury }) };
}

/** Three-season projection, career phase and scenarios. */
export function futureOutlook(p, M, X, { risk = [] } = {}) {
  const pos = p.pos;
  const N = X.norms[pos];
  const yrs = p.years || [];
  const seasons = [0, 1, 2].map((k) => M.nextSeason + k);
  const path = yrs.map((ppg, k) => ({ season: seasons[k], ppg, rank: N.years[k]?.length ? rankIn(N.years[k], ppg) : null, age: p.age != null ? Math.floor(p.age) + k : null }));
  const age = p.age != null ? Math.floor(p.age) : null;
  const [lo, hi] = PEAK[pos];
  const phase = p.prospect ? 'Pre-draft' : age == null ? 'Unknown age' : age < lo ? 'Ascending' : age < hi ? 'Prime' : age === hi ? 'Late prime' : age <= CLIFF[pos] + 1 ? 'Decline phase' : 'Late career';
  const txt = [];
  if (p.prospect) {
    txt.push(`${p.name} is a top-${p.prospectRank} prospect in the ${p.draft?.year} class. Until the NFL draft, his value rests on consensus rankings; draft capital and landing spot will move it sharply in either direction.`);
    if (p.note) txt.push(p.note);
  } else if (path.length) {
    const p0 = path[0], p2 = path[path.length - 1];
    const dir = p2.ppg > p0.ppg * 1.04 ? 'climbing' : p2.ppg < p0.ppg * 0.9 ? 'fading' : 'holding steady';
    txt.push(`The model projects ${fmt(p0.ppg)} PPG in ${p0.season}${p0.rank ? ` (about ${pos}${p0.rank})` : ''}${age != null ? ` in his age-${age} season` : ''}, then ${path.slice(1).map((x) => `${fmt(x.ppg)} in ${x.season}`).join(' and ')}: ${dir} over the next three years.`);
    const phaseTxt = {
      Ascending: `He’s before the usual ${pos} peak (${lo}–${hi}), so growth is still likely if the role holds.`,
      Prime: `He’s in the ${pos} prime window (${lo}–${hi}): this is when he should produce his best seasons.`,
      'Late prime': `He’s at the end of the typical ${pos} prime; value is highest now and the market will start discounting him within a year.`,
      'Decline phase': `${pos}s usually decline from around ${CLIFF[pos]}. Expect lower production and steeper value drops each offseason.`,
      'Late career': `He’s well past the usual ${pos} decline age; every season is a bonus and trade value falls fast.`,
    }[phase];
    if (phaseTxt) txt.push(phaseTxt);
    if (p.draft?.round && (p.yearsExp ?? 9) <= 3) txt.push(p.draft.round <= 2 ? `Day-1/2 draft capital (round ${p.draft.round}) buys him patience from his team.` : `As a round-${p.draft.round} pick, his job is less protected if he slips.`);
    if (p.grades?.dynasty) txt.push(`Dynasty grade ${p.grades.dynasty}; market rank ${p.mktRank ?? '–'} overall vs model rank ${p.rank ?? '–'}.`);
  }
  // scenarios
  const c = p.s?.cur;
  const l4 = c?.last4;
  const base = yrs[0] ?? null;
  let bull = null, bear = null;
  if (base != null) {
    const upRate = Math.max(c?.p90 ? c.p90 * 0.62 : 0, l4?.ppg ?? 0, base * 1.12);
    bull = { ppg: upRate * (p.mult || 1), why: l4?.ppg > base ? 'his last-four-game role holds for a full season' : 'he hits his ceiling weeks more often with a bigger role' };
    const riskCut = clamp(risk.reduce((s, r) => s + 0.06 * r.w, 0), 0.08, 0.4);
    bear = { ppg: base * (1 - riskCut), why: risk.length ? risk.slice(0, 2).map((r) => r.title.toLowerCase()).join(' and ') : 'normal variance and a smaller role' };
    for (const s of [bull, bear]) s.rank = N.years[0]?.length ? rankIn(N.years[0], s.ppg) : null;
  }
  const watch = [];
  if (p.trend && Math.abs(p.trend.snap) >= 6) watch.push(`Snap share trend (${p.trend.snap > 0 ? '+' : ''}${Math.round(p.trend.snap)} pts lately)`);
  if (p.cast?.qb && pos !== 'QB') watch.push(`QB situation (${p.cast.qb})`);
  if (age != null && age >= hi) watch.push('Age-related decline and offseason roster moves');
  if ((p.missRate ?? 0) >= 0.15) watch.push('Health: missed-game rate above position norm');
  if (pos === 'RB' && (p.yearsExp ?? 0) >= 3) watch.push('Contract/backfield changes: RBs get replaced quickly');
  return { path, phase, text: txt.join(' '), bull, bear, watch };
}
