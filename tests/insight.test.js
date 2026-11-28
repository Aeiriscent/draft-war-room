// Player outlooks and the trade engine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildModel } from '../js/model.js';
import { normalizeConfig } from '../js/league.js';
import { outlookContext, playerOutlook, roleDirection } from '../js/outlook.js';
import { playerValues, tradeContext, evaluateTrade, offersFor, shopAsset, sellCandidates, buyTargets, readyOffers, valueReport, liteTrade, pkg } from '../js/trade.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/data.json', import.meta.url)));
const prospects = JSON.parse(fs.readFileSync(new URL('../data/prospects.json', import.meta.url)));
const M = buildModel(data, prospects, normalizeConfig({ teams: 10 }));
const X = outlookContext(M, data, { nextWeek: Math.min(data.meta.week + 1, 15), playoffStart: 15 });
const V = playerValues(M, X);

// a 10-team league filled by snake draft on value, with records and one traded 1st
const pool = M.profiles.filter((p) => p.sid && V.get(p.id)?.value > 0).sort((a, b) => V.get(b.id).value - V.get(a.id).value).slice(0, 220);
const W = [3, 9, 7, 5, 8, 6, 4, 10, 2, 6];
const rosters = Array.from({ length: 10 }, (_, i) => ({ roster_id: i + 1, owner_id: 'U' + (i + 1), players: [], settings: { wins: W[i], losses: 12 - W[i], fpts: 1200 + i * 20 } }));
pool.forEach((p, k) => { const r = Math.floor(k / 10), i = r % 2 ? 9 - (k % 10) : k % 10; rosters[i].players.push(p.sid); });
const users = rosters.map((r) => ({ user_id: r.owner_id, display_name: 'Team ' + r.roster_id }));
const traded = [{ season: String(M.nextSeason), round: 1, roster_id: 9, owner_id: 1, previous_owner_id: 9 }];
const T = tradeContext(M, X, { league: { settings: { draft_rounds: 4 }, roster_positions: Array(26).fill('BN') }, rosters, users, traded }, { myRid: 1 });
const me = T.me;

test('outlook: every rostered player gets text, lists and a 3-year path', () => {
  for (const p of pool.slice(0, 80)) {
    const o = playerOutlook(p, M, X);
    assert.ok(o.now.length > 40, p.name);
    assert.ok(o.headline.length > 5);
    assert.ok(Array.isArray(o.adv) && Array.isArray(o.risk));
    assert.equal(o.future.path.length, 3);
    for (const x of o.future.path) assert.ok(Number.isFinite(x.ppg));
    if (o.ros) assert.ok(o.ros.ppg >= 0 && o.ros.rank >= 1);
  }
});

test('outlook: touchdown-heavy scorers are flagged and projected to cool', () => {
  const heavy = pool.map((p) => ({ p, o: playerOutlook(p, M, X) })).filter(({ o }) => o.risk.some((r) => r.title === 'Touchdown-dependent'));
  assert.ok(heavy.length >= 1);
  for (const { o } of heavy) assert.ok(!o.ros || o.ros.tdAdj < 0);
  assert.equal(roleDirection({ snap: -11, share: 9 }), 'mixed');
  assert.equal(roleDirection({ snap: 10, share: 1 }), 'up');
  assert.equal(roleDirection({ snap: -2, share: -6 }), 'down');
});

test('trade values: market scale, model reorders within position only', () => {
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const mk = M.profiles.filter((p) => p.pos === pos && V.get(p.id)).map((p) => V.get(p.id).market).sort((a, b) => b - a);
    const now = M.profiles.filter((p) => p.pos === pos && V.get(p.id)).map((p) => V.get(p.id).now).sort((a, b) => b - a);
    assert.deepEqual(now, mk); // same prices, possibly different players
  }
  assert.ok(pkg([{ v: 100 }, { v: 100 }], (a) => a.v) < 200); // two halves are worth less than one whole
});

test('league context: windows, picks with projected slots, needs', () => {
  assert.equal(T.teams.length, 10);
  for (const t of T.teams) {
    assert.ok(['Contender', 'Middle', 'Rebuilding'].includes(t.window.label));
    assert.ok(t.picks.length >= 4 * 3 - 1);
  }
  const mine1sts = me.picks.filter((p) => p.round === 1 && p.season === M.nextSeason);
  assert.equal(mine1sts.length, 2); // own + acquired
  const via = mine1sts.find((p) => p.orig === 9);
  assert.equal(via.slot, 1); // 2-10 team picks first
  assert.ok(via.market > mine1sts.find((p) => p.orig === 1).market);
  assert.ok(!T.byRid.get(9).picks.some((p) => p.round === 1 && p.season === M.nextSeason));
});

test('evaluation: symmetric deals are fair, lopsided ones are flagged with fixes', () => {
  const them = T.byRid.get(2);
  const mine = me.players.map((p) => T.assets.get(p.id)).sort((a, b) => b.market - a.market);
  const theirs = them.players.map((p) => T.assets.get(p.id)).sort((a, b) => b.market - a.market);
  const ev = evaluateTrade(T, me, them, [mine[0].id], [theirs[theirs.length - 1].id]);
  assert.ok(ev.mPct < -0.5);
  assert.equal(ev.grade[1], 'bad');
  assert.ok(ev.balance.length && ev.balance[0].side === 'get');
  assert.ok(ev.acc.p > 0.8); // they'd happily accept
  const rev = evaluateTrade(T, me, them, [mine[mine.length - 1].id], [theirs[0].id]);
  assert.ok(rev.acc.p < 0.2);
  assert.ok(rev.balance.every((b) => b.side === 'give'));
});

test('suggestions: realistic offers, sell and buy lists, ready-made trades', () => {
  const buys = buyTargets(T, me);
  assert.ok(buys.length > 0);
  for (const b of buys) assert.notEqual(b.a.owner, me.rid);
  const offers = offersFor(T, me, buys[0].a.id);
  for (const o of offers) {
    assert.ok(o.acc.p >= 0.3);
    assert.ok(o.giveIds.every((id) => T.assets.get(id).owner === me.rid));
    assert.deepEqual(o.getIds, [buys[0].a.id]);
  }
  const sells = sellCandidates(T, me);
  for (const s of sells) assert.equal(s.a.owner, me.rid);
  if (sells.length) for (const o of shopAsset(T, me, sells[0].a.id)) assert.ok(o.getIds.every((id) => T.assets.get(id).owner === o.them.rid));
  const ready = readyOffers(T, me);
  const leads = ready.map((o) => o.giveIds.join());
  assert.equal(new Set(leads).size, leads.length);
  const r = valueReport(T, me.players[0].id);
  assert.ok(r.mine && r.verdict && r.a.value > 0);
  const lite = valueReport(liteTrade(M, X), me.players[0].id);
  assert.equal(lite.a.value, r.a.value);
});
