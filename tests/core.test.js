// Run: npm test   (Node 20+)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildModel, rank, bestLineup } from '../js/model.js';
import { normalizeConfig, makeScorer, DEFAULT_SCORING, starterDemand } from '../js/league.js';
import { buildOrder, fromSleeper, boardState, teamRosters, recommend, survival, threats } from '../js/draft.js';
import { teamReport, leagueTable } from '../js/strategy.js';
import { cpuPick, assignPersonas, rng } from '../js/sim.js';
import { parseSleeperRef } from '../js/sleeper.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/data.json', import.meta.url)));
const prospects = JSON.parse(fs.readFileSync(new URL('../data/prospects.json', import.meta.url)));
const cfg = normalizeConfig({ teams: 12 });
const M = buildModel(data, prospects, cfg);

test('scoring: full PPR + TE premium + 4pt pass TD', () => {
  const score = makeScorer(data.meta.fields);
  const F = data.meta.fields;
  const row = [26, 1, 0, 1, ...F.map(() => 0)];
  const set = (k, v) => { row[4 + F.indexOf(k)] = v; };
  set('rec', 5); set('reyd', 60); set('retd', 1);
  assert.equal(score(row, DEFAULT_SCORING, 'WR').toFixed(1), '17.0');
  assert.equal(score(row, DEFAULT_SCORING, 'TE').toFixed(1), '22.0');
  const qb = [26, 1, 0, 1, ...F.map(() => 0)];
  qb[4 + F.indexOf('pyd')] = 250; qb[4 + F.indexOf('ptd')] = 2; qb[4 + F.indexOf('int')] = 1;
  assert.equal(score(qb, DEFAULT_SCORING, 'QB').toFixed(1), '17.0');
});

test('starter demand reflects superflex and TE premium', () => {
  const d = starterDemand(cfg);
  assert.ok(d.QB > 20 && d.QB < 25, `QB demand ${d.QB}`);
  assert.ok(d.TE > 15, `TE demand ${d.TE}`);
});

test('model builds sensible profiles', () => {
  assert.ok(M.profiles.length > 700);
  const top = M.sorted.slice(0, 24);
  assert.ok(top.every((p) => p.proj > 10), 'top players project double digits');
  for (const p of M.profiles) {
    assert.ok(Number.isFinite(p.score), `score for ${p.name}`);
    assert.ok(Number.isFinite(p.proj), `proj for ${p.name}`);
    assert.ok(p.grades && p.risk && Array.isArray(p.flags));
  }
  const pros = M.profiles.filter((p) => p.prospect);
  assert.ok(pros.length >= 40, 'prospects included');
  const old = M.profiles.find((p) => p.pos === 'RB' && p.age > 29 && p.proj > 10);
  if (old) assert.ok(old.flags.some((f) => f.label === 'Age cliff'));
});

test('re-ranking with sliders changes order but keeps everyone', () => {
  const now = rank(M, { horizon: 0, marketTrust: 0 }).map((p) => p.id);
  const dyn = rank(M, { horizon: 1, marketTrust: 0 }).map((p) => p.id);
  assert.equal(now.length, dyn.length);
  assert.notDeepEqual(now.slice(0, 30), dyn.slice(0, 30));
  rank(M, { horizon: 0.5, marketTrust: 0.4 });
});

test('snake, 3rd-round reversal and linear orders', () => {
  const sk = { 1: 'a', 2: 'b', 3: 'c', 4: 'd' };
  const snake = buildOrder({ teams: 4, rounds: 3, type: 'snake', slotKey: sk });
  assert.deepEqual(snake.map((o) => o.owner).join(''), 'abcddcbaabcd');
  const rr = buildOrder({ teams: 4, rounds: 4, type: 'snake', reversalRound: 3, slotKey: sk });
  assert.deepEqual(rr.map((o) => o.owner).join(''), 'abcddcbadcbaabcd');
  const lin = buildOrder({ teams: 4, rounds: 2, type: 'linear', slotKey: sk });
  assert.deepEqual(lin.map((o) => o.owner).join(''), 'abcdabcd');
  const traded = buildOrder({ teams: 4, rounds: 2, type: 'linear', slotKey: sk, traded: [{ round: 2, orig: 'a', owner: 'd' }] });
  assert.equal(traded[4].owner, 'd');
  assert.equal(traded[4].orig, 'a');
});

test('Sleeper draft normalisation, traded picks and my team', () => {
  const draft = {
    draft_id: '1', status: 'drafting', type: 'snake', season: '2027', settings: { teams: 3, rounds: 2, reversal_round: 0 },
    slot_to_roster_id: { 1: 5, 2: 6, 3: 7 }, draft_order: { u1: 1, u2: 2, u3: 3 }, metadata: { name: 'Test' },
  };
  const rosters = [{ roster_id: 5, owner_id: 'u1', players: [] }, { roster_id: 6, owner_id: 'u2', players: [] }, { roster_id: 7, owner_id: 'u3', players: [] }];
  const users = [{ user_id: 'u1', display_name: 'Me' }, { user_id: 'u2', display_name: 'Two' }, { user_id: 'u3', display_name: 'Three', metadata: { team_name: 'Team Three' } }];
  const sid = M.sorted.find((p) => p.sid).sid;
  const picks = [{ pick_no: 1, round: 1, draft_slot: 1, roster_id: 5, player_id: sid, metadata: { first_name: 'A', last_name: 'B', position: 'WR' } }];
  const traded = [{ round: 2, roster_id: 7, owner_id: 5, previous_owner_id: 7 }];
  const ctx = fromSleeper({ draft, picks, traded, rosters, users, myUserId: 'u1' });
  assert.equal(ctx.myKey, 'r5');
  assert.equal(ctx.teams.find((t) => t.key === 'r7').name, 'Team Three');
  assert.equal(ctx.order[3].owner, 'r5', 'round 2 first pick (slot 3) traded to me');
  const st = boardState(ctx);
  assert.equal(st.onClock.no, 2);
  assert.equal(st.myNext.no, 4);
  assert.equal(st.picksUntil, 2);
  const ro = teamRosters(ctx, st, M);
  assert.equal(ro.get('r5').drafted[0].p.sid, sid);
});

test('recommendations favour lineup needs and are well-formed', () => {
  const avail = M.sorted.slice(0, 200);
  const qbs = M.sorted.filter((p) => p.pos === 'QB').slice(0, 4);
  const recs = recommend({ available: avail.filter((p) => !qbs.includes(p)), myPlayers: qbs, lineup: cfg.lineup, picksUntil: 10, horizon: 0.5 });
  assert.ok(recs.length > 5);
  assert.ok(recs.every((r) => r.reasons.length && Number.isFinite(r.score)));
  assert.notEqual(recs[0].p.pos, 'QB', 'with 4 QBs rostered the top rec is not another QB');
  assert.ok(survival(1, 0) === 1 && survival(30, 5) > 0.9 && survival(2, 20) < 0.1);
});

test('full practice draft: CPU personas complete a 12x20 startup with sane rosters', () => {
  const sk = {}; for (let s = 1; s <= 12; s++) sk[s] = 's' + s;
  const order = buildOrder({ teams: 12, rounds: 20, type: 'snake', slotKey: sk });
  const teams = Object.values(sk).map((k, i) => ({ key: k, slot: i + 1, roster: [], name: k }));
  const personas = assignPersonas(teams.map((t) => t.key), 'mixed', 42);
  const ctx = { teams, order, picks: [], numTeams: 12, rounds: 20, myKey: 's1' };
  const r = rng(42);
  const pool = M.sorted.filter((p) => p.score > 0.3 || p.mv > 0 || p.prospect);
  for (const o of order) {
    const st = boardState(ctx);
    const ro = teamRosters(ctx, st, M).get(o.owner);
    const roster = ro.drafted.map((d) => d.p);
    const available = pool.filter((p) => !st.taken.has(p.id));
    const p = cpuPick({ available, roster, round: o.round, rounds: 20, persona: personas[o.owner], lineup: cfg.lineup, random: r });
    ctx.picks.push({ no: o.no, round: o.round, key: o.owner, pid: p.id, name: p.name, pos: p.pos });
  }
  const st = boardState(ctx);
  assert.ok(st.complete);
  assert.equal(new Set(ctx.picks.map((p) => p.pid)).size, 240, 'no duplicate picks');
  const rosters = teamRosters(ctx, st, M);
  const pool2 = [...pool].filter((p) => p.mv > 0).sort((a, b) => b.mv - a.mv);
  const mktPos = new Map(pool2.map((p, i) => [p.id, i + 1]));
  const reports = new Map();
  for (const [k, ro] of rosters) {
    const ps = ro.drafted.map((d) => d.p);
    for (const pos of ['QB', 'RB', 'WR', 'TE']) assert.ok(ps.filter((p) => p.pos === pos).length >= 1, `${k} has a ${pos}`);
    const rep = teamReport(ro.drafted, [], { lineup: cfg.lineup, repl: M.repl, mktPos });
    assert.ok(rep.labels.length >= 1 && rep.lineupPpg > 100, `${k} report`);
    reports.set(k, rep);
  }
  const tbl = leagueTable(reports);
  assert.equal(tbl.size, 12);
  const qbFirst = Object.entries(personas).find(([, v]) => v === 'qbFirst');
  if (qbFirst) {
    const ps = rosters.get(qbFirst[0]).drafted.filter((d) => d.pick.round <= 5).map((d) => d.p.pos);
    assert.ok(ps.filter((x) => x === 'QB').length >= 1, 'QB-first persona took an early QB');
  }
  const thr = threats(ctx, boardState({ ...ctx, picks: ctx.picks.slice(0, 13) }), rosters, cfg.lineup);
  assert.ok(Array.isArray(thr));
});

test('bestLineup fills superflex with a QB', () => {
  const qbs = M.sorted.filter((p) => p.pos === 'QB').slice(0, 2);
  const rest = ['RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'WR', 'RB'].map((pos, i) => M.sorted.filter((p) => p.pos === pos && !p.prospect)[i]);
  const { filled } = bestLineup([...qbs, ...rest], cfg.lineup);
  assert.equal(filled.find((f) => f.slot === 'SUPER_FLEX').p.pos, 'QB');
});

test('parses Sleeper links', () => {
  assert.deepEqual(parseSleeperRef('https://sleeper.com/draft/nfl/1234567890123'), { kind: 'draft', id: '1234567890123' });
  assert.deepEqual(parseSleeperRef('https://sleeper.com/leagues/998877665544/team'), { kind: 'league', id: '998877665544' });
  assert.equal(parseSleeperRef('hello'), null);
});
