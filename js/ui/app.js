// App controller: state, league tabs, live Sleeper sync, practice-draft engine, events.
import { loadData, refreshMarket, loadSleeperPlayers, loadSchedule, loadWeather, sleeperPlayersAt } from '../data.js';
import { buildWeek, projectWeek, optimize, winProb, gamesForWeek, SLOT_OK } from '../weekly.js';
import { outlookContext, playerOutlook } from '../outlook.js';
import { tradeContext, liteTrade, valueReport, evaluateTrade, offersFor, shopAsset, sellCandidates, buyTargets, readyOffers, myVal } from '../trade.js';
import { normTeam, median, normCdf } from '../util.js';
import { buildModel, rank } from '../model.js';
import { normalizeConfig, scoringFromSleeper, lineupFromSleeper, SLOT_ELIG } from '../league.js';
import { sleeper, parseSleeperRef } from '../sleeper.js';
import { buildOrder, fromSleeper, boardState, teamRosters, recommend, threats, pickLabel } from '../draft.js';
import { teamReport, leagueTable } from '../strategy.js';
import { PERSONAS, assignPersonas, cpuPick, rng } from '../sim.js';
import { loadState, saveState, download } from '../store.js';
import { playerHTML } from './player.js';
import { rankingsView, boardView, teamsView, settingsView, methodView, lineupView } from './views.js';
import { tradesView } from './tradeviews.js';
import { esc, toast, ago } from './h.js';

const $ = (s) => document.querySelector(s);
const S = {
  p: { leagues: [], active: null, tags: {}, lastUsername: '', view: 'board' },
  data: null, prospects: null, sleeperDB: null, models: new Map(), live: new Map(),
  page: 'league', drawer: null, modal: null,
};
const ui = { pos: 'ALL', q: '', sort: 'rank', flip: false, limit: 150, hideTaken: true, tagged: false, bpos: 'ALL', bq: '', seg: 'recs', luTeam: null, luWeek: null, luMode: 'auto', luSeg: 'week', luOpen: false, wvPos: 'ALL', trSeg: 'ideas', trPartner: null, trGive: [], trGet: [], trShop: null, trTarget: null, trMe: null, vcPos: 'ALL', vcTeam: 'ALL' };
const C = {
  ui, get tags() { return S.p.tags; }, get data() { return S.data; },
  live: (lg) => S.live.get(lg.id),
};

const save = () => saveState(S.p);
const active = () => S.p.leagues.find((l) => l.id === S.p.active) || S.p.leagues[0] || null;

function newLeague(kind, name, extra = {}) {
  return {
    id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name, kind, phase: 'startup',
    config: normalizeConfig({ teams: 12 }), prefs: { horizon: 0.5, trust: 0.4 },
    sleeper: {}, practice: { mySlot: 1, rounds: 20, type: 'snake', reversal: false, cpu: 'mixed', speed: 250, picks: [], seed: Math.floor(Math.random() * 1e9) },
    manual: [], ...extra,
  };
}

// ---------------- model + board computation ----------------
function getModel(lg) {
  const key = JSON.stringify(lg.config) + '|' + (S.sleeperDB ? 1 : 0) + '|' + S.data.meta.valuesDate;
  let m = S.models.get(lg.id);
  if (!m || m.key !== key) {
    m = { key, M: buildModel(S.data, S.prospects, lg.config, { sleeper: S.sleeperDB }) };
    S.models.set(lg.id, m);
    m.w = null;
  }
  const w = `${lg.prefs.horizon}|${lg.prefs.trust}`;
  if (m.w !== w) { rank(m.M, { horizon: lg.prefs.horizon, marketTrust: lg.prefs.trust }); m.w = w; }
  return m.M;
}

function rookieMode(lg) {
  const r = lg.config.rookies;
  if (r && r !== 'auto') return r;
  return lg.phase === 'existing' ? 'only' : 'include';
}

function practiceCtx(lg, M) {
  const P = lg.practice, T = lg.config.teams;
  const src = P.copyFrom ? S.live.get(P.copyFrom)?.ctx : null;
  let order, teams, myKey;
  if (src && src.order?.length) {
    order = src.order.filter((o) => o.round <= P.rounds);
    teams = src.teams.map((t) => ({ ...t }));
    myKey = src.myKey;
  } else if (src && src.teams?.length) {
    const sk = {};
    src.teams.forEach((t, i) => { sk[i + 1] = t.key; });
    order = buildOrder({ teams: src.teams.length, rounds: P.rounds, type: P.type === 'linear' ? 'linear' : 'snake', reversalRound: P.reversal ? 3 : 0, slotKey: sk });
    teams = src.teams.map((t, i) => ({ ...t, slot: i + 1 }));
    myKey = src.myKey;
  } else {
    const sk = {};
    for (let s = 1; s <= T; s++) sk[s] = 's' + s;
    order = buildOrder({ teams: T, rounds: P.rounds, type: P.type === 'linear' ? 'linear' : 'snake', reversalRound: P.reversal ? 3 : 0, slotKey: sk });
    myKey = 's' + P.mySlot;
    teams = Object.entries(sk).map(([s, k]) => ({ key: k, slot: +s, roster: [], name: k === myKey ? 'You' : `Team ${s}` }));
  }
  if (lg.kind === 'practice') {
    const others = teams.map((t) => t.key).filter((k) => k !== myKey);
    if (!P.personas || others.some((k) => !P.personas[k])) { P.personas = assignPersonas(others, P.cpu, P.seed); save(); }
    for (const t of teams) if (t.key !== myKey) t.name = `${t.name.startsWith('Team ') || t.name === 'You' ? 'CPU' : t.name} · ${PERSONAS[P.personas[t.key]]?.label || 'CPU'}`;
    const me = teams.find((t) => t.key === myKey);
    if (me) me.name = 'You';
  }
  const picks = P.picks.map((x) => {
    const o = order[x.no - 1];
    const p = M.byId.get(x.pid);
    return o ? { no: x.no, round: o.round, key: o.owner, pid: x.pid, name: p?.name, pos: p?.pos } : null;
  }).filter(Boolean);
  return { source: lg.kind, status: picks.length >= order.length ? 'complete' : 'drafting', teams, order, picks, rounds: P.rounds, numTeams: teams.length, myKey, name: lg.name };
}

function draftCtx(lg, M) {
  if (lg.kind === 'practice' || lg.kind === 'manual') return practiceCtx(lg, M);
  const L = S.live.get(lg.id);
  const ctx = L?.ctx || L?.rosterCtx || null;
  if (ctx && lg.sleeper.myKey) ctx.myKey = lg.sleeper.myKey;
  return ctx;
}

function eligibleFor(lg, M) {
  const mode = rookieMode(lg);
  const ok = mode === 'only' ? (p) => p.rookie : mode === 'exclude' ? (p) => !p.rookie || p.nEff > 0 : () => true;
  return M.sorted.filter((p) => ok(p) && (p.score > 0.3 || p.mv > 0 || p.prospect || p.rookie));
}

function boardInfo(lg) {
  const M = getModel(lg);
  const eligible = eligibleFor(lg, M);
  const B = { M, cfg: lg.config, eligible, rookieMode: rookieMode(lg), takenIds: new Set(), takenBy: new Map(), reports: new Map(), table: new Map(), recs: [], allRecs: [], available: eligible, myPlayers: [] };
  const ctx = draftCtx(lg, M);
  if (!ctx) return B;
  const extra = (lg.manual || []).filter((m) => !ctx.picks.some((p) => p.no === m.no)).map((m) => {
    const o = ctx.order[m.no - 1];
    return o ? { no: m.no, round: o.round, key: o.owner, pid: m.pid, manual: true } : null;
  }).filter(Boolean);
  const state = boardState(ctx, extra);
  const rosters = teamRosters(ctx, state, M);
  const nameOf = (k) => ctx.teams.find((t) => t.key === k)?.name || k;
  for (const [k, r] of rosters) {
    for (const p of r.existing) { B.takenIds.add(p.id); B.takenBy.set(p.id, `rostered · ${nameOf(k)}`); }
  }
  for (const pk of state.picks) {
    const o = ctx.order[pk.no - 1];
    B.takenIds.add(pk.pid);
    B.takenBy.set(pk.pid, `${o ? pickLabel(o) : '#' + pk.no} · ${nameOf(pk.key)}`);
  }
  const available = eligible.filter((p) => !B.takenIds.has(p.id));
  const my = ctx.myKey ? rosters.get(ctx.myKey) : null;
  const myPlayers = my ? [...my.existing, ...my.drafted.map((d) => d.p).filter(Boolean)] : [];
  const gap = state.picksUntil === 0 ? (state.afterNext ? state.afterNext.no - state.myNext.no : 99) : (state.picksUntil ?? 0);
  const allRecs = ctx.order.length ? recommend({ available, myPlayers, lineup: lg.config.lineup, picksUntil: gap, horizon: lg.prefs.horizon, tags: S.p.tags, limit: 150 }) : [];
  const pool = [...eligible].filter((p) => p.mv > 0).sort((a, b) => b.mv - a.mv);
  const mktPos = new Map(pool.map((p, i) => [p.id, i + 1]));
  const reports = new Map();
  for (const [k, r] of rosters) reports.set(k, teamReport(r.drafted, r.existing, { lineup: lg.config.lineup, repl: M.repl, mktPos, rookieDraft: B.rookieMode === 'only' }));
  Object.assign(B, {
    ctx, state, rosters, available, myPlayers, allRecs, recs: allRecs.slice(0, 10), reports, table: leagueTable(reports),
    threats: ctx.order.length ? threats(ctx, state, rosters, lg.config.lineup) : [],
    showWindow: lg.phase === 'existing' || state.complete || state.picks.length >= ctx.order.length * 0.6,
  });
  return B;
}

// ---------------- Sleeper live sync ----------------
const pollTimers = new Map();

function pickDraft(drafts = []) {
  const rank = { drafting: 0, pre_draft: 1, paused: 1, complete: 2 };
  return [...drafts].sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (b.created || 0) - (a.created || 0))[0];
}

async function sync(lg, { full = false, quiet = false } = {}) {
  let L = S.live.get(lg.id);
  if (!L) { L = { polling: lg.kind === 'sleeper' || lg.kind === 'mock', names: {} }; S.live.set(lg.id, L); }
  if (lg.kind !== 'sleeper' && lg.kind !== 'mock') return;
  L.loading = true;
  try {
    if (!lg.sleeper.userId && lg.sleeper.username) {
      const u = await sleeper.user(lg.sleeper.username).catch(() => null);
      if (u?.user_id) lg.sleeper.userId = u.user_id;
    }
    if (lg.kind === 'sleeper') {
      if (full || !L.league) {
        const id = lg.sleeper.leagueId;
        const [league, rosters, users, drafts, ltraded] = await Promise.all([sleeper.league(id), sleeper.rosters(id), sleeper.users(id), sleeper.leagueDrafts(id), sleeper.leagueTraded(id).catch(() => [])]);
        if (!league) throw new Error('League not found');
        Object.assign(L, { league, rosters: rosters || [], users: users || [], drafts: drafts || [], ltraded: ltraded || [], rostersAt: Date.now() });
        if (!lg.configSet) { applySleeperConfig(lg, league); lg.configSet = true; }
        if (!lg.phaseSet) {
          const filled = (rosters || []).some((r) => (r.players || []).length > 0);
          lg.phase = filled ? 'existing' : 'startup';
          if (lg.phase === 'existing') lg.prefs.horizon = Math.max(lg.prefs.horizon, 0.65);
          lg.phaseSet = true;
        }
      }
      const d = lg.sleeper.draftId || pickDraft(L.drafts)?.draft_id;
      if (d) {
        const [draft, picks, traded] = await Promise.all([sleeper.draft(d), sleeper.picks(d), sleeper.draftTraded(d)]);
        Object.assign(L, { draft, picks: picks || [], traded: traded || [] });
      }
    } else {
      const d = lg.sleeper.draftId;
      const [draft, picks, traded] = await Promise.all([sleeper.draft(d), sleeper.picks(d), sleeper.draftTraded(d)]);
      if (!draft) throw new Error('Draft not found');
      Object.assign(L, { draft, picks: picks || [], traded: traded || [] });
      if (!lg.configSet) { applyDraftConfig(lg, draft); lg.configSet = true; }
      const uids = Object.keys(draft.draft_order || {}).filter((u) => !L.names[u]);
      if (uids.length) {
        const got = await Promise.allSettled(uids.map((u) => sleeper.user(u)));
        got.forEach((g, i) => { if (g.status === 'fulfilled' && g.value) L.names[uids[i]] = g.value.display_name; });
      }
    }
    if (L.draft) {
      L.ctx = fromSleeper({ draft: L.draft, picks: L.picks, traded: L.traded, rosters: L.rosters || [], users: L.users || [], myUserId: lg.sleeper.userId, names: L.names });
    } else if (L.rosters?.length) {
      L.rosterCtx = rosterOnlyCtx(L, lg);
    }
    L.error = null;
    L.lastSync = Date.now();
    if (L.draft?.status === 'complete') L.polling = false;
  } catch (e) {
    L.error = e.message || String(e);
    if (!quiet) toast(L.error);
  }
  L.loading = false;
  save();
  if (active()?.id === lg.id || S.p.leagues.some((x) => x.practice?.copyFrom === lg.id && x.id === active()?.id)) render();
}

function rosterOnlyCtx(L, lg) {
  const users = new Map((L.users || []).map((u) => [u.user_id, u]));
  const teams = (L.rosters || []).map((r, i) => {
    const u = users.get(r.owner_id);
    return { key: `r${r.roster_id}`, slot: i + 1, name: u ? (u.metadata?.team_name || u.display_name) : `Team ${r.roster_id}`, roster: (r.players || []).map(String), ownerId: r.owner_id };
  });
  const mine = (L.rosters || []).find((r) => r.owner_id === lg.sleeper.userId);
  return { source: 'sleeper', status: 'none', teams, order: [], picks: [], rounds: 0, numTeams: teams.length, myKey: mine ? `r${mine.roster_id}` : null, name: L.league?.name };
}

function applySleeperConfig(lg, league) {
  lg.config = normalizeConfig({
    ...lg.config, teams: league.total_rosters || lg.config.teams,
    lineup: lineupFromSleeper(league.roster_positions), scoring: scoringFromSleeper(league.scoring_settings),
  });
  lg.name = lg.name || league.name;
}

function applyDraftConfig(lg, draft) {
  const s = draft.settings || {};
  const lineup = [];
  const add = (n, slot) => { for (let i = 0; i < (n || 0); i++) lineup.push(slot); };
  add(s.slots_qb, 'QB'); add(s.slots_rb, 'RB'); add(s.slots_wr, 'WR'); add(s.slots_te, 'TE');
  add(s.slots_flex, 'FLEX'); add(s.slots_wr_te, 'REC_FLEX'); add(s.slots_wr_rb, 'WRRB_FLEX'); add(s.slots_super_flex, 'SUPER_FLEX');
  lg.config = normalizeConfig({ ...lg.config, teams: s.teams || lg.config.teams, lineup: lineup.length ? lineup : lg.config.lineup });
}

function schedulePoll(lg) {
  clearTimeout(pollTimers.get(lg.id));
  const L = S.live.get(lg.id);
  if (!L?.polling || active()?.id !== lg.id) return;
  const st = L.draft?.status;
  let ms = st === 'drafting' ? 3000 : st === 'pre_draft' || st === 'paused' ? 20000 : 60000;
  if (document.hidden) ms *= 4;
  if (L.error) ms = Math.max(ms, 10000);
  pollTimers.set(lg.id, setTimeout(async () => { await sync(lg, { quiet: true }); schedulePoll(lg); }, ms));
}

async function activate(lg, { full = true } = {}) {
  S.p.active = lg.id;
  save();
  render();
  if (lg.kind === 'sleeper' || lg.kind === 'mock') {
    ensureSleeperDB();
    await sync(lg, { full });
    schedulePoll(lg);
  } else if (lg.practice?.copyFrom) {
    const src = S.p.leagues.find((x) => x.id === lg.practice.copyFrom);
    if (src && !S.live.get(src.id)?.ctx) await sync(src, { full: true, quiet: true });
    runCpu(lg);
  } else if (lg.kind === 'practice') runCpu(lg);
}

let sleeperLoading = null;
function ensureSleeperDB(force = false, maxAgeH = null) {
  if (sleeperLoading) return sleeperLoading;
  if (S.sleeperDB && !force && (maxAgeH == null || Date.now() - sleeperPlayersAt < maxAgeH * 3600e3)) return null;
  sleeperLoading = loadSleeperPlayers({ force, maxAgeH }).then((db) => {
    if (db !== S.sleeperDB) S.models.clear();
    S.sleeperDB = db;
    render();
  }).catch((e) => toast('Sleeper player list unavailable: ' + e.message)).finally(() => { sleeperLoading = null; });
  return sleeperLoading;
}


// ---------------- weekly lineup (start/sit) ----------------
const BENCH = new Set(['BN', 'IR', 'TAXI', 'RES']);
const startingSlots = (league) => (league?.roster_positions || []).filter((s) => !BENCH.has(s));

async function nflState() {
  if (S.nfl && Date.now() - S.nfl.at < 10 * 60e3) return S.nfl.state;
  const st = await sleeper.state();
  S.nfl = { state: st, at: Date.now() };
  return st;
}

async function loadWeek(lg, week, { force = false } = {}) {
  const L = S.live.get(lg.id);
  if (!L?.league) return;
  L.wk ||= {};
  const cur = L.wk[week];
  if (cur?.loading || (cur?.at && !force && Date.now() - cur.at < 10 * 60e3)) return;
  L.wk[week] = { ...(cur || {}), loading: true };
  if (!cur) render();
  const season = +L.league.season;
  const slots = startingSlots(L.league);
  const positions = ['QB', 'RB', 'WR', 'TE', ...(slots.includes('K') ? ['K'] : []), ...(slots.includes('DEF') ? ['DEF'] : [])];
  try {
    const [matchups, projections, schedule] = await Promise.all([
      sleeper.matchups(lg.sleeper.leagueId, week).catch(() => null),
      sleeper.projections(season, week, positions).catch(() => ({})),
      loadSchedule(season, season === S.data.meta.season ? S.data.schedule : []),
    ]);
    const games = gamesForWeek(schedule, week, S.data.stadiums || {});
    const weather = await loadWeather(games).catch(() => ({}));
    L.wk[week] = { at: Date.now(), week, season, matchups: matchups || [], projections: projections || {}, schedule, games, weather, loading: false };
  } catch (e) {
    L.wk[week] = { at: Date.now(), error: e.message || String(e), loading: false };
  }
  if (active()?.id === lg.id && S.p.view === 'lineup') render();
}

function stubProfile(id) {
  const sp = S.sleeperDB?.[id];
  return { id, sid: id, name: sp?.full_name || (/^[A-Z]{2,3}$/.test(id) ? `${id} D/ST` : `Player ${id}`), pos: sp?.position || (/^[A-Z]{2,3}$/.test(id) ? 'DEF' : '?'),
    team: normTeam(sp?.team || (/^[A-Z]{2,3}$/.test(id) ? id : null)), weeks: [], trailingPpg: null, stub: true, injury: sp?.injury_status || null };
}

function lineupInfo(lg) {
  const L = S.live.get(lg.id);
  if (lg.kind !== 'sleeper') return { msg: 'not-sleeper' };
  if (!L?.league) return { msg: L?.error ? 'error' : 'loading', error: L?.error };
  if (!S.nfl) { nflState().then(render).catch((e) => { S.nfl = { state: null, at: Date.now(), error: e.message }; render(); }); return { msg: 'loading' }; }
  const st = S.nfl.state;
  if (!st) return { msg: 'error', error: S.nfl.error || 'Sleeper season info unavailable' };
  const hasPlayers = (L.rosters || []).some((r) => (r.players || []).length);
  if (!hasPlayers) return { msg: 'no-rosters' };
  if (String(L.league.season) !== String(st.season) && st.season_type !== 'off') return { msg: 'offseason', season: L.league.season, nflSeason: st.season };
  const curWeek = Math.max(1, Math.min(18, st.season_type === 'post' ? 18 : (st.display_week || st.week || 1)));
  const week = +ui.luWeek || curWeek;
  ensureSleeperDB(false, 12);
  const D = L.wk?.[week];
  if (!D?.at) { loadWeek(lg, week); return { msg: 'loading', week }; }
  if (D.error) return { msg: 'error', error: D.error, week };
  if (Date.now() - D.at > 10 * 60e3) loadWeek(lg, week);
  const M = getModel(lg);
  const now = new Date();
  const wkey = `${S.models.get(lg.id)?.key}|${D.at}|${Math.floor(now / 60e3)}`;
  if (D.wkey !== wkey) {
    D.W = buildWeek({ data: S.data, M, week, season: D.season, sleeper: S.sleeperDB, projections: D.projections, schedule: D.schedule, weather: D.weather, now });
    D.wkey = wkey;
    D.cache = new Map();
  }
  const entryFor = (id) => {
    if (D.cache.has(id)) return D.cache.get(id);
    const p = M.byId.get(id) || stubProfile(id);
    const e = projectWeek(p, D.W);
    D.cache.set(id, e);
    return e;
  };
  const slots = startingSlots(L.league);
  const users = new Map((L.users || []).map((u) => [u.user_id, u]));
  const teams = (L.rosters || []).map((r) => {
    const u = users.get(r.owner_id);
    return { rid: r.roster_id, name: u ? (u.metadata?.team_name || u.display_name) : `Team ${r.roster_id}`, ownerId: r.owner_id, co: r.co_owners || [] };
  });
  const uid = lg.sleeper.userId;
  const mine = teams.find((t) => t.ownerId === uid || t.co.includes(uid));
  const rid = +ui.luTeam || mine?.rid || teams[0]?.rid;
  const plan = (r) => {
    const m = D.matchups.find((x) => x.roster_id === r);
    const ro = (L.rosters || []).find((x) => x.roster_id === r);
    const hold = new Set([...(ro?.reserve || []), ...(ro?.taxi || [])].map(String));
    const ids = [...new Set((m?.players || ro?.players || []).map(String))].filter((id) => !hold.has(id));
    const pts = m?.players_points || {};
    const entries = ids.map((id) => {
      let e = entryFor(id);
      const done = e.locked && e.game && pts[id] != null && (e.game.final || now - e.game.kick > 4.5 * 3600e3);
      if (e.locked) e = { ...e, actual: pts[id] ?? null };
      if (done) e = { ...e, done: true, exp: pts[id], sd: 0, floor: pts[id], ceil: pts[id] };
      return e;
    });
    const byId = new Map(entries.map((e) => [e.p.id, e]));
    const starters = (m?.starters || ro?.starters || []).map(String);
    const locked = new Map();
    starters.forEach((id, i) => { if (byId.get(id)?.locked) locked.set(id, i); });
    const curFilled = slots.map((s, i) => byId.get(starters[i]) || null);
    const current = { slots, filled: curFilled, total: curFilled.reduce((t, e) => t + (e ? e.exp : 0), 0), sd: Math.sqrt(curFilled.reduce((t, e) => t + (e ? e.sd ** 2 : 0), 0)) };
    const plans = Object.fromEntries(['safe', 'balanced', 'upside'].map((k) => [k, optimize(entries, slots, k, locked)]));
    return { rid: r, m, entries, starters, current, plans, team: teams.find((t) => t.rid === r) };
  };
  const me = plan(rid);
  const oppRid = me.m?.matchup_id ? D.matchups.find((x) => x.matchup_id === me.m.matchup_id && x.roster_id !== rid)?.roster_id : null;
  const opp = oppRid ? plan(oppRid) : null;
  const oppBest = opp ? opp.plans.balanced : null;
  let mode = ui.luMode, why = '';
  const wp = (pl) => (oppBest ? winProb(pl, oppBest) : null);
  if (mode === 'auto') {
    if (!oppBest) { mode = 'balanced'; why = 'No head-to-head opponent this week, so it maximizes projected points.'; } else {
      const scored = ['balanced', 'safe', 'upside'].map((k) => [k, wp(me.plans[k])]);
      scored.sort((a, b) => b[1] - a[1] + (a[0] === 'balanced' ? 0.003 : 0) - (b[0] === 'balanced' ? 0.003 : 0));
      mode = scored[0][0];
      const p = wp(me.plans.balanced);
      why = mode === 'upside' ? `You project as the underdog (${Math.round(p * 100)}%), so the higher-variance lineup gives you the better shot.`
        : mode === 'safe' ? `You project as the favorite (${Math.round(p * 100)}%), so the steadier lineup protects the lead.`
          : 'The highest projected lineup is also your best shot to win.';
    }
  }
  const rec = me.plans[mode];
  // swaps: recommended vs what's set in Sleeper now
  const curIds = new Set(me.current.filled.filter(Boolean).map((e) => e.p.id));
  const recIds = new Set(rec.filled.filter(Boolean).map((e) => e.p.id));
  const ins = rec.filled.filter((e) => e && !curIds.has(e.p.id));
  const outs = me.current.filled.filter((e) => e && !recIds.has(e.p.id));
  // pair each new starter with the player he replaces: same position first, then empty slots, then whoever is left
  const empties = me.current.filled.filter((e, i) => !e && SLOT_OK[slots[i]]).length;
  const swaps = [];
  const left = [...outs], waiting = [];
  for (const e of [...ins].sort((x, y) => y.exp - x.exp)) {
    const j = left.findIndex((o) => o.pos === e.pos);
    if (j >= 0) swaps.push({ in: e, out: left.splice(j, 1)[0] }); else waiting.push(e);
  }
  let free = empties;
  for (const e of waiting) {
    if (free > 0) { free--; swaps.push({ in: e, out: null }); } else swaps.push({ in: e, out: left.shift() || null });
  }
  let medianInfo = null;
  if (L.league.settings?.league_average_match) {
    const others = teams.filter((t) => t.rid !== rid).map((t) => plan(t.rid).plans.balanced);
    const med = median(others.map((o) => o.total));
    const s = Math.sqrt(rec.sd ** 2 + (0.5 * median(others.map((o) => o.sd))) ** 2) || 1;
    medianInfo = { median: med, p: normCdf((rec.total - med) / s) };
  }
  const D2 = D;
  return {
    week, curWeek, season: D.season, teams, rid, mine: mine?.rid, me, opp, oppBest, mode, why, rec, swaps, empties, entryFor,
    winNow: oppBest ? wp(me.current) : null, winRec: oppBest ? wp(rec) : null, medianInfo, slots,
    sources: {
      at: D2.at, proj: Object.keys(D2.projections || {}).length,
      lines: [...D2.games.values()].filter((g) => g.total != null).length / 2, games: D2.games.size / 2,
      wx: Object.keys(D2.weather || {}).length, outdoor: [...D2.games.values()].filter((g) => g.roof !== 'dome').length / 2,
      injAt: sleeperPlayersAt, loading: D2.loading,
    },
  };
}


// ---------------- outlooks, trade values, trades ----------------
function outlookCtx(lg) {
  const M = getModel(lg);
  const L = S.live.get(lg.id);
  const st = S.nfl?.state;
  const nextWeek = st && String(st.season) === String(M.cur) && st.season_type === 'regular' ? Math.max(1, st.week || 1) : undefined;
  const ps = +(L?.league?.settings?.playoff_week_start) || 15;
  return outlookContext(M, S.data, { nextWeek, playoffStart: ps, lastWeek: ps + 2 });
}
const statusFor = (p) => {
  const sp = p.sid && S.sleeperDB?.[p.sid];
  return sp ? { injury: sp.injury_status || null, body: sp.injury_body_part || null } : {};
};
function outlookOf(lg, p) {
  return playerOutlook(p, getModel(lg), outlookCtx(lg), statusFor(p));
}
function myRosterId(lg, L) {
  const uid = lg.sleeper?.userId;
  const r = (L?.rosters || []).find((x) => x.owner_id === uid || (x.co_owners || []).includes(uid));
  return r?.roster_id ?? null;
}
function tradeCtx(lg) {
  const L = S.live.get(lg.id);
  if (lg.kind !== 'sleeper' || !L?.league || !(L.rosters || []).some((r) => (r.players || []).length)) return null;
  const M = getModel(lg), X = outlookCtx(lg);
  const myRid = myRosterId(lg, L) ?? (+ui.trMe || L.rosters[0]?.roster_id);
  const m = S.models.get(lg.id);
  const key = [m?.key, m?.w, L.rostersAt, X.nextWeek, lg.tradeWindow || 'auto', (L.ltraded || []).length, myRid].join('|');
  if (L.T && L.Tkey === key) return L.T;
  L.T = tradeContext(M, X, { league: L.league, rosters: L.rosters, users: L.users, traded: L.ltraded }, { myRid, myWindow: lg.tradeWindow || 'auto' });
  L.Tkey = key;
  L.Tcache = {};
  return L.T;
}
function cached(lg, k, f) {
  const L = S.live.get(lg.id);
  L.Tcache ||= {};
  if (!(k in L.Tcache)) L.Tcache[k] = f();
  return L.Tcache[k];
}
function valueOf(lg, id) {
  const T = tradeCtx(lg) || liteTrade(getModel(lg), outlookCtx(lg));
  return valueReport(T, id);
}

function tradesInfo(lg) {
  const L = S.live.get(lg.id);
  if (!L?.league) return { msg: L?.error ? 'error' : 'loading', error: L?.error };
  const T = tradeCtx(lg);
  if (!T) return { msg: 'no-rosters' };
  const me = T.me;
  const out = { T, me, mineKnown: myRosterId(lg, L) != null, window: lg.tradeWindow || 'auto' };
  out.sells = cached(lg, 'sell', () => sellCandidates(T, me));
  out.buys = cached(lg, 'buy', () => buyTargets(T, me));
  if (ui.trSeg === 'ideas') {
    out.ready = cached(lg, 'ready', () => readyOffers(T, me));
    if (ui.trShop && T.assets.get(ui.trShop)?.owner === me.rid) out.shop = { a: T.assets.get(ui.trShop), offers: cached(lg, 'shop:' + ui.trShop, () => shopAsset(T, me, ui.trShop)) };
    if (ui.trTarget && T.assets.get(ui.trTarget) && T.assets.get(ui.trTarget).owner !== me.rid) out.target = { a: T.assets.get(ui.trTarget), offers: cached(lg, 'offers:' + ui.trTarget, () => offersFor(T, me, ui.trTarget)) };
  }
  if (ui.trSeg === 'builder') {
    const partner = T.byRid.get(+ui.trPartner) || T.teams.find((t) => t.rid !== me.rid);
    ui.trPartner = partner?.rid ?? null;
    ui.trGive = ui.trGive.filter((id) => T.assets.get(id)?.owner === me.rid);
    ui.trGet = ui.trGet.filter((id) => T.assets.get(id)?.owner === partner?.rid);
    out.partner = partner;
    if (partner && (ui.trGive.length || ui.trGet.length)) out.ev = evaluateTrade(T, me, partner, ui.trGive, ui.trGet);
    if (partner && ui.trGet.length === 1 && !ui.trGive.length) out.suggest = cached(lg, 'offers:' + ui.trGet[0], () => offersFor(T, me, ui.trGet[0]));
  }
  if (ui.trSeg === 'chart') {
    const h = me.window.h;
    out.chart = [...T.assets.values()].filter((a) => (ui.vcPos === 'ALL' || (ui.vcPos === 'PICK' ? a.kind === 'pick' : a.pos === ui.vcPos)) && (ui.vcTeam === 'ALL' || a.owner === +ui.vcTeam))
      .sort((x, y) => (y.value || 0) - (x.value || 0)).slice(0, 200)
      .map((a) => ({ a, own: T.byRid.get(a.owner), forMe: myVal(T, a, h) }));
  }
  return out;
}

function rosterInfo(lg, X) {
  // every player on the selected team with his outlook and trade value
  const M = getModel(lg);
  const recIds = new Map(X.rec.filled.map((e, i) => [e?.p.id, X.rec.slots[i]]).filter(([id]) => id));
  const list = X.me.entries.filter((e) => !e.p.stub).map((e) => ({ e, slot: recIds.get(e.p.id) || null, o: outlookOf(lg, M.byId.get(e.p.id) || e.p), r: valueOf(lg, e.p.id) }));
  list.sort((a, b) => (b.slot ? 1 : 0) - (a.slot ? 1 : 0) || (b.o.ros?.ppg ?? 0) - (a.o.ros?.ppg ?? 0) || (b.r?.a.value ?? 0) - (a.r?.a.value ?? 0));
  return list;
}

function waiverInfo(lg, X) {
  const L = S.live.get(lg.id);
  const M = getModel(lg), OX = outlookCtx(lg);
  const owned = new Set((L.rosters || []).flatMap((r) => [...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])].map(String)));
  const vals = liteTrade(M, OX).vals;
  const avail = M.profiles.filter((p) => !p.prospect && p.sid && !owned.has(p.sid) && (!S.sleeperDB || S.sleeperDB[p.sid]?.team));
  // weakest starter I'd replace at each position this week, and over the rest of the season
  const worst = (pos) => {
    const cands = X.rec.filled.map((e, i) => ({ e, s: X.rec.slots[i] })).filter(({ e, s }) => e && !e.locked && (SLOT_OK[s] || []).includes(pos));
    return cands.sort((a, b) => a.e.exp - b.e.exp)[0]?.e || null;
  };
  const rows = avail.filter((p) => OX.ros.get(p.id)).map((p) => {
    const e = X.entryFor(p.id), R = OX.ros.get(p.id), w = worst(p.pos);
    return { p, e, R, o: null, v: vals.get(p.id), over: w && e.exp > w.exp + 0.5 ? { who: w, gain: e.exp - w.exp } : null };
  }).filter((x) => ui.wvPos === 'ALL' || x.p.pos === ui.wvPos)
    .sort((a, b) => (b.R.ppg + 0.5 * b.e.exp) - (a.R.ppg + 0.5 * a.e.exp)).slice(0, 20);
  for (const r of rows) r.o = playerOutlook(r.p, M, OX, statusFor(r.p));
  const stash = avail.filter((p) => (p.age ?? 30) <= 24.5 && vals.get(p.id)).sort((a, b) => vals.get(b.id).dyn - vals.get(a.id).dyn).slice(0, 8)
    .map((p) => ({ p, v: vals.get(p.id), o: playerOutlook(p, M, OX, statusFor(p)) }));
  return { rows, stash };
}

// ---------------- practice engine ----------------
let simTimer = null;
function runCpu(lg) {
  clearTimeout(simTimer);
  if (lg.kind !== 'practice') return;
  const step = () => {
    if (active()?.id !== lg.id) return;
    let guard = 0;
    while (guard++ < 1000) {
      const M = getModel(lg);
      const ctx = practiceCtx(lg, M);
      const state = boardState(ctx);
      const oc = state.onClock;
      if (!oc || oc.owner === ctx.myKey) { render(); return; }
      const team = teamRosters(ctx, state, M).get(oc.owner);
      const roster = [...team.existing, ...team.drafted.map((d) => d.p).filter(Boolean)];
      const taken = new Set([...state.taken, ...ctx.teams.flatMap((t) => t.roster)]);
      const available = eligibleFor(lg, M).filter((p) => !taken.has(p.id));
      const p = cpuPick({ available, roster, round: oc.round, rounds: ctx.rounds, persona: lg.practice.personas?.[oc.owner], lineup: lg.config.lineup, random: rng(lg.practice.seed + oc.no * 7919) });
      if (!p) { render(); return; }
      lg.practice.picks.push({ no: oc.no, pid: p.id });
      save();
      if (+lg.practice.speed > 0) { render(); simTimer = setTimeout(step, +lg.practice.speed); return; }
    }
  };
  step();
}

function draftPlayer(lg, id) {
  const B = boardInfo(lg);
  const oc = B.state?.onClock;
  if (!oc) return;
  if (lg.kind === 'practice' && oc.owner !== B.ctx.myKey) { toast('Not your pick yet'); return; }
  if (B.takenIds.has(id)) { toast('Already taken'); return; }
  lg.practice.picks.push({ no: oc.no, pid: id });
  save();
  S.drawer = null;
  render();
  runCpu(lg);
}

// ---------------- rendering ----------------
function renderTabs() {
  const tabs = S.p.leagues.map((l) => {
    const L = S.live.get(l.id);
    const dot = L?.polling && L?.draft?.status === 'drafting' ? 'live' : '';
    return `<button class="tab ${l.id === active()?.id && S.page === 'league' ? 'on' : ''}" data-act="tab" data-id="${l.id}"><span class="dot ${dot}"></span>${esc(l.name)}</button>`;
  }).join('');
  $('#tabs').innerHTML = tabs + '<button class="tab" data-act="add-league">+ League</button>';
}

function subnav(lg, B, v = S.p.view) {
  const kinds = { sleeper: 'Sleeper league', mock: 'Sleeper draft', practice: 'Practice draft', manual: 'Draft tracker' };
  const meta = `${kinds[lg.kind]} · ${lg.config.teams} teams · ${lg.phase === 'existing' ? 'existing league' : 'startup'}`;
  const views = [['board', 'Draft board'], ['rankings', 'Rankings'], ['teams', 'Teams'], ['settings', 'League settings']];
  if (lg.kind === 'sleeper' && lg.phase === 'existing') views.unshift(['lineup', 'Lineup'], ['trades', 'Trades']);
  return `<nav class="subnav">${views
    .map(([k, n]) => `<button class="${v === k ? 'on' : ''}" data-act="view" data-v="${k}">${n}</button>`).join('')}<span class="meta">${esc(meta)}</span></nav>`;
}

function welcome() {
  return `<div class="wrap" style="max-width:1000px">
    <div class="hero"><div><h1>Your dynasty draft war room</h1>
      <p>Grades every player in your league’s exact scoring, reads every opponent’s strategy as picks happen, and tells you who to take and why. Live-synced with Sleeper.</p>
      <button class="btn gold" data-act="add-league">Add your first league</button></div>
      <div class="panel small"><b>Set up once per league:</b><ol style="margin:8px 0 0;padding-left:18px">
        <li>Connect a Sleeper league (startup or existing) or paste a mock-draft link.</li>
        <li>Rankings re-grade in that league’s scoring, lineup and size.</li>
        <li>On draft day keep the board open: it polls Sleeper every few seconds.</li>
        <li>Rehearse with Practice drafts against CPU teams that run real strategies.</li></ol></div></div></div>`;
}

let focusMemo = null;
function render() {
  if (!S.data) return;
  const fe = document.activeElement;
  if (fe && fe.matches?.('[data-ui]')) focusMemo = { k: fe.dataset.ui, s: fe.selectionStart };
  else focusMemo = null;
  renderTabs();
  const main = $('#main');
  if (S.page === 'method') main.innerHTML = methodView(C);
  else {
    const lg = active();
    if (!lg) main.innerHTML = welcome();
    else {
      const B = boardInfo(lg);
      S.lastB = B;
      let v = S.p.view;
      if (v === 'lineup' && !(lg.kind === 'sleeper' && lg.phase === 'existing')) v = 'board';
      let body;
      if (v === 'trades' && !(lg.kind === 'sleeper' && lg.phase === 'existing')) v = 'board';
      if (v === 'lineup') {
        const X = lineupInfo(lg); S.lastLU = X;
        if (X.me && ui.luSeg === 'roster') X.roster = rosterInfo(lg, X);
        if (X.me && ui.luSeg === 'waiver') X.waiver = waiverInfo(lg, X);
        body = lineupView(C, lg, X);
      } else if (v === 'trades') body = tradesView(C, lg, tradesInfo(lg));
      else body = v === 'rankings' ? rankingsView(C, lg, B) : v === 'teams' ? teamsView(C, lg, B) : v === 'settings' ? settingsView(C, lg, B) : boardView(C, lg, B);
      main.innerHTML = subnav(lg, B, v) + `<div class="wrap">${body}</div>`;
    }
  }
  if (focusMemo) {
    const el = document.querySelector(`[data-ui="${focusMemo.k}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(focusMemo.s, focusMemo.s); } catch { /* */ } }
  }
  renderDrawer();
  renderModal();
}

function renderDrawer() {
  const d = $('#drawer'), scrim = $('#scrim');
  if (S.drawer && !d.hidden && d.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
  const lg = active();
  if (!S.drawer || !lg) { d.hidden = true; scrim.hidden = true; return; }
  const M = getModel(lg);
  const p = M.byId.get(S.drawer);
  if (!p) { d.hidden = true; scrim.hidden = true; return; }
  const B = S.lastB || boardInfo(lg);
  const oc = B.state?.onClock;
  const taken = B.takenIds?.has(p.id);
  const keep = d.hidden ? 0 : d.scrollTop;
  d.innerHTML = playerHTML(p, M, {
    tags: S.p.tags, draftInfo: B.takenBy?.get(p.id) ? `Taken: ${B.takenBy.get(p.id)}` : null,
    canDraft: !taken && !!oc && ((lg.kind === 'practice' && oc.owner === B.ctx.myKey) || lg.kind === 'manual'),
    canMark: !taken && !!oc && (lg.kind === 'sleeper' || lg.kind === 'mock'),
    week: S.p.view === 'lineup' ? findWeekEntry(p.id) : null,
    outlook: outlookOf(lg, p),
    value: p.prospect ? null : valueOf(lg, p.id),
    canTrade: !!tradeCtx(lg),
  });
  d.hidden = false; scrim.hidden = false;
  d.scrollTop = keep;
}

function findWeekEntry(id) {
  const X = S.lastLU;
  if (!X?.me) return null;
  const e = [X.me, X.opp].filter(Boolean).flatMap((t) => t.entries).find((x) => x.p.id === id);
  return e ? { e, week: X.week } : null;
}

// ---------------- add-league modal ----------------
function seasons() {
  const y = new Date().getFullYear();
  return [y + 1, y, y - 1];
}

function renderModal() {
  const m = S.modal, box = $('#modal');
  if (!m) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  let inner = '';
  const close = '<button class="iconbtn" style="float:right" data-act="m-close">Close ✕</button>';
  if (m.step === 'choose') {
    inner = `${close}<h2>Add a league</h2><div class="choices">
      <button class="choice" data-act="m-step" data-v="sleeper"><b>My Sleeper league</b><span class="small muted">Startup or existing. Pulls scoring, lineup, rosters, traded picks and the live draft.</span></button>
      <button class="choice" data-act="m-step" data-v="draft"><b>Paste a Sleeper link</b><span class="small muted">A league link (for start/sit and rosters) or any draft link, including mock drafts.</span></button>
      <button class="choice" data-act="m-step" data-v="practice"><b>Practice draft</b><span class="small muted">Rehearse against CPU teams running real strategies. Can copy a real league’s teams and rosters.</span></button>
      <button class="choice" data-act="m-step" data-v="manual"><b>League not on Sleeper yet</b><span class="small muted">Set the format now, track picks by hand, connect Sleeper later.</span></button></div>`;
  } else if (m.step === 'sleeper') {
    inner = `${close}<h2>Find your Sleeper league</h2>
      <div class="formgrid"><label class="field"><span>Sleeper username</span><input type="text" id="m-user" value="${esc(m.username ?? S.p.lastUsername)}" autocomplete="username"></label>
      <label class="field"><span>Season</span><select id="m-season">${seasons().map((y) => `<option ${y === (m.season || new Date().getFullYear()) ? 'selected' : ''}>${y}</option>`).join('')}</select></label></div>
      <div class="chips" style="margin-top:10px"><button class="btn primary" data-act="m-find">Find my leagues</button><button class="btn" data-act="m-step" data-v="choose">Back</button></div>
      ${m.error ? `<p class="risk-High small">${esc(m.error)}</p>` : ''}${m.loading ? '<p class="muted small">Loading…</p>' : ''}
      ${m.leagues ? `<div class="list-pick">${m.leagues.length ? m.leagues.map((l) => `<button data-act="m-pick" data-id="${l.league_id}"><b>${esc(l.name)}</b> <span class="muted small">${l.total_rosters} teams · ${esc(l.status)} · ${l.settings?.type === 2 ? 'dynasty' : l.settings?.type === 1 ? 'keeper' : 'redraft'}</span></button>`).join('') : '<p class="muted">No leagues for that season.</p>'}</div>` : ''}`;
  } else if (m.step === 'draft') {
    inner = `${close}<h2>Paste a Sleeper link</h2>
      <label class="field"><span>League or draft URL (or ID)</span><input type="text" id="m-draft" placeholder="https://sleeper.com/leagues/1234567890/team" value="${esc(m.link || '')}"></label>
      <p class="small muted" style="margin:6px 0 0">In the Sleeper app: open the league → ⚙︎ League settings → Share/Invite link, or copy the address bar on sleeper.com. Draft links look like sleeper.com/draft/nfl/…</p>
      <label class="field" style="margin-top:8px"><span>Your Sleeper username (to find your team)</span><input type="text" id="m-user2" value="${esc(S.p.lastUsername)}"></label>
      <div class="chips" style="margin-top:10px"><button class="btn primary" data-act="m-load-draft">Add</button><button class="btn" data-act="m-step" data-v="choose">Back</button></div>
      ${m.error ? `<p class="risk-High small">${esc(m.error)}</p>` : ''}${m.loading ? '<p class="muted small">Loading…</p>' : ''}`;
  } else if (m.step === 'practice') {
    const srcs = S.p.leagues.filter((l) => l.kind === 'sleeper');
    inner = `${close}<h2>Practice draft</h2>
      <div class="formgrid">
        <label class="field"><span>Name</span><input type="text" id="m-name" value="Practice ${S.p.leagues.filter((l) => l.kind === 'practice').length + 1}"></label>
        <label class="field"><span>Draft type</span><select id="m-pool"><option value="startup">Startup (everyone)</option><option value="rookie">Rookie draft</option></select></label>
        <label class="field"><span>Teams</span><input type="number" id="m-teams" min="4" max="32" value="12"></label>
        <label class="field"><span>Rounds</span><input type="number" id="m-rounds" min="1" max="40" value="22"></label>
        <label class="field"><span>Your slot</span><input type="number" id="m-slot" min="1" max="32" value="1"></label>
        <label class="field"><span>Order</span><select id="m-type"><option value="snake">Snake</option><option value="3rr">Snake + 3rd-round reversal</option><option value="linear">Linear</option></select></label>
        <label class="field"><span>Opponents</span><select id="m-cpu"><option value="mixed">Mixed strategies</option>${Object.entries(PERSONAS).map(([k, v]) => `<option value="${k}">All ${esc(v.label)}</option>`).join('')}</select></label>
        ${srcs.length ? `<label class="field"><span>Copy teams, rosters & order from</span><select id="m-copy"><option value="">— none —</option>${srcs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      <p class="small muted">Copying a real league uses its scoring, rosters and your team; perfect for rehearsing your rookie draft.</p>
      <div class="chips" style="margin-top:10px"><button class="btn primary" data-act="m-create-practice">Start practice</button><button class="btn" data-act="m-step" data-v="choose">Back</button></div>`;
  } else if (m.step === 'manual') {
    inner = `${close}<h2>League not on Sleeper yet</h2>
      <div class="formgrid">
        <label class="field"><span>Name</span><input type="text" id="m-name" value="New startup"></label>
        <label class="field"><span>Teams</span><input type="number" id="m-teams" min="4" max="32" value="12"></label>
        <label class="field"><span>Rounds</span><input type="number" id="m-rounds" min="1" max="40" value="25"></label>
        <label class="field"><span>Your slot</span><input type="number" id="m-slot" min="1" max="32" value="1"></label>
        <label class="field"><span>Stage</span><select id="m-phase"><option value="startup">Startup</option><option value="existing">Existing (rookie draft)</option></select></label>
      </div>
      <p class="small muted">Default format: superflex, full PPR, TE +1.0/rec, 4-pt pass TD. Edit it in League settings. Click players to record each pick as it happens.</p>
      <div class="chips" style="margin-top:10px"><button class="btn primary" data-act="m-create-manual">Create</button><button class="btn" data-act="m-step" data-v="choose">Back</button></div>`;
  } else if (m.step === 'import') {
    inner = `${close}<h2>Import backup</h2><p class="small muted">Choose a backup file or paste its contents. This replaces the leagues, tags and notes in this browser.</p>
      <input type="file" id="m-file" accept="application/json,.json"><textarea id="m-json" placeholder="{…}" style="margin-top:8px"></textarea>
      <div class="chips" style="margin-top:10px"><button class="btn primary" data-act="m-import-go">Import</button></div>`;
  } else if (m.step === 'export') {
    inner = `${close}<h2>Backup</h2><p class="small muted">A file download started. You can also copy this text.</p><textarea id="m-json" style="min-height:200px">${esc(JSON.stringify(S.p))}</textarea>
      <div class="chips" style="margin-top:10px"><button class="btn" data-act="m-copy">Copy</button></div>`;
  } else if (m.step === 'delete') {
    inner = `<h2>Remove “${esc(active()?.name)}”?</h2><p class="muted">Its picks and settings are deleted from this browser. Tags and notes stay.</p>
      <div class="chips"><button class="btn danger" data-act="m-delete-go">Remove</button><button class="btn" data-act="m-close">Cancel</button></div>`;
  }
  box.innerHTML = `<div class="box" role="dialog" aria-modal="true">${inner}</div>`;
}

async function findLeagues() {
  const user = $('#m-user').value.trim(), season = +$('#m-season').value;
  Object.assign(S.modal, { username: user, season, loading: true, error: null, leagues: null });
  renderModal();
  try {
    const u = await sleeper.user(user);
    if (!u?.user_id) throw new Error('No Sleeper user with that name');
    S.p.lastUsername = user;
    S.modal.userId = u.user_id;
    S.modal.leagues = (await sleeper.leagues(u.user_id, season)) || [];
    save();
  } catch (e) { S.modal.error = e.message; }
  S.modal.loading = false;
  renderModal();
}

async function loadDraftLink() {
  const ref = parseSleeperRef($('#m-draft').value);
  const user = $('#m-user2').value.trim();
  Object.assign(S.modal, { link: $('#m-draft').value, loading: true, error: null });
  renderModal();
  try {
    if (!ref) throw new Error('That doesn’t look like a Sleeper league or draft link');
    if (user) S.p.lastUsername = user;
    let draft = null;
    if (ref.kind !== 'league') draft = await sleeper.draft(ref.id).catch(() => null);
    if (!draft && ref.kind !== 'draft') {
      const league = await sleeper.league(ref.id);
      if (league) return addSleeperLeague(league, user);
    }
    if (!draft) throw new Error('No Sleeper league or draft with that ID');
    const lg = newLeague(draft.league_id ? 'sleeper' : 'mock', draft.metadata?.name || 'Sleeper draft', { sleeper: { draftId: draft.draft_id, leagueId: draft.league_id || null, username: user } });
    if (!draft.league_id) lg.phase = draft.settings?.player_type === 1 ? 'existing' : 'startup';
    S.p.leagues.push(lg);
    S.modal = null;
    S.p.view = 'board';
    await activate(lg);
  } catch (e) {
    S.modal.error = e.message;
    S.modal.loading = false;
    renderModal();
  }
}

async function addSleeperLeague(league, username) {
  const lg = newLeague('sleeper', league.name, { sleeper: { leagueId: league.league_id, username: username || S.p.lastUsername, userId: S.modal?.userId } });
  applySleeperConfig(lg, league);
  lg.configSet = true;
  S.p.leagues.push(lg);
  S.modal = null;
  S.p.view = 'board';
  await activate(lg);
  const L = S.live.get(lg.id);
  if (lg.phase === 'existing' && L?.draft?.status !== 'drafting' && ['in_season', 'post_season'].includes(L?.league?.status)) {
    S.p.view = 'lineup'; save(); render();
  }
}

function createPractice(kind) {
  const v = (id) => $(id)?.value;
  const name = v('#m-name') || (kind === 'practice' ? 'Practice' : 'League');
  const lg = newLeague(kind, name);
  const T = Math.max(4, Math.min(32, +v('#m-teams') || 12));
  lg.config.teams = T;
  lg.practice.rounds = Math.max(1, Math.min(40, +v('#m-rounds') || 20));
  lg.practice.mySlot = Math.max(1, Math.min(T, +v('#m-slot') || 1));
  const type = v('#m-type') || 'snake';
  lg.practice.type = type === 'linear' ? 'linear' : 'snake';
  lg.practice.reversal = type === '3rr';
  lg.practice.cpu = v('#m-cpu') || 'mixed';
  if (kind === 'manual') { lg.phase = v('#m-phase') || 'startup'; }
  if (v('#m-pool') === 'rookie') { lg.phase = 'existing'; lg.config.rookies = 'only'; lg.prefs.horizon = 0.7; lg.practice.type = 'linear'; }
  const copy = v('#m-copy');
  if (copy) {
    const src = S.p.leagues.find((l) => l.id === copy);
    lg.practice.copyFrom = copy;
    lg.config = JSON.parse(JSON.stringify(src.config));
    if (v('#m-pool') === 'rookie') lg.config.rookies = 'only';
    lg.phase = v('#m-pool') === 'rookie' ? 'existing' : src.phase;
  }
  S.p.leagues.push(lg);
  S.modal = null;
  S.p.view = 'board';
  activate(lg);
}

// ---------------- events ----------------
const ACT = {
  tab: (el) => { S.page = 'league'; S.drawer = null; const lg = S.p.leagues.find((l) => l.id === el.dataset.id); if (lg) activate(lg, { full: !S.live.get(lg.id) }); },
  'add-league': () => { S.modal = { step: 'choose' }; renderModal(); },
  method: () => { S.page = S.page === 'method' ? 'league' : 'method'; render(); },
  view: (el) => { S.page = 'league'; S.p.view = el.dataset.v; save(); render(); window.scrollTo(0, 0); },
  player: (el, e) => { e.preventDefault(); S.drawer = el.dataset.id; renderDrawer(); },
  'close-drawer': () => { S.drawer = null; renderDrawer(); },
  tag: (el) => {
    const id = el.dataset.id, v = el.dataset.v;
    const t = S.p.tags[id] || (S.p.tags[id] = {});
    t.t = t.t === v ? undefined : v;
    save(); render();
  },
  draft: (el) => draftPlayer(active(), el.dataset.id),
  mark: (el) => {
    const lg = active(), B = boardInfo(lg);
    if (!B.state?.onClock) return;
    lg.manual = [...(lg.manual || []), { no: B.state.onClock.no, pid: el.dataset.id }];
    save(); S.drawer = null; render(); toast('Marked. Sleeper’s pick replaces it when sync returns.');
  },
  ui: (el) => { ui[el.dataset.k] = el.dataset.v; render(); },
  sort: (el) => {
    const k = el.dataset.k;
    if (ui.sort === k) ui.flip = !ui.flip;
    else { ui.sort = k; ui.flip = false; }
    render();
  },
  more: () => { ui.limit += 150; render(); },
  sync: () => { const lg = active(); if (lg.kind === 'sleeper' || lg.kind === 'mock') sync(lg).then(() => schedulePoll(lg)); },
  'sync-full': () => { const lg = active(); sync(lg, { full: true }).then(() => schedulePoll(lg)); },
  'toggle-live': () => {
    const lg = active(), L = S.live.get(lg.id);
    if (!L) return;
    L.polling = !L.polling;
    if (L.polling) sync(lg, { quiet: true }).then(() => schedulePoll(lg));
    else clearTimeout(pollTimers.get(lg.id));
    render();
  },
  'pull-config': () => { const lg = active(), L = S.live.get(lg.id); if (L?.league) { applySleeperConfig(lg, L.league); save(); render(); toast('Scoring and lineup pulled from Sleeper'); } },
  undo: () => {
    const lg = active(), P = lg.practice;
    clearTimeout(simTimer);
    if (lg.kind === 'manual') P.picks.pop();
    else {
      const ctx = practiceCtx(lg, getModel(lg));
      while (P.picks.length) {
        const x = P.picks.pop();
        if (ctx.order[x.no - 1]?.owner === ctx.myKey) break;
      }
    }
    save(); render(); runCpu(lg);
  },
  autopick: () => {
    const lg = active(), B = boardInfo(lg);
    const oc = B.state.onClock;
    if (!oc) return;
    if (oc.owner === B.ctx.myKey) { if (B.recs[0]) draftPlayer(lg, B.recs[0].p.id); } else runCpu(lg);
  },
  restart: () => {
    const lg = active();
    clearTimeout(simTimer);
    lg.practice.picks = [];
    lg.practice.seed = Math.floor(Math.random() * 1e9);
    lg.practice.personas = null;
    save(); render(); runCpu(lg);
  },
  export: () => { download(`draft-war-room-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S.p, null, 1)); S.modal = { step: 'export' }; renderModal(); },
  import: () => { S.modal = { step: 'import' }; renderModal(); },
  'delete-league': () => { S.modal = { step: 'delete' }; renderModal(); },
  'refresh-market': async () => {
    try { const r = await refreshMarket(S.data); S.models.clear(); render(); toast(`Market values updated (${r.date}, ${r.updated} players)`); } catch (e) { toast(e.message); }
  },
  'refresh-sleeper': async () => { await ensureSleeperDB(true); S.models.clear(); render(); toast('Sleeper player list refreshed'); },
  'lu-mode': (el) => { ui.luMode = el.dataset.v; render(); },
  'lu-seg': (el) => { ui.luSeg = el.dataset.v; render(); },
  'lu-open': () => { ui.luOpen = !ui.luOpen; render(); },
  'wv-pos': (el) => { ui.wvPos = el.dataset.v; render(); },
  'tr-seg': (el) => { ui.trSeg = el.dataset.v; render(); },
  'tr-window': (el) => { const lg = active(); lg.tradeWindow = el.dataset.v; save(); render(); },
  'tr-toggle': (el) => {
    const lg = active(), T = tradeCtx(lg), id = el.dataset.id, a = T?.assets.get(id);
    if (!a) return;
    if (a.owner === T.me.rid) ui.trGive = ui.trGive.includes(id) ? ui.trGive.filter((x) => x !== id) : [...ui.trGive, id];
    else {
      if (+ui.trPartner !== a.owner) { ui.trPartner = a.owner; ui.trGet = []; }
      ui.trGet = ui.trGet.includes(id) ? ui.trGet.filter((x) => x !== id) : [...ui.trGet, id];
    }
    ui.trSeg = 'builder'; render();
  },
  'tr-open': (el) => {
    ui.trPartner = +el.dataset.partner;
    ui.trGive = (el.dataset.give || '').split(',').filter(Boolean);
    ui.trGet = (el.dataset.get || '').split(',').filter(Boolean);
    ui.trSeg = 'builder'; S.p.view = 'trades'; S.drawer = null; save(); render(); renderDrawer(); window.scrollTo(0, 0);
  },
  'tr-clear': () => { ui.trGive = []; ui.trGet = []; render(); },
  'tr-top': () => { document.querySelector('.tb-eval')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'tr-shop': (el) => { ui.trShop = ui.trShop === el.dataset.id && S.p.view === 'trades' ? null : el.dataset.id; ui.trSeg = 'ideas'; S.p.view = 'trades'; S.drawer = null; save(); render(); renderDrawer(); },
  'tr-target': (el) => {
    const lg = active(), T = tradeCtx(lg), a = T?.assets.get(el.dataset.id);
    if (!a) return;
    ui.trPartner = a.owner; ui.trGet = [a.id]; ui.trGive = []; ui.trSeg = 'builder'; S.p.view = 'trades'; S.drawer = null; save(); render(); renderDrawer(); window.scrollTo(0, 0);
  },
  'tr-ideas-target': (el) => { ui.trTarget = ui.trTarget === el.dataset.id ? null : el.dataset.id; render(); },
  'lu-refresh': async () => {
    const lg = active(), X = S.lastLU;
    await sync(lg, { full: true, quiet: true });
    if (X?.week) await loadWeek(lg, X.week, { force: true });
    render(); toast('Rosters, projections, lines and weather refreshed');
  },
  'lu-injuries': async () => { await ensureSleeperDB(true); toast('Injury statuses refreshed from Sleeper'); },
  'm-close': () => { S.modal = null; renderModal(); },
  'm-step': (el) => { S.modal = { step: el.dataset.v }; renderModal(); },
  'm-find': () => findLeagues(),
  'm-pick': (el) => { const l = S.modal.leagues.find((x) => x.league_id === el.dataset.id); addSleeperLeague(l, S.modal.username); },
  'm-load-draft': () => loadDraftLink(),
  'm-create-practice': () => createPractice('practice'),
  'm-create-manual': () => createPractice('manual'),
  'm-copy': async () => { try { await navigator.clipboard.writeText($('#m-json').value); toast('Copied'); } catch { $('#m-json').select(); } },
  'm-import-go': async () => {
    let txt = $('#m-json').value.trim();
    const f = $('#m-file').files?.[0];
    if (f) txt = await f.text();
    try {
      const obj = JSON.parse(txt);
      if (!Array.isArray(obj.leagues)) throw new Error('Not a Draft War Room backup');
      S.p = { ...S.p, ...obj };
      S.models.clear(); S.live.clear();
      save(); S.modal = null;
      const lg = active();
      if (lg) activate(lg); else render();
      toast('Backup imported');
    } catch (e) { toast(e.message); }
  },
  'm-delete-go': () => {
    const lg = active();
    clearTimeout(pollTimers.get(lg.id));
    S.p.leagues = S.p.leagues.filter((l) => l.id !== lg.id);
    S.live.delete(lg.id); S.models.delete(lg.id);
    S.p.active = S.p.leagues[0]?.id || null;
    S.modal = null; S.p.view = 'board';
    save();
    const nx = active();
    if (nx) activate(nx); else render();
  },
};

function onInput(e) {
  const el = e.target;
  const lg = active();
  if (el.dataset.ui) { ui[el.dataset.ui] = el.value; ui.limit = 150; render(); return; }
  if (el.dataset.pref && lg) {
    lg.prefs[el.dataset.pref] = +el.value / 100;
    save();
    clearTimeout(onInput.t);
    onInput.t = setTimeout(render, 120);
    return;
  }
  if (el.dataset.note) {
    const t = S.p.tags[el.dataset.note] || (S.p.tags[el.dataset.note] = {});
    t.note = el.value;
    clearTimeout(onInput.n);
    onInput.n = setTimeout(save, 300);
  }
}

function onChange(e) {
  const el = e.target;
  const lg = active();
  if (!lg) return;
  if (el.dataset.uiCheck) { ui[el.dataset.uiCheck] = el.checked; render(); return; }
  if (el.dataset.lu) { ui[el.dataset.lu] = el.value; render(); return; }
  if (el.dataset.tr) {
    ui[el.dataset.tr] = el.value;
    if (el.dataset.tr === 'trPartner') ui.trGet = [];
    if (el.dataset.tr === 'trMe') { ui.trGive = []; ui.trGet = []; }
    render(); return;
  }
  if (el.dataset.lg) {
    lg[el.dataset.lg] = el.value;
    if (el.dataset.lg === 'phase') { lg.phaseSet = true; S.models.delete(lg.id); }
    save(); render(); return;
  }
  if (el.dataset.cfg) {
    const k = el.dataset.cfg;
    if (k === 'teams') lg.config.teams = Math.max(4, Math.min(32, +el.value || 12));
    else if (k === 'lineup') {
      const l = el.value.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter((s) => SLOT_ELIG[s]);
      if (l.length) lg.config.lineup = l; else toast('Lineup not recognised');
    } else lg.config[k] = el.value;
    save(); render(); return;
  }
  if (el.dataset.score) {
    lg.config.scoring[el.dataset.score] = +el.value || 0;
    save(); render(); return;
  }
  if (el.dataset.sl) {
    const k = el.dataset.sl;
    lg.sleeper[k] = el.value || null;
    if (k === 'username') lg.sleeper.userId = null;
    save();
    if (k === 'myKey') render(); else sync(lg, { full: true }).then(() => schedulePoll(lg));
    return;
  }
  if (el.dataset.pr) {
    const k = el.dataset.pr, P = lg.practice;
    if (k === 'type') { P.type = el.value === 'linear' ? 'linear' : 'snake'; P.reversal = el.value === '3rr'; }
    else if (k === 'cpu') { P.cpu = el.value; P.personas = null; }
    else if (k === 'speed') P.speed = +el.value;
    else P[k] = Math.max(1, +el.value || 1);
    if (k !== 'speed') { P.picks = []; clearTimeout(simTimer); }
    save(); render(); runCpu(lg);
  }
}

async function init() {
  $('#main').innerHTML = '<div class="wrap empty-state"><h2>Loading player data…</h2></div>';
  const saved = loadState();
  if (saved) S.p = { ...S.p, ...saved };
  try {
    const { data, prospects } = await loadData();
    S.data = data; S.prospects = prospects;
  } catch (e) {
    $('#main').innerHTML = `<div class="wrap empty-state"><h2>Couldn’t load player data</h2><p class="muted">${esc(e.message)}. Open this app through a web server (GitHub Pages or <code>python3 -m http.server</code>), not as a file.</p></div>`;
    return;
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e);
  });
  $('#scrim').addEventListener('click', () => { S.drawer = null; renderDrawer(); });
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { S.drawer = null; S.modal = null; renderDrawer(); renderModal(); } });
  document.addEventListener('visibilitychange', () => { const lg = active(); if (lg && !document.hidden) schedulePoll(lg); });
  setInterval(() => { for (const el of document.querySelectorAll('[data-ago]')) el.textContent = 'Updated ' + ago(+el.dataset.ago); }, 5000);
  const lg = active();
  if (lg) activate(lg); else render();
  if (S.p.leagues.some((l) => l.kind === 'sleeper' || l.kind === 'mock')) ensureSleeperDB();
}

init();
window.__dwr = { S, boardInfo, getModel, lineupInfo: () => lineupInfo(active()) };
