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

function api(url) {
  const path = new URL(url).pathname.replace('/v1', '');
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
  if (path === '/draft/D1') return draft();
  if (path === '/draft/D1/picks') return picks();
  if (path === '/draft/D1/traded_picks') return [{ season: '2027', round: 4, roster_id: 2, owner_id: 1, previous_owner_id: 2 }];
  if (path === '/players/nfl') return players;
  if (path === '/state/nfl') return { season: '2026', week: 12 };
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
  await page.route('https://api.sleeper.app/**', (r) => {
    const body = api(r.request().url());
    return body == null ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  return page;
}

const page = await newPage({ width: 1440, height: 900 });
await page.goto(BASE);
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
await page.click('.subnav >> text=Rankings');
await page.waitForSelector('table');
await page.screenshot({ path: `${OUT}/05-rankings.png` });
await page.click('.chips >> text=TE');
await page.fill('[data-ui=q]', 'a');
console.log('rankings rows (TE, q=a):', await page.locator('tbody tr').count());
// teams
await page.click('.subnav >> text=Teams');
await page.waitForSelector('.team');
console.log('teams:', await page.locator('.team').count());
await page.screenshot({ path: `${OUT}/06-teams.png`, fullPage: false });
// settings
await page.click('.subnav >> text=League settings');
await page.waitForSelector('text=Scoring');
await page.screenshot({ path: `${OUT}/07-settings.png` });
// practice draft
await page.click('text=+ League');
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
await page.click('.subnav >> text=Teams');
await page.screenshot({ path: `${OUT}/09-practice-teams.png` });
// existing league, rookie draft
await page.click('text=+ League');
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
await page.click('.subnav >> text=Teams');
await page.screenshot({ path: `${OUT}/09c-rookie-teams.png` });
// method
await page.click('text=How it works');
await page.screenshot({ path: `${OUT}/10-method.png` });

// mobile
const m = await newPage({ width: 390, height: 844 });
await m.goto(BASE);
await m.evaluate((s) => localStorage.setItem('dwr:v1', s), await page.evaluate(() => localStorage.getItem('dwr:v1')));
await m.goto(BASE);
await m.waitForSelector('.subnav');
await m.click('.tab >> text=Test Dynasty SF');
await m.click('.subnav >> text=Draft board');
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

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
