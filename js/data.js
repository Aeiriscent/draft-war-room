// Loads the baked dataset and refreshes live pieces (market values, Sleeper players).
import { parseCSV, normName } from './util.js';
import { sleeper, slimPlayers } from './sleeper.js';
import { cacheGet, cacheSet } from './store.js';

export async function loadData() {
  const [data, prospects] = await Promise.all([
    fetch('data/data.json').then((r) => { if (!r.ok) throw new Error('data/data.json missing'); return r.json(); }),
    fetch('data/prospects.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const cached = await cacheGet('market');
  if (cached && cached.date > data.meta.valuesDate) applyMarket(data, cached.rows, cached.date);
  return { data, prospects };
}

// DynastyProcess publishes fresh values (scraped from FantasyPros ECR) with open CORS.
export async function refreshMarket(data) {
  const res = await fetch('https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Values download failed (${res.status})`);
  const rows = parseCSV(await res.text()).map((r) => ({
    n: r.player, p: r.pos, v1: +r.value_1qb, v2: +r.value_2qb, e2: r.ecr_2qb === 'NA' ? null : +r.ecr_2qb,
    ep: r.ecr_pos === 'NA' ? null : +r.ecr_pos, date: r.scrape_date,
  }));
  const date = rows[0]?.date || new Date().toISOString().slice(0, 10);
  const updated = applyMarket(data, rows, date);
  await cacheSet('market', { date, rows });
  return { date, updated };
}

function applyMarket(data, rows, date) {
  const idx = new Map(rows.map((r) => [normName(r.n) + '|' + r.p, r]));
  let n = 0;
  for (const p of data.players) {
    const r = idx.get(normName(p.n) + '|' + p.p);
    if (!r) continue;
    p.v1 = r.v1; p.v2 = r.v2; p.e2 = r.e2; p.ep = r.ep;
    n++;
  }
  data.meta.valuesDate = date;
  return n;
}

// Sleeper asks apps to fetch the full player list at most once a day.
// Sleeper asks apps to pull the full player file sparingly (about daily). The Lineup view allows a 12h refresh
// on game weeks because injury designations change fast; the timestamp is shown so you know how fresh it is.
export let sleeperPlayersAt = 0;
export async function loadSleeperPlayers({ force = false, maxAgeH = null } = {}) {
  const cached = await cacheGet('sleeperPlayers');
  const today = new Date().toISOString().slice(0, 10);
  const fresh = cached && (maxAgeH != null ? Date.now() - (cached.at || 0) < maxAgeH * 3600e3 : cached.date === today);
  if (fresh && !force) { sleeperPlayersAt = cached.at || Date.parse(cached.date); return cached.players; }
  try {
    const players = slimPlayers(await sleeper.players());
    const at = Date.now();
    await cacheSet('sleeperPlayers', { date: today, at, players });
    sleeperPlayersAt = at;
    return players;
  } catch (e) {
    if (cached) { sleeperPlayersAt = cached.at || Date.parse(cached.date); return cached.players; }
    throw e;
  }
}

// Fresh schedule + betting lines for a season from nflverse (open CORS). Falls back to the baked copy.
export async function loadSchedule(season, fallback) {
  const key = 'schedule-' + season;
  const cached = await cacheGet(key);
  if (cached && Date.now() - cached.at < 3 * 3600e3) return cached.rows;
  try {
    const res = await fetch('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const num = (v) => (v === '' || v === 'NA' || v == null ? null : +v);
    const rows = parseCSV(await res.text())
      .filter((r) => +r.season === +season && r.game_type === 'REG')
      .map((r) => [+r.week, r.gameday, r.gametime, r.away_team, r.home_team, num(r.spread_line), num(r.total_line),
        r.roof && r.roof !== 'NA' ? r.roof : null, r.stadium_id || null, num(r.away_score), num(r.home_score)]);
    if (!rows.length) throw new Error('no rows');
    await cacheSet(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return cached?.rows || fallback || [];
  }
}

// Kickoff-hour forecast for outdoor/retractable stadiums from Open-Meteo (free, no key, open CORS).
const wxCache = new Map();
export async function loadWeather(games) {
  const out = {};
  const now = Date.now();
  const jobs = [];
  const seen = new Set();
  for (const g of games.values()) {
    if (!g.kick || g.roof === 'dome' || g.lat == null) continue;
    const k = g.stadium + '|' + g.day;
    if (seen.has(k)) continue;
    seen.add(k);
    const dt = g.kick.getTime() - now;
    if (dt > 15 * 864e5 || dt < -4 * 3600e3) continue;
    const hit = wxCache.get(k);
    if (hit && now - hit.at < 3600e3) { out[k] = hit.wx; continue; }
    const end = new Date(g.kick.getTime() + 864e5).toISOString().slice(0, 10);
    const start = g.kick.toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT&start_date=${start}&end_date=${end}`;
    jobs.push(fetch(url).then((r) => r.json()).then((j) => {
      const mid = new Date(g.kick.getTime() + 90 * 60e3).toISOString().slice(0, 13) + ':00';
      const i = j.hourly.time.indexOf(mid);
      if (i < 0) return;
      const wx = { temp: j.hourly.temperature_2m[i], pop: j.hourly.precipitation_probability?.[i] ?? 0, precip: j.hourly.precipitation[i], wind: j.hourly.wind_speed_10m[i] };
      out[k] = wx;
      wxCache.set(k, { at: now, wx });
    }).catch(() => null));
  }
  await Promise.all(jobs);
  return out;
}
