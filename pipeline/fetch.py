"""Download the open data the app is built from into pipeline/.raw/.

Usage: python3 pipeline/fetch.py [raw_dir]
Seasons: the latest NFL season (Sept-Feb belongs to that year's season) and the one before it.
Files that are not published yet (e.g. a brand-new season in early September) are skipped.
"""
import datetime
import os
import sys
import urllib.request

RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '.raw')
os.makedirs(RAW, exist_ok=True)

today = datetime.date.today()
cur = today.year if today.month >= 9 else today.year - 1
SEASONS = [cur - 1, cur]

NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download'
DP = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files'
files = []
for s in SEASONS:
    files += [
        (f'{NFLVERSE}/stats_player/stats_player_week_{s}.csv', f'stats_player_week_{s}.csv'),
        (f'{NFLVERSE}/snap_counts/snap_counts_{s}.csv', f'snap_counts_{s}.csv'),
        (f'{NFLVERSE}/weekly_rosters/roster_weekly_{s}.csv', f'roster_weekly_{s}.csv'),
        (f'{NFLVERSE}/injuries/injuries_{s}.csv', f'injuries_{s}.csv'),
    ]
files += [
    ('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', 'games.csv'),
    (f'{DP}/values-players.csv', 'values-players.csv'),
    (f'{DP}/values-picks.csv', 'values-picks.csv'),
    (f'{DP}/db_playerids.csv', 'db_playerids.csv'),
]

for url, name in files:
    dest = os.path.join(RAW, name)
    try:
        with urllib.request.urlopen(url, timeout=180) as r, open(dest, 'wb') as f:
            f.write(r.read())
        print(f'ok   {name} ({os.path.getsize(dest):,} bytes)')
    except Exception as e:  # missing season files are expected early in a season
        print(f'skip {name}: {e}')
