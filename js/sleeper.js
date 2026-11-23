// Sleeper public API (read-only, no auth). Docs: https://docs.sleeper.com
const BASE = 'https://api.sleeper.app/v1';

async function get(path, { timeout = 15000, root = BASE } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(root + path, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Sleeper ${res.status} on ${path}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Sleeper timed out on ${path}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export const sleeper = {
  state: () => get('/state/nfl'),
  user: (nameOrId) => get(`/user/${encodeURIComponent(nameOrId)}`),
  leagues: (userId, season) => get(`/user/${userId}/leagues/nfl/${season}`),
  league: (id) => get(`/league/${id}`),
  rosters: (id) => get(`/league/${id}/rosters`),
  users: (id) => get(`/league/${id}/users`),
  leagueDrafts: (id) => get(`/league/${id}/drafts`),
  leagueTraded: (id) => get(`/league/${id}/traded_picks`),
  draft: (id) => get(`/draft/${id}`),
  picks: (id) => get(`/draft/${id}/picks`),
  draftTraded: (id) => get(`/draft/${id}/traded_picks`),
  players: () => get('/players/nfl', { timeout: 60000 }),
  matchups: (leagueId, week) => get(`/league/${leagueId}/matchups/${week}`),
  // Unofficial but long-standing endpoint used by Sleeper's own app: projected stat lines per player
  async projections(season, week, positions = ['QB', 'RB', 'WR', 'TE']) {
    const res = await Promise.all(positions.map((pos) =>
      get(`/projections/nfl/${season}/${week}?season_type=regular&position[]=${pos}`, { root: 'https://api.sleeper.app' }).catch(() => [])));
    const out = {};
    for (const arr of res) for (const r of arr || []) if (r?.player_id && r.stats) out[String(r.player_id)] = r.stats;
    return out;
  },
};

// Accepts a raw id or any sleeper.com URL containing /draft/... or /league/...
export function parseSleeperRef(input) {
  const s = String(input || '').trim();
  const d = s.match(/draft\/(?:nfl\/)?(\d{6,})/i);
  if (d) return { kind: 'draft', id: d[1] };
  const l = s.match(/leagues?\/(\d{6,})/i);
  if (l) return { kind: 'league', id: l[1] };
  if (/^\d{6,}$/.test(s)) return { kind: 'unknown', id: s };
  return null;
}

// Keep only what the app uses from Sleeper's ~5 MB player file
export function slimPlayers(all) {
  const out = {};
  for (const [id, p] of Object.entries(all || {})) {
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position)) continue;
    if (!p.team && (p.years_exp ?? 0) > 0 && p.status !== 'Active') continue;
    out[id] = {
      full_name: p.position === 'DEF' ? `${p.first_name || p.team} ${p.last_name || 'D/ST'}`.trim() : (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()),
      position: p.position, team: p.team || null, injury_status: p.injury_status || null, years_exp: p.years_exp,
      birth_date: p.birth_date || null, age: p.age, college: p.college, search_rank: p.search_rank, status: p.status,
      injury_body_part: p.injury_body_part || null, injury_notes: p.injury_notes || null,
      practice_participation: p.practice_participation || null, depth_chart_order: p.depth_chart_order ?? null,
      depth_chart_position: p.depth_chart_position || null, news_updated: p.news_updated || null,
    };
  }
  return out;
}
