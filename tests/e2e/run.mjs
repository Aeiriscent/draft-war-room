// Browser smoke test with a mocked Sleeper API (no network needed). Dev-only:
//   npm i -D playwright && npx playwright install chromium
//   python3 -m http.server 8765 &   node tests/e2e/run.mjs
// Env: PW=<path to playwright module>, CHROME=<browser executable>, OUT=<screenshot dir>
const { chromium } = await import(process.env.PW || 'playwright');
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8765/';
const OUT = process.env.OUT || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const data = JSON.parse(fs.readFileSync(new URL('../../data/data.json', import.meta.url)));
const withSid = data.players.filter((p) => p.sid && p.v2 > 0).sort((a, b) => b.v2 - a.v2);

const lineup = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN'];
const scoring = { rec: 1, bonus_rec_te: 1, pass_td: 4, pass_yd: 0.04, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6, fum_lost: -2 };
const T = 12;
const users = Array.from({ length: T }, (_, i) => ({ user_id: `U${i + 1}`, display_name: i === 0 ? 'testuser' : `Rival${i + 1}`, metadata: i === 2 ? { team_name: 'Gridiron Goons' } : {} }));
const rosters = users.map((u, i) => ({ roster_id: i + 1, owner_id: u.user_id, players: [] }));
const slotToRoster = {}; for (let s = 1; s <= T; s++) slotToRoster[s] = ((s + 4) % T) + 1; // user picks 8th
const draftOrder = Object.fromEntries(Object.entries(slotToRoster).map(([s, r]) => [`U${r}`, +s]));
let pickCount = 9;
const draft = () => ({ draft_id: 'D1', league_id: 'L100', type: 'snake', status: 'drafting', season: '2027', settings: { teams: T, rounds: 6, reversal_round: 3 }, slot_to_roster_id: slotToRoster, draft_order: draftOrder, metadata: { name: 'Startup Draft' }, created: 5 });
function picks() {
  const out = [];
  for (let n = 1; n <= pickCount; n++) {
    const r = Math.ceil(n / T), i = (n - 1) % T;
    let rev = r % 2 === 0; if (r >= 3) rev = !rev;
    const slot = rev ? T - i : i + 1;
    const p = withSid[n * 2 - 1];
    out.push({ pick_no: n, round: r, draft_slot: slot, roster_id: slotToRoster[slot], picked_by: `U${slotToRoster[slot]}`, player_id: p.sid, metadata: { first_name: p.n.split(' ')[0], last_name: p.n.split(' ').slice(1).join(' '), position: p.p, team: p.t } });
  }
  return out;
}
const players = Object.fromEntries(data.players.filter((p) => p.sid).map((p, i) => [p.sid, { first_name: p.n.split(' ')[0], last_name: p.n.split(' ').slice(1).join(' '), full_name: p.n, position: p.p, team: p.t === 'FA' ? null : p.t, years_exp: p.dy ? 2026 - p.dy : 3, injury_status: i % 37 === 0 ? 'Questionable' : null, birth_date: p.bd, status: 'Active', search_rank: i + 1 }]));

// ---- existing 10-team league with full rosters + post-NFL-draft rookies on Sleeper ----
const prospects = JSON.parse(fs.readFileSync(new URL('../../data/prospects.json', import.meta.url))).players;
const NFL = ['NYJ', 'TEN', 'CLE', 'NYG', 'LV', 'NE', 'CAR', 'ARI', 'NO', 'CHI', 'MIA', 'IND', 'JAX', 'WAS', 'SEA', 'DAL', 'PIT', 'GB', 'MIN', 'DEN'];
prospects.slice(0, 30).forEach((pr, i) => {
  players[String(99001 + i)] = { first_name: pr.n.split(' ')[0], last_name: pr.n.split(' ').slice(1).join(' '), full_name: pr.n, position: pr.p, team: NFL[i % NFL.length], years_exp: 0, injury_status: null, birth_date: '2005-03-01', status: 'Active', search_rank: 300 + i };
});
const T2 = 10;
const users2 = Array.from({ length: T2 }, (_, i) => ({ user_id: i === 0 ? 'U1' : `V${i + 1}`, display_name: i === 0 ? 'testuser' : `Vet${i + 1}` }));
const rosters2 = users2.map((u, i) => ({ roster_id: i + 1, owner_id: u.user_id, players: withSid.filter((_, k) => k % T2 === i).slice(0, 24).map((p) => p.sid), settings: { wins: i } }));
const slot2 = {}; for (let s = 1; s <= T2; s++) slot2[s] = T2 - s + 1; // worst record picks first; user (roster 1) picks last
let rookiePicks = 3;
const draft2 = () => ({ draft_id: 'D2', league_id: 'L200', type: 'linear', status: 'drafting', season: '2027', settings: { teams: T2, rounds: 3 }, slot_to_roster_id: slot2, draft_order: {}, metadata: { name: '2027 Rookie Draft' }, created: 9 });
const picks2 = () => Array.from({ length: rookiePicks }, (_, k) => {
  const n = k + 1, slot = ((n - 1) % T2) + 1, pr = prospects[k];
  return { pick_no: n, round: Math.ceil(n / T2), draft_slot: slot, roster_id: slot2[slot], player_id: String(99001 + k), metadata: { first_name: pr.n.split(' ')[0], last_name: pr.n.split(' ').slice(1).join(' '), position: pr.p, team: NFL[k], years_exp: '0' } };
});

// ---- in-season league (pasted link) for the weekly Lineup view ----
const L3 = '300300300';
const lineup3 = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR'];
const cur = data.players.filter((p) => p.sid && p.w.some((r) => 2000 + r[0] === data.meta.season)).sort((a, b) => b.v1 - a.v1 || b.v2 - a.v2);
const DEFS = ['BUF', 'KC', 'PHI', 'DAL', 'SF', 'DET', 'BAL', 'MIA', 'GB', 'LAR'];
DEFS.forEach((t, i) => { players[t] = { first_name: t, last_name: 'D/ST', position: 'DEF', team: t, status: 'Active' }; players['K' + i] = { full_name: `Kicker ${t}`, position: 'K', team: t, status: 'Active' }; });
const W3 = [4, 8, 7, 5, 9, 6, 3, 10, 2, 6];
const rosters3 = users2.map((u, i) => ({ roster_id: i + 1, owner_id: u.user_id, players: [...cur.filter((_, k) => k % T2 === i).slice(0, 17).map((p) => p.sid), 'K' + i, DEFS[i]], reserve: [], taxi: [],
  settings: { wins: W3[i], losses: 12 - W3[i], fpts: 1300 + i * 17 } }));
const byPos = (ids, pos) => ids.filter((id) => players[id]?.position === pos);
function setStarters(r, i) {
  const ids = [...r.players], used = new Set(), take = (ok, worst = false) => {
    let c = ids.filter((id) => !used.has(id) && ok.includes(players[id]?.position));
    if (worst) c = c.reverse();
    const id = c[0] || '0'; used.add(id); return id;
  };
  // the user's team starts its worst RB and leaves a FLEX empty, so there is something to fix
  return lineup3.filter((s) => !['BN', 'IR'].includes(s)).map((s, k) => {
    if (i === 0 && s === 'FLEX' && k === 7) return '0';
    const ok = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'] }[s];
    return take(ok, i === 0 && s === 'RB');
  });
}
// games already played this week (before today) have real points in Sleeper's matchup feed
const today = new Date().toISOString().slice(0, 10);
const playedTeams = new Set(data.schedule.filter((g) => g[0] === 12 && g[1] < today).flatMap((g) => [g[3], g[4]]));
const fixTeam = (t) => (t === 'LAR' ? 'LA' : t);
const ptsFor = (id) => (playedTeams.has(fixTeam(players[id]?.team)) ? Math.round((3 + (parseInt(String(id).replace(/\D/g, '') || '7', 10) % 23)) * 10) / 10 : 0);
const matchups3 = rosters3.map((r, i) => {
  const players_points = Object.fromEntries(r.players.map((id) => [id, ptsFor(id)]));
  const starters = setStarters(r, i);
  return { roster_id: r.roster_id, matchup_id: Math.floor(i / 2) + 1, players: r.players, starters, points: starters.reduce((s, id) => s + (players_points[id] || 0), 0), players_points };
});
const statLine = { QB: { pass_yd: 245, pass_td: 1.7, pass_int: 0.7, rush_yd: 18 }, RB: { rush_yd: 62, rush_td: 0.45, rec: 3, rec_yd: 22 }, WR: { rec: 5.2, rec_yd: 64, rec_td: 0.38 }, TE: { rec: 4.1, rec_yd: 41, rec_td: 0.3 } };
function projections(url) {
  const pos = new URL(url).searchParams.get('position[]');
  return rosters3.flatMap((r) => r.players).filter((id) => players[id]?.position === pos).map((id, k) => {
    const f = 1.25 - (k % 9) * 0.06;
    const stats = pos === 'K' ? { pts_ppr: 8 } : pos === 'DEF' ? { pts_ppr: 7 } : Object.fromEntries(Object.entries(statLine[pos]).map(([s, v]) => [s, v * f]));
    return { player_id: id, stats };
  });
}
const L3league = { league_id: L3, name: 'Season League', season: '2026', total_rosters: T2, status: 'in_season', settings: { type: 2, league_average_match: 1 }, roster_positions: lineup3, scoring_settings: scoring };

function api(url) {
  const path = new URL(url).pathname.replace('/v1', '');
  if (path.startsWith('/projections/nfl/')) return projections(url);
  if (path === `/league/${L3}`) return L3league;
  if (path === `/league/${L3}/rosters`) return rosters3;
  if (path === `/league/${L3}/users`) return users2;
  if (path === `/league/${L3}/drafts`) return [];
  if (path === `/league/${L3}/matchups/12`) return matchups3;
  if (path === `/league/${L3}/traded_picks`) return [{ season: '2027', round: 1, roster_id: 9, owner_id: 1, previous_owner_id: 9 }, { season: '2027', round: 2, roster_id: 1, owner_id: 4, previous_owner_id: 1 }];
  if (/^\/league\/300300300\/matchups\/\d+$/.test(path)) return [];
  if (path === '/user/testuser') return { user_id: 'U1', display_name: 'testuser' };
  if (/^\/user\/U\d+$/.test(path)) return users.find((u) => path.endsWith(u.user_id));
  if (path.startsWith('/user/U1/leagues/nfl/')) return [{ league_id: 'L100', name: 'Test Dynasty SF', total_rosters: T, status: 'drafting', settings: { type: 2 }, roster_positions: lineup, scoring_settings: scoring },
    { league_id: 'L200', name: 'Vets League', total_rosters: T2, status: 'drafting', settings: { type: 2 }, roster_positions: lineup, scoring_settings: scoring }];
  if (path === '/league/L200') return { league_id: 'L200', name: 'Vets League', total_rosters: T2, status: 'drafting', settings: { type: 2 }, roster_positions: lineup, scoring_settings: scoring, previous_league_id: 'L199' };
  if (path === '/league/L200/rosters') return rosters2;
  if (path === '/league/L200/users') return users2;
  if (path === '/league/L200/drafts') return [draft2()];
  if (path === '/league/L200/traded_picks') return [];
  if (path === '/draft/D2') return draft2();
  if (path === '/draft/D2/picks') return picks2();
  if (path === '/draft/D2/traded_picks') return [{ season: '2027', round: 1, roster_id: 6, owner_id: 1, previous_owner_id: 6 }];
  if (path === '/league/L100') return { league_id: 'L100', name: 'Test Dynasty SF', total_rosters: T, status: 'drafting', settings: { type: 2 }, roster_positions: lineup, scoring_settings: scoring };
  if (path === '/league/L100/rosters') return rosters;
  if (path === '/league/L100/users') return users;
  if (path === '/league/L100/drafts') return [draft()];
  if (path === '/league/L100/traded_picks') return [];
  if (path === '/draft/D1') return draft();
  if (path === '/draft/D1/picks') return picks();
  if (path === '/draft/D1/traded_picks') return [{ season: '2027', round: 4, roster_id: 2, owner_id: 1, previous_owner_id: 2 }];
  if (path === '/players/nfl') return players;
  if (path === '/state/nfl') return { season: '2026', week: 12, display_week: 12, season_type: 'regular' };
  return null;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
const errors = [];
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|favicon|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.route('https://raw.githubusercontent.com/**', (r) => r.abort());
  await page.route('https://api.open-meteo.com/**', (r) => {
    const u = new URL(r.request().url());
    const start = Date.parse(u.searchParams.get('start_date') + 'T00:00:00Z');
    const time = Array.from({ length: 48 }, (_, h) => new Date(start + h * 3600e3).toISOString().slice(0, 13) + ':00');
    const lat = +u.searchParams.get('latitude');
    const windy = lat > 42; // northern outdoor stadiums get a nasty day
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ hourly: { time, temperature_2m: time.map(() => (windy ? 21 : 55)), precipitation_probability: time.map(() => (windy ? 75 : 5)), precipitation: time.map(() => (windy ? 0.06 : 0)), wind_speed_10m: time.map(() => (windy ? 22 : 6)) } }) });
  });
  await page.route('https://api.sleeper.app/**', (r) => {
    const body = api(r.request().url());
    return body == null ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  return page;
}

const page = await newPage({ width: 1440, height: 900 });
await page.goto(BASE);
const nav = (p, name) => p.click(`.navlist >> text="${name}"`);
const addLeague = async (p) => { await p.click('#rail [data-act=menu][data-v=leagues]'); await p.click('#rail .menu .add'); };
const switchLeague = async (p, name, mobile = false) => { const root = mobile ? '#topbar' : '#rail'; await p.click(`${root} [data-act=menu][data-v=leagues]`); await p.click(`${root} .menu >> text=${name}`); };
await page.waitForSelector('text=Add your first league');
await page.screenshot({ path: `${OUT}/01-welcome.png` });
// add Sleeper league
await page.click('text=Add your first league');
await page.click('text=My Sleeper league');
await page.fill('#m-user', 'testuser');
await page.click('text=Find my leagues');
await page.click('text=Test Dynasty SF');
await page.waitForSelector('.clock');
await page.waitForTimeout(600);
const clockTxt = await page.textContent('.clock');
console.log('clock:', clockTxt.replace(/\s+/g, ' ').trim());
await page.screenshot({ path: `${OUT}/02-board.png`, fullPage: false });
// advance picks to reach my turn (slot 8 -> pick 8 taken already; next mine at 17 in round 2)
pickCount = 16;
await page.click('text=Sync now');
await page.waitForTimeout(700);
console.log('after sync clock:', (await page.textContent('.clock')).replace(/\s+/g, ' ').trim());
console.log('top rec:', (await page.textContent('.rec.first')).replace(/\s+/g, ' ').trim().slice(0, 200));
await page.screenshot({ path: `${OUT}/03-board-mypick.png` });
// player drawer
await page.click('.rec.first a');
await page.waitForSelector('#drawer:not([hidden]) .grades');
await page.screenshot({ path: `${OUT}/04-drawer.png` });
await page.click('[data-act=tag][data-v=target]');
await page.keyboard.press('Escape');
// rankings
await nav(page, 'Rankings');
await page.waitForSelector('table');
await page.screenshot({ path: `${OUT}/05-rankings.png` });
await page.click('.segc >> text=TE');
await page.fill('[data-ui=q]', 'a');
console.log('rankings rows (TE, q=a):', await page.locator('tbody tr').count());
// teams
await nav(page, 'Teams');
await page.waitForSelector('.team');
console.log('teams:', await page.locator('.team').count());
await page.screenshot({ path: `${OUT}/06-teams.png`, fullPage: false });
// settings
await nav(page, 'Settings');
await page.waitForSelector('text=Scoring');
await page.screenshot({ path: `${OUT}/07-settings.png` });
// practice draft
await addLeague(page);
await page.click('text=Practice draft');
await page.fill('#m-teams', '10');
await page.fill('#m-rounds', '12');
await page.fill('#m-slot', '4');
await page.selectOption('#m-pool', 'startup');
await page.click('text=Start practice');
await page.waitForSelector('.clock.mine', { timeout: 15000 });
console.log('practice clock:', (await page.textContent('.clock')).replace(/\s+/g, ' ').trim());
await page.click('.rec.first [data-act=draft]');
await page.waitForSelector('.clock.mine', { timeout: 15000 });
console.log('after my pick:', (await page.textContent('.clock')).replace(/\s+/g, ' ').trim());
await page.screenshot({ path: `${OUT}/08-practice.png` });
await page.click('text=Auto-draft my pick');
await page.waitForTimeout(3000);
await nav(page, 'Teams');
await page.screenshot({ path: `${OUT}/09-practice-teams.png` });
// existing league, rookie draft
await addLeague(page);
await page.click('text=My Sleeper league');
await page.fill('#m-user', 'testuser');
await page.click('text=Find my leagues');
await page.click('text=Vets League');
await page.waitForSelector('.clock');
await page.waitForTimeout(1200);
console.log('rookie clock:', (await page.textContent('.clock')).replace(/\s+/g, ' ').trim());
console.log('rookie next:', (await page.locator('.status .panel').nth(1).textContent()).replace(/\s+/g, ' ').trim());
console.log('rookie top rec:', (await page.textContent('.rec.first .row1')).replace(/\s+/g, ' ').trim());
console.log('rookie available count:', await page.locator('.p-players tbody tr').count());
await page.screenshot({ path: `${OUT}/09b-rookie-board.png` });
await nav(page, 'Teams');
await page.screenshot({ path: `${OUT}/09c-rookie-teams.png` });
// in-season league from a pasted link -> Lineup view
await addLeague(page);
await page.click('text=Paste a Sleeper link');
await page.fill('#m-draft', `https://sleeper.com/leagues/${L3}/team`);
await page.fill('#m-user2', 'testuser');
await page.click('[data-act=m-load-draft]');
await page.waitForSelector('.score-band', { timeout: 20000 }).catch(async (e) => {
  await page.screenshot({ path: `${OUT}/14-lineup-fail.png` });
  console.log('errors:', errors, (await page.textContent('#main')).slice(0, 300));
  throw e;
});
await page.waitForTimeout(800);
console.log('lineup matchup:', (await page.textContent('.score-band')).replace(/\s+/g, ' ').trim());
console.log('lineup changes:', (await page.textContent('.moves')).replace(/\s+/g, ' ').trim().slice(0, 400));
console.log('played teams this week:', [...playedTeams].join(','), '| final rows:', await page.locator('.lu-row.st-final').count(), '| upcoming rows:', await page.locator('.lu-row.st-upcoming').count());
console.log('status bar:', (await page.textContent('.lu-status')).replace(/\s+/g, ' ').trim());
console.log('lineup sources:', (await page.textContent('.datafoot')).replace(/\s+/g, ' ').trim());
console.log('starter rows:', await page.locator('.c-list .sect >> nth=0 >> .lu-row').count());
await page.screenshot({ path: `${OUT}/14-lineup.png`, fullPage: true });
await page.emulateMedia({ colorScheme: 'light' });
await page.screenshot({ path: `${OUT}/14b-lineup-light.png`, fullPage: false });
await page.emulateMedia({ colorScheme: 'dark' });
await page.click('.c-list .lu-row.click >> nth=0');
await page.waitForSelector('#drawer:not([hidden]) .dtabs');
console.log('drawer week:', (await page.textContent('#drawer .dbody')).replace(/\s+/g, ' ').trim().slice(0, 300));
await page.screenshot({ path: `${OUT}/15-lineup-drawer.png` });
await page.keyboard.press('Escape');
await page.click('[data-act=lu-mode][data-v=upside]');
await page.selectOption('[data-lu=luTeam]', '4');
await page.waitForTimeout(300);
console.log('other team matchup:', (await page.textContent('.score-band')).replace(/\s+/g, ' ').trim());
await page.selectOption('[data-lu=luTeam]', '1');
await page.click('[data-act=lu-mode][data-v=auto]');
// roster breakdown + waiver wire
await page.click('[data-act=lu-seg][data-v=roster]');
await page.waitForSelector('.pcard');
console.log('roster cards:', await page.locator('.pcard').count());
await page.click('.pcard >> nth=0 >> summary');
await page.waitForTimeout(200);
console.log('first card:', (await page.locator('.pcard >> nth=0').textContent()).replace(/\s+/g, ' ').trim().slice(0, 700));
await page.screenshot({ path: `${OUT}/17-roster-breakdown.png`, fullPage: false });
await page.click('[data-act=lu-seg][data-v=waiver]');
await page.waitForSelector('.wv-row');
console.log('waiver rows:', await page.locator('.wv-row').count(), '|', (await page.locator('.wv-row >> nth=0').textContent()).replace(/\s+/g, ' ').trim().slice(0, 250));
await page.screenshot({ path: `${OUT}/18-waiver.png` });
await page.click('[data-act=lu-seg][data-v=week]');
// trades
await nav(page, 'Trades');
await page.waitForSelector('.trade-band');
console.log('trade head:', (await page.textContent('.trade-band')).replace(/\s+/g, ' ').trim());
console.log('ready offers:', await page.locator('.offer').count(), '| sells:', await page.locator('[data-act=tr-shop]').count(), '| buys:', await page.locator('[data-act=tr-ideas-target]').count());
await page.screenshot({ path: `${OUT}/19-trades-ideas.png`, fullPage: true });
if (await page.locator('[data-act=tr-ideas-target]').count()) {
  await page.click('[data-act=tr-ideas-target] >> nth=0');
  await page.waitForTimeout(300);
  console.log('target offers:', await page.locator('.idea-offers .offer').count());
}
if (await page.locator('[data-act=tr-shop]').count()) {
  await page.click('[data-act=tr-shop] >> nth=0');
  await page.waitForTimeout(300);
  console.log('shop offers:', await page.locator('.idea-offers .offer').count());
}
await page.click('[data-act=tr-seg][data-v=builder]');
await page.waitForSelector('.as-row');
await page.click('.tb-top .sect >> nth=0 >> .as-row >> nth=2');
await page.click('.tb-top .sect >> nth=1 >> .as-row >> nth=1');
await page.waitForSelector('.tb-eval .cmp');
console.log('builder eval:', (await page.textContent('.tb-eval')).replace(/\s+/g, ' ').trim().slice(0, 600));
await page.screenshot({ path: `${OUT}/20-trade-builder.png`, fullPage: true });
await page.click('[data-act=tr-seg][data-v=chart]');
await page.waitForSelector('.scroll table tbody tr');
console.log('value chart rows:', await page.locator('.scroll table tbody tr').count());
await page.click('.scroll table tbody tr.click >> nth=0');
await page.waitForSelector('#drawer:not([hidden]) .dtabs');
console.log('drawer tabs:', await page.locator('#drawer .dtabs button').allTextContents());
await page.click('#drawer [data-act=dtab][data-v=outlook]');
console.log('drawer outlook:', (await page.textContent('#drawer .dbody')).replace(/\s+/g, ' ').trim().slice(0, 200));
await page.screenshot({ path: `${OUT}/21-drawer-outlook.png`, fullPage: false });
await page.keyboard.press('Escape');
// method
await page.click('#rail >> text=How it works');
await page.screenshot({ path: `${OUT}/10-method.png` });

// mobile
const m = await newPage({ width: 390, height: 844 });
await m.goto(BASE);
await m.evaluate((s) => localStorage.setItem('dwr:v1', s), await page.evaluate(() => localStorage.getItem('dwr:v1')));
await m.goto(BASE);
await m.waitForSelector('.tabbar');
await switchLeague(m, 'Test Dynasty SF', true);
await m.click('.tabbar >> text=Draft');
await m.waitForSelector('.clock');
await m.waitForTimeout(500);
await m.screenshot({ path: `${OUT}/11-mobile-board.png` });
await m.click('.seg >> text=Players');
await m.screenshot({ path: `${OUT}/12-mobile-players.png` });
await m.click('.p-players tbody tr >> nth=0');
await m.waitForSelector('#drawer:not([hidden]) .grades');
await m.screenshot({ path: `${OUT}/13-mobile-drawer.png` });
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log('mobile horizontal overflow:', overflow);
await m.keyboard.press('Escape');
await switchLeague(m, 'Season League', true);
await m.click('.tabbar >> text=Lineup');
await m.waitForSelector('.score-band', { timeout: 20000 });
await m.waitForTimeout(500);
await m.screenshot({ path: `${OUT}/16-mobile-lineup.png`, fullPage: true });
console.log('mobile lineup overflow:', await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
await m.click('[data-act=lu-seg][data-v=roster]');
await m.waitForSelector('.pcard');
await m.click('.pcard >> nth=0 >> summary');
await m.screenshot({ path: `${OUT}/22-mobile-roster.png`, fullPage: false });
console.log('mobile roster overflow:', await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
await m.click('.tabbar >> text=Trades');
await m.waitForSelector('.trade-band');
await m.screenshot({ path: `${OUT}/23-mobile-trades.png`, fullPage: true });
console.log('mobile trades overflow:', await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
await m.click('[data-act=tr-seg][data-v=builder]');
await m.waitForSelector('.as-row');
await m.click('.tb-top .sect >> nth=0 >> .as-row >> nth=1');
await m.click('.tb-top .sect >> nth=1 >> .as-row >> nth=0');
await m.waitForSelector('.tb-eval .cmp');
await m.screenshot({ path: `${OUT}/24-mobile-builder.png`, fullPage: false });
console.log('mobile builder overflow:', await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
