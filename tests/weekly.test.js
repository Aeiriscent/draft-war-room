// Weekly start/sit engine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildModel } from '../js/model.js';
import { normalizeConfig } from '../js/league.js';
import { buildWeek, projectWeek, optimize, winProb, scoreProjection, gamesForWeek, defenseVsPosition } from '../js/weekly.js';
import { easternToUtc, normTeam } from '../js/util.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/data.json', import.meta.url)));
const prospects = JSON.parse(fs.readFileSync(new URL('../data/prospects.json', import.meta.url)));
const M = buildModel(data, prospects, normalizeConfig({ teams: 12 }));
const season = data.meta.season;
const week = data.meta.week + 1;
const before = new Date(easternToUtc('2026-01-01', '00:00').getTime() - 1); // well before any kickoff this season
const W0 = buildWeek({ data, M, week, season, now: before });
const starters = M.profiles.filter((p) => p.weeks.some((w) => w.s === season) && ['QB', 'RB', 'WR', 'TE'].includes(p.pos)).slice(0, 400);

test('eastern kickoff to UTC handles DST', () => {
  assert.equal(easternToUtc('2026-11-29', '13:00').toISOString(), '2026-11-29T18:00:00.000Z');
  assert.equal(easternToUtc('2026-09-13', '13:00').toISOString(), '2026-09-13T17:00:00.000Z');
  assert.equal(normTeam('LAR'), 'LA');
});

test('schedule: both teams see the game, spread flips for the road team', () => {
  const g = gamesForWeek(data.schedule, week, data.stadiums);
  assert.ok(g.size >= 20 && g.size % 2 === 0);
  for (const x of g.values()) {
    const o = g.get(x.opp);
    assert.equal(o.opp, x.team);
    assert.equal(o.home, !x.home);
    if (x.spread != null) assert.equal(o.spread, -x.spread);
  }
});

test('defense vs position averages are sane', () => {
  const d = defenseVsPosition(M, season);
  assert.equal(d.teams, 32);
  for (const pos of ['QB', 'RB', 'WR', 'TE']) assert.ok(d.avg[pos] > 5 && d.avg[pos] < 60, pos + ' ' + d.avg[pos]);
});

test('projections: rescored in league scoring with TE premium', () => {
  const stats = { rec: 5, rec_yd: 50, rec_td: 0.5, pts_ppr: 13 };
  const sc = M.cfg.scoring;
  assert.equal(scoreProjection(stats, sc, 'TE'), 5 + 5 + 3 + 5);
  assert.equal(scoreProjection(stats, sc, 'WR'), 13);
  assert.equal(scoreProjection({ pts_ppr: 8.5 }, sc, 'K'), 8.5);
});

test('every player gets a finite, explained projection', () => {
  let withFactors = 0;
  for (const p of starters) {
    const e = projectWeek(p, W0);
    if (e.bye) { assert.equal(e.exp, 0); continue; }
    assert.ok(Number.isFinite(e.exp) && e.exp >= 0 && e.exp < 60, `${p.name} ${e.exp}`);
    assert.ok(e.floor <= e.exp && e.exp <= e.ceil);
    if (e.factors.length) withFactors++;
  }
  assert.ok(withFactors > starters.length * 0.6);
});

test('injury status and practice drive the chance to play', () => {
  const p = starters.find((x) => !x.injury && projectWeek(x, W0).exp > 8);
  const sleeper = (st) => ({ [p.sid]: { team: p.team, injury_status: st.inj, practice_participation: st.pr, injury_body_part: st.body } });
  const run = (st) => projectWeek(p, buildWeek({ data, M, week, season, now: before, sleeper: sleeper(st) }));
  const healthy = run({}), qFull = run({ inj: 'Questionable', pr: 'Full' }), qDnp = run({ inj: 'Questionable', pr: 'DNP', body: 'Hamstring' }), out = run({ inj: 'Out' });
  assert.ok(healthy.exp > qFull.exp && qFull.exp > qDnp.exp && qDnp.exp > out.exp);
  assert.equal(out.exp, 0);
  assert.ok(qDnp.factors.some((f) => f.label === 'Injury' && /hamstring/i.test(f.why)));
});

test('bad weather downgrades passers, Sleeper projection is blended in', () => {
  const qb = starters.filter((p) => p.pos === 'QB').map((p) => ({ p, e: projectWeek(p, W0) })).find(({ e }) => !e.bye && e.game.roof === 'outdoors');
  const g = qb.e.game;
  const wx = { [g.stadium + '|' + g.day]: { temp: 18, wind: 24, pop: 80, precip: 0.1 } };
  const bad = projectWeek(qb.p, buildWeek({ data, M, week, season, now: before, weather: wx }));
  assert.ok(bad.exp < qb.e.exp * 0.9);
  assert.ok(bad.factors.some((f) => f.label === 'Weather'));
  const proj = projectWeek(qb.p, buildWeek({ data, M, week, season, now: before, projections: { [qb.p.sid]: { pass_yd: 300, pass_td: 3, rush_yd: 20 } } }));
  assert.ok(Math.abs(proj.sleeperPts - (12 + 12 + 2)) < 1e-9);
  assert.ok(proj.exp > qb.e.exp || qb.e.form > 26);
});

test('optimizer fills superflex correctly, respects locks, risk modes move variance', () => {
  const entries = starters.slice(0, 60).map((p) => projectWeek(p, W0));
  const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX'];
  const b = optimize(entries, slots, 'balanced');
  assert.equal(b.filled.filter(Boolean).length, 10);
  b.filled.forEach((e, i) => assert.ok(({ QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'] })[slots[i]].includes(e.pos)));
  assert.equal(new Set(b.filled.map((e) => e.p.id)).size, 10);
  const u = optimize(entries, slots, 'upside'), s = optimize(entries, slots, 'safe');
  assert.ok(b.total >= u.total - 1e-9 && b.total >= s.total - 1e-9);
  const worst = entries.filter((e) => e.pos === 'RB' && !e.bye).sort((x, y) => x.exp - y.exp)[0];
  const lockedEntry = { ...worst, locked: true };
  const withLock = optimize(entries.map((e) => (e.p.id === worst.p.id ? lockedEntry : e)), slots, 'balanced', new Map([[worst.p.id, 1]]));
  assert.equal(withLock.filled[1].p.id, worst.p.id);
  assert.ok(winProb(b, { total: b.total - 20, sd: b.sd }) > 0.6);
  assert.ok(Math.abs(winProb(b, b) - 0.5) < 1e-6);
});
