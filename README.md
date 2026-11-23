# Draft War Room

A dynasty fantasy football assistant built for **superflex, TE-premium** leagues on Sleeper. It grades every player in *your league's* exact scoring, syncs live with your Sleeper draft, tells you who to take and why, reads every other team's strategy as picks come in, and in season tells you who to start each week.

**Live app:** https://aeiriscent.github.io/draft-war-room/

## What it does

| Area | What you get |
|---|---|
| **Player profiles** | Projected PPG for next season, expected games, value over replacement, a 3-year PPG path, a weekly game log in your scoring, role/usage trends, supporting cast, injury history, draft capital, red/green flags, your own notes and Target/Avoid tags. |
| **Grades** | Outlook, Dynasty (3-yr), Ceiling, Floor (how often he's startable), Role, Support cast, Safety. Each is a percentile within the position. |
| **Rankings** | Overall and positional ranks with tiers. Two sliders: *Win now ↔ Dynasty* and *Model ↔ Market*. "vs market" shows where the model disagrees with consensus. |
| **Live draft board** | Polls Sleeper every 3 seconds during a draft. Handles snake, 3rd-round reversal, linear, and traded picks. Shows who's on the clock, your next two picks, and a "Your pick" list with reasons: lineup gain, positional drop-off before your next turn, and the odds a player lasts to you. |
| **Teams** | Every roster plus a strategy read (QB-first, Zero RB, Elite-TE anchor, Youth movement, Win-now, Value hunter, Reaches…), lineup strength, value ranks, needs, and what they'll likely take next. |
| **Weekly lineup** | For any in-season Sleeper league: the best lineup for any team and week, win probability vs your opponent (and vs the league median if your league uses it), and exactly which changes to make in Sleeper. Each player's projection blends Sleeper's projection with recent form adjusted for the opposing defense, Vegas implied totals and spread, home field, kickoff weather, teammate injuries, QB changes, snap trends, and injury/practice status. Lineup styles: Max points, Safe floor, Upside, or Auto (whichever gives the best chance to win). An injury watch names the pivot for every questionable starter. |
| **Leagues** | One tab per league: Sleeper leagues (find them by username or paste a league link), any Sleeper draft link (mocks too), leagues not on Sleeper yet (manual tracker), and **practice drafts**. |
| **Practice drafts** | Rehearse against CPU teams that each run a real strategy (QB-first, Zero RB, Youth movement, TE premium, Robust RB, Market follower, Wildcard…). It can copy a real league's teams, rosters and pick order, so you can mock your actual rookie draft. |

## Setup (one time)

1. **Turn on GitHub Pages:** repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Run it once:** **Actions → "Refresh data & deploy" → Run workflow.** After that it runs every 6 hours and on every push.
3. Open the site, then **+ League → My Sleeper league** (enter your username and pick the league) or **+ League → Paste a Sleeper link**.

On your phone, open the site and use **Add to Home Screen**. It runs like an app.

## How data stays fresh

- **Every 6 hours**, GitHub Actions rebuilds `data/data.json` from [nflverse](https://github.com/nflverse/nflverse-data) (weekly stats, snaps, rosters, injury reports, schedule with betting lines) and [DynastyProcess](https://github.com/dynastyprocess/data) (market values from FantasyPros ECR), then redeploys.
- **In the app:** league settings, rosters, matchups, drafts, picks, weekly projections and injury/practice statuses come live from the [Sleeper API](https://docs.sleeper.com). Betting lines refresh from nflverse's schedule file and kickoff forecasts from [Open-Meteo](https://open-meteo.com). *How it works → Refresh market values* pulls the newest values on demand.
- **Rookie prospects** live in `pipeline/build_prospects.py`. Update the source rankings there as new boards come out. After the NFL draft, rookies are matched to Sleeper automatically.

## Run locally

```bash
python3 -m http.server 8000          # then open http://localhost:8000
npm test                              # unit tests (Node 20+)
npm run data                          # rebuild data (needs: pip install pandas numpy)
```

ES modules need a web server, so double-clicking `index.html` won't work.

## Project layout

```
index.html, css/app.css        UI shell and styles
js/model.js                    player model: projections, grades, risk, flags, ranks, tiers
js/league.js                   lineup slots, scoring, starter demand per position
js/draft.js                    pick order, board state, recommendations, survival odds
js/strategy.js                 team strategy detection and league table
js/sim.js                      practice-draft CPU personas
js/weekly.js                   weekly start/sit: matchup, Vegas, weather, injuries, lineup optimizer, win odds
js/sleeper.js, js/data.js      Sleeper API client, data loading and refresh
js/ui/*.js                     app controller, views, player drawer
pipeline/                      Python data build (fetch.py, build_data.py, build_prospects.py)
tests/                         unit tests + browser e2e (mocked Sleeper)
```

## Not modeled yet

Contracts, coaching changes, IDP and in-game live scoring. Use notes and tags for those for now. Sleeper's API is read-only, so lineup changes are made in Sleeper. The method page in the app explains each step of the model.
