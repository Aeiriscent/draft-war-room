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
export async function loadSleeperPlayers({ force = false } = {}) {
  const cached = await cacheGet('sleeperPlayers');
  const today = new Date().toISOString().slice(0, 10);
  if (cached && cached.date === today && !force) return cached.players;
  try {
    const players = slimPlayers(await sleeper.players());
    await cacheSet('sleeperPlayers', { date: today, players });
    return players;
  } catch (e) {
    if (cached) return cached.players;
    throw e;
  }
}
