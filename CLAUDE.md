# Draft War Room: notes for Claude

Static web app (vanilla ES modules, no build step) served by GitHub Pages, plus a Python data pipeline run nightly by GitHub Actions.

## Commands
- `python3 -m http.server 8000` serves the app (modules need http, not file://).
- `npm test` runs the unit tests (`node --test tests/*.test.js`). Run them after any change to `js/`.
- `node tests/e2e/run.mjs` runs the browser smoke test against a mocked Sleeper API. It needs playwright and a server on :8765, and writes screenshots to `$OUT` (default `/tmp/shots`).
- `npm run data` runs fetch → build_data → build_prospects (needs pandas).

## Architecture
- Pure logic, importable in Node: `js/util.js`, `league.js`, `model.js`, `draft.js`, `strategy.js`, `sim.js`, `weekly.js`. Keep DOM out of these.
- UI: `js/ui/app.js` (state, events via `data-act` delegation, live sync, practice engine), `views.js` (HTML-string views), `player.js` (drawer), `h.js` (helpers).
- Model flow: `buildModel(data, prospects, cfg, {sleeper})` computes profiles once per league config, then `rank(model, {horizon, marketTrust})` re-ranks cheaply when the sliders move.
- Player ids: Sleeper id when known, else `g:<gsis>` or `p:<slug>` for pre-draft prospects. Sleeper picks map by Sleeper id.
- Team keys in drafts: `r<roster_id>` for league drafts, `u<user_id>`/`s<slot>` for mocks and practice.
- Weekly lineup: `buildWeek()` builds per-week context (games, defense vs position, statuses), `projectWeek(p, W)` returns expected points with `factors` [{label, mult, tone, why}], `optimize()` fills slots (locked players stay put). App side: `lineupInfo()` in app.js; live inputs are Sleeper matchups + projections (`api.sleeper.app/projections/...`, unofficial), nflverse games.csv (lines), Open-Meteo (weather).
- Team codes: Sleeper uses `LAR`, nflverse `LA`; always pass through `normTeam()`.
- Persisted state: localStorage key `dwr:v1` (leagues, tags/notes, prefs). The Sleeper player DB is cached in IndexedDB, refreshed at most daily.

## Data
- `data/data.json` is built by `pipeline/build_data.py`. Weekly rows are `[yy, week, teamIdx, oppIdx, ...meta.fields]`, and scoring is applied in the browser per league. `schedule` rows are `[week, gameday, gametime(ET), away, home, spread(home+), total, roof, stadium_id, away_score, home_score]`; `stadiums` maps id → [lat, lon, roof].
- `data/prospects.json` is a consensus pre-NFL-draft rookie board. Edit `SOURCES` in `pipeline/build_prospects.py`.

## Conventions
- Default format is the owner's leagues: superflex, full PPR, TE +1.0/rec, 4-pt pass TD.
- Keep views fast: `boardInfo()` is recomputed on each render.
