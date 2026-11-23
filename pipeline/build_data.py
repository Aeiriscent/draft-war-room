"""Builds data.json for the Draft War Room app.

Sources (all public, open data):
  - nflverse weekly player stats, snap counts, weekly rosters, injury reports (2025, 2026)
  - nflverse games schedule
  - DynastyProcess dynasty values (FantasyPros ECR based) + player ID map
Run:  python3 build_data.py <raw_dir> <out_json>
"""
import sys, json, math, datetime, re
import pandas as pd
import numpy as np

import glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '.raw')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', 'data', 'data.json')
# seasons = the two most recent seasons whose weekly stats file exists
SEASONS = sorted(int(re.search(r'(\d{4})', os.path.basename(p)).group(1))
                 for p in glob.glob(os.path.join(RAW, 'stats_player_week_*.csv')))[-2:]
POS = ['QB', 'RB', 'WR', 'TE']

F = ['cmp', 'att', 'pyd', 'ptd', 'int', 'pfd', 'p2', 'car', 'ryd', 'rtd', 'rfd', 'r2',
     'rec', 'tgt', 'reyd', 'retd', 'refd', 're2', 'fl', 'snap', 'ts', 'cs']
SRC = {'cmp': 'completions', 'att': 'attempts', 'pyd': 'passing_yards', 'ptd': 'passing_tds',
       'int': 'passing_interceptions', 'pfd': 'passing_first_downs', 'p2': 'passing_2pt_conversions',
       'car': 'carries', 'ryd': 'rushing_yards', 'rtd': 'rushing_tds', 'rfd': 'rushing_first_downs',
       'r2': 'rushing_2pt_conversions', 'rec': 'receptions', 'tgt': 'targets', 'reyd': 'receiving_yards',
       'retd': 'receiving_tds', 'refd': 'receiving_first_downs', 're2': 'receiving_2pt_conversions',
       'fl': 'fumbles_lost_total'}


def rd(path, **kw):
    return pd.read_csv(os.path.join(RAW, path), low_memory=False, **kw)


def rd_seasons(prefix):
    frames = [rd(f'{prefix}_{s}.csv') for s in SEASONS if os.path.exists(os.path.join(RAW, f'{prefix}_{s}.csv'))]
    return pd.concat(frames) if frames else pd.DataFrame()


# ---------- IDs + market values ----------
ids = rd('db_playerids.csv')
ids = ids[ids.position.isin(POS)].copy()
vals = rd('values-players.csv')
scrape_date = str(vals.scrape_date.iloc[0])

# ---------- weekly stats ----------
wk = pd.concat([rd(f'stats_player_week_{s}.csv') for s in SEASONS])
wk = wk[(wk.season_type == 'REG') & (wk.position.isin(POS))].copy()
for c in SRC.values():
    wk[c] = wk[c].fillna(0)
# team carries per game -> carry share
tc = wk.groupby(['season', 'week', 'team'])['carries'].sum().rename('team_car')
wk = wk.join(tc, on=['season', 'week', 'team'])
wk['cs'] = np.where(wk.team_car > 0, wk.carries / wk.team_car * 100, 0)
wk['ts'] = wk.target_share.fillna(0) * 100

# snap counts (offense %) joined via pfr id
snaps = rd_seasons('snap_counts')
snaps = snaps[snaps.game_type == 'REG'][['season', 'week', 'pfr_player_id', 'offense_snaps', 'offense_pct', 'team']]
gs2pfr = ids.dropna(subset=['gsis_id', 'pfr_id']).set_index('gsis_id')['pfr_id'].to_dict()
# weekly rosters also carry pfr ids - fill gaps
ros = rd_seasons('roster_weekly')
ros = ros[ros.game_type == 'REG']
for _, r in ros.dropna(subset=['gsis_id', 'pfr_id']).drop_duplicates('gsis_id').iterrows():
    gs2pfr.setdefault(r.gsis_id, r.pfr_id)
wk['pfr'] = wk.player_id.map(gs2pfr)
snap_map = snaps.set_index(['season', 'week', 'pfr_player_id'])['offense_pct'].to_dict()
wk['snap'] = [snap_map.get((s, w, p), np.nan) for s, w, p in zip(wk.season, wk.week, wk.pfr)]
wk['snap'] = (wk['snap'] * 100).round()

# games played via snaps for players with snaps but no stat line (e.g. 0-catch games)
snap_games = snaps[snaps.offense_snaps > 0]

# ---------- player universe ----------
# market players
vals = vals.merge(ids[['fantasypros_id', 'sleeper_id', 'gsis_id']].dropna(subset=['fantasypros_id'])
                  .astype({'fantasypros_id': int}).drop_duplicates('fantasypros_id'),
                  left_on='fp_id', right_on='fantasypros_id', how='left')
# production players not in market list
ppr = wk.groupby('player_id').agg(g=('week', 'count'), pts=('fantasy_points_ppr', 'sum'))
ppr['ppg'] = ppr.pts / ppr.g
prod_ids = set(ppr[(ppr.g >= 3) & (ppr.ppg >= 6)].index)
uni_gsis = set(vals.gsis_id.dropna()) | prod_ids

# current team / status from latest weekly roster
ros_sorted = ros.sort_values(['season', 'week'])
latest = ros_sorted.drop_duplicates('gsis_id', keep='last').set_index('gsis_id')

idx = ids.drop_duplicates('gsis_id').set_index('gsis_id')

teams = sorted(set(wk.team.dropna()) | set(wk.opponent_team.dropna()))
tix = {t: i for i, t in enumerate(teams)}

# injuries: weeks missed due to IR/reserve or reported Out and did not play
inj = rd_seasons('injuries')
inj = inj[inj.season_type == 'REG']
games = rd('games.csv')
games = games[(games.season.isin(SEASONS)) & (games.game_type == 'REG') & games.home_score.notna()]
team_weeks = {}
for _, g in games.iterrows():
    for t in (g.home_team, g.away_team):
        team_weeks.setdefault((g.season, t), set()).add(int(g.week))
cur_week = int(games[games.season == SEASONS[-1]].week.max())

played = set(zip(wk.player_id, wk.season, wk.week))
pfr2gs = {v: k for k, v in gs2pfr.items()}
for s, w, p in zip(snap_games.season, snap_games.week, snap_games.pfr_player_id):
    g = pfr2gs.get(p)
    if g:
        played.add((g, s, w))

ros_status = ros.set_index(['gsis_id', 'season', 'week'])['status'].to_dict()
ros_team = ros.set_index(['gsis_id', 'season', 'week'])['team'].to_dict()
inj_out = inj[inj.report_status.isin(['Out', 'Doubtful'])]
inj_out_set = set(zip(inj_out.gsis_id, inj_out.season, inj_out.week))
inj_body = inj.dropna(subset=['report_primary_injury'])
inj_body = inj_body[inj_body.report_status.isin(['Out', 'Doubtful', 'Questionable'])]


PRACT = {'Did Not Participate In Practice': 'DNP', 'Limited Participation in Practice': 'LP', 'Full Participation in Practice': 'FP'}
cur_inj = inj[inj.season == SEASONS[-1]]
latest_report = {}
if len(cur_inj):
    last_wk = int(cur_inj.week.max())
    for r in cur_inj[cur_inj.week == last_wk].itertuples():
        latest_report[r.gsis_id] = [last_wk, r.report_status if isinstance(r.report_status, str) else None,
                                    PRACT.get(r.practice_status), (r.report_primary_injury if isinstance(r.report_primary_injury, str) else
                                                                  r.practice_primary_injury if isinstance(r.practice_primary_injury, str) else None)]


def injury_profile(g):
    out = {}
    for s in SEASONS:
        missed = gp = 0
        player_weeks = [(w, ros_team.get((g, s, w))) for w in range(1, 19)]
        for w, t in player_weeks:
            if t is None or w not in team_weeks.get((s, t), set()):
                continue
            st = ros_status.get((g, s, w))
            if (g, s, w) in played:
                gp += 1
            elif st == 'RES' or (g, s, w) in inj_out_set or st == 'INA' and (g, s, w) in inj_out_set:
                missed += 1
        out[str(s)] = [gp, missed]
    body = inj_body[inj_body.gsis_id == g].report_primary_injury.str.title().value_counts().head(3)
    return out, [[k, int(v)] for k, v in body.items()]


# ---------- team context ----------
def team_ctx(season):
    w = wk[wk.season == season]
    g = games[games.season == season]
    ctx = {}
    for t in teams:
        tg = g[(g.home_team == t) | (g.away_team == t)]
        n = len(tg)
        if not n:
            continue
        pts = sum(r.home_score if r.home_team == t else r.away_score for r in tg.itertuples())
        allowed = sum(r.away_score if r.home_team == t else r.home_score for r in tg.itertuples())
        tw = w[w.team == t]
        by = tw.groupby('position')['fantasy_points_ppr'].sum() / n
        qb = tw[tw.position == 'QB'].groupby('player_display_name')['fantasy_points_ppr'].agg(['sum', 'count'])
        qb_ppg = float((qb['sum'].sum() / n)) if len(qb) else 0
        top_qb = qb.sort_values('count', ascending=False).index[0] if len(qb) else ''
        ctx[t] = {'g': n, 'ppg': round(pts / n, 1), 'opp': round(allowed / n, 1), 'pa': round(tw.attempts.sum() / n, 1),
                  'ra': round(tw.carries.sum() / n, 1),
                  'fp': {p: round(float(by.get(p, 0)), 1) for p in POS},
                  'qbppg': round(qb_ppg, 1), 'qb': top_qb}
    return ctx


team_context = {str(s): team_ctx(s) for s in SEASONS}

# defense vs position: PPR points allowed per game (blend 2026 heavier)
dvp = {}
for s, wgt in zip(SEASONS, ([1.0] if len(SEASONS) == 1 else [0.35, 0.65])):
    w = wk[wk.season == s]
    a = w.groupby(['opponent_team', 'position'])['fantasy_points_ppr'].sum()
    for (t, p), v in a.items():
        n = len(team_weeks.get((s, t), [])) or 1
        dvp.setdefault(t, {}).setdefault(p, 0)
        dvp[t][p] += wgt * v / n
dvp = {t: {p: round(v, 1) for p, v in d.items()} for t, d in dvp.items()}

# ---------- assemble players ----------
players = []
vals_by_gsis = vals.dropna(subset=['gsis_id']).drop_duplicates('gsis_id').set_index('gsis_id')
seen_names = set()
for g in uni_gsis:
    base = idx.loc[g] if g in idx.index else None
    lr = latest.loc[g] if g in latest.index else None
    mv = vals_by_gsis.loc[g] if g in vals_by_gsis.index else None
    name = (mv.player if mv is not None else None) or (base['name'] if base is not None else None) \
        or (lr.full_name if lr is not None else None)
    if not isinstance(name, str):
        continue
    pos = (mv.pos if mv is not None else None) or (base.position if base is not None else None)
    if pos not in POS:
        continue
    sid = None
    for src in (mv, base, lr):
        if src is not None and 'sleeper_id' in src and pd.notna(src['sleeper_id']):
            sid = str(int(float(src['sleeper_id'])))
            break
    pw = wk[wk.player_id == g].sort_values(['season', 'week'])
    weekly = []
    for r in pw.itertuples():
        row = [int(r.season) - 2000, int(r.week), tix.get(r.team, -1), tix.get(r.opponent_team, -1)]
        for f in F:
            v = getattr(r, SRC[f]) if f in SRC else getattr(r, f)
            v = 0 if v is None or (isinstance(v, float) and math.isnan(v)) else v
            row.append(round(float(v), 1) if f in ('snap', 'ts', 'cs') else int(round(float(v))))
        if np.isnan(r.snap) if isinstance(r.snap, float) else False:
            row[4 + F.index('snap')] = -1
        weekly.append(row)
    injp, body = injury_profile(g)
    bd = base.birthdate if base is not None and pd.notna(base.birthdate) else (
        lr.birth_date if lr is not None and pd.notna(lr.birth_date) else None)
    dy = base.draft_year if base is not None and pd.notna(base.draft_year) else (
        lr.entry_year if lr is not None and pd.notna(lr.entry_year) else None)
    dr = base.draft_round if base is not None and pd.notna(base.draft_round) else None
    dov = base.draft_ovr if base is not None and pd.notna(base.draft_ovr) else (
        lr.draft_number if lr is not None and pd.notna(lr.draft_number) else None)
    team = (lr.team if lr is not None and lr.season == SEASONS[-1] else None) or (
        mv.team if mv is not None else None) or (base.team if base is not None else None)
    iw = latest_report.get(g)
    p = {
        'gid': g, 'sid': sid, 'n': name, 'p': pos, 'iw': iw, 't': team if isinstance(team, str) else 'FA',
        'bd': str(bd)[:10] if bd else None,
        'dy': int(dy) if dy else None, 'dr': int(dr) if dr else None, 'do': int(dov) if dov else None,
        'col': base.college if base is not None and isinstance(base.college, str) else None,
        'v2': int(mv.value_2qb) if mv is not None else 0, 'v1': int(mv.value_1qb) if mv is not None else 0,
        'e2': float(mv.ecr_2qb) if mv is not None and pd.notna(mv.ecr_2qb) else None,
        'ep': float(mv.ecr_pos) if mv is not None and pd.notna(mv.ecr_pos) else None,
        'st': lr.status if lr is not None and lr.season == SEASONS[-1] else None,
        'dc': lr.depth_chart_position if lr is not None and isinstance(lr.depth_chart_position, str) else None,
        'inj': injp, 'ib': body, 'w': weekly,
    }
    players.append(p)

# market-only players with no gsis (e.g. players DP lists but id map lacks)
for r in vals[vals.gsis_id.isna()].itertuples():
    players.append({'gid': None, 'sid': str(int(r.sleeper_id)) if pd.notna(r.sleeper_id) else None,
                    'n': r.player, 'p': r.pos, 't': r.team if isinstance(r.team, str) else 'FA',
                    'bd': None, 'age': float(r.age) if pd.notna(r.age) else None,
                    'dy': int(r.draft_year) if pd.notna(r.draft_year) else None, 'dr': None, 'do': None,
                    'col': None, 'v2': int(r.value_2qb), 'v1': int(r.value_1qb),
                    'e2': float(r.ecr_2qb) if pd.notna(r.ecr_2qb) else None,
                    'ep': float(r.ecr_pos) if pd.notna(r.ecr_pos) else None,
                    'st': None, 'dc': None, 'inj': {}, 'ib': [], 'w': []})

# current-season schedule with betting lines (spread_line > 0 means the home team is favored)
all_games = rd('games.csv')
sg = all_games[(all_games.season == SEASONS[-1]) & (all_games.game_type == 'REG')].sort_values(['week', 'gameday', 'gametime'])
nz = lambda v: None if (v is None or (isinstance(v, float) and math.isnan(v))) else v
schedule = [[int(r.week), r.gameday, r.gametime, r.away_team, r.home_team, nz(r.spread_line), nz(r.total_line),
             nz(r.roof), nz(r.stadium_id), nz(r.away_score), nz(r.home_score)] for r in sg.itertuples()]
STADIUMS = {  # lat, lon, roof (dome | retractable | outdoors)
    'ATL97': [33.7554, -84.4009, 'retractable'], 'BAL00': [39.2780, -76.6227, 'outdoors'], 'BOS00': [42.0909, -71.2643, 'outdoors'],
    'BUF00': [42.7738, -78.7870, 'outdoors'], 'CAR00': [35.2258, -80.8528, 'outdoors'], 'CHI98': [41.8623, -87.6167, 'outdoors'],
    'CIN00': [39.0955, -84.5161, 'outdoors'], 'CLE00': [41.5061, -81.6995, 'outdoors'], 'DAL00': [32.7473, -97.0945, 'retractable'],
    'DEN00': [39.7439, -105.0201, 'outdoors'], 'DET00': [42.3400, -83.0456, 'dome'], 'GNB00': [44.5013, -88.0622, 'outdoors'],
    'HOU00': [29.6847, -95.4107, 'retractable'], 'IND00': [39.7601, -86.1639, 'retractable'], 'JAX00': [30.3239, -81.6373, 'outdoors'],
    'KAN00': [39.0489, -94.4839, 'outdoors'], 'LAX01': [33.9535, -118.3392, 'dome'], 'LON00': [51.5560, -0.2795, 'outdoors'],
    'LON02': [51.6043, -0.0664, 'outdoors'], 'MAD01': [40.4531, -3.6883, 'retractable'], 'MEL00': [-37.8200, 144.9834, 'outdoors'],
    'MEX00': [19.3029, -99.1505, 'outdoors'], 'MIA00': [25.9580, -80.2389, 'outdoors'], 'MIN01': [44.9737, -93.2581, 'dome'],
    'MUN01': [48.2188, 11.6247, 'outdoors'], 'NAS00': [36.1665, -86.7713, 'outdoors'], 'NOR00': [29.9511, -90.0812, 'dome'],
    'NYC01': [40.8135, -74.0745, 'outdoors'], 'PAR00': [48.9245, 2.3602, 'outdoors'], 'PHI00': [39.9008, -75.1675, 'outdoors'],
    'PHO00': [33.5276, -112.2626, 'retractable'], 'PIT00': [40.4468, -80.0158, 'outdoors'], 'RIO00': [-22.9122, -43.2302, 'outdoors'],
    'SEA00': [47.5952, -122.3316, 'outdoors'], 'SFO01': [37.4030, -121.9700, 'outdoors'], 'TAM00': [27.9759, -82.5033, 'outdoors'],
    'VEG00': [36.0909, -115.1833, 'dome'], 'WAS00': [38.9078, -76.8645, 'outdoors'],
}

picks = rd('values-picks.csv')
pick_ecr = [round(float(x), 1) for x in picks[picks.player.str.contains(r'Pick \d\.\d\d', regex=True)]
            .sort_values('pick').drop_duplicates('pick').ecr_2qb.tolist()]

data = {
    'meta': {'built': datetime.date.today().isoformat(), 'season': SEASONS[-1], 'seasons': SEASONS, 'week': cur_week,
             'valuesDate': scrape_date, 'fields': F,
             'sources': [
                 ['nflverse weekly stats, snaps, rosters, injury reports', 'https://github.com/nflverse/nflverse-data'],
                 ['nflverse schedule', 'https://github.com/nflverse/nfldata'],
                 ['DynastyProcess dynasty values (FantasyPros ECR)', 'https://github.com/dynastyprocess/data'],
             ]},
    'teams': teams, 'players': players, 'teamCtx': team_context, 'dvp': dvp, 'pickEcr': pick_ecr,
    'schedule': schedule, 'stadiums': STADIUMS,
}
with open(OUT, 'w') as f:
    json.dump(data, f, separators=(',', ':'))
print('players', len(players), 'with sleeper', sum(1 for p in players if p['sid']),
      'weeks', sum(len(p['w']) for p in players), 'cur_week', cur_week)
