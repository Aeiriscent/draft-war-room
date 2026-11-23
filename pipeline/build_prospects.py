"""Builds data/prospects.json: a consensus board of the next rookie class before the NFL draft.

Edit SOURCES when new rankings come out, then run: python3 pipeline/build_prospects.py
Consensus rank = mean of each source's rank; a source that does not list a player counts as rank 48.
After the NFL draft the app matches these names to Sleeper's player database, and the nightly data
build picks up the rookies' real draft capital and market values.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'prospects.json')
CLASS = 2027
MISSING = 48

SOURCES = {
    'Dynasty Nerds SF/TEP mock (Oct 6, 2026)': {
        'url': 'https://www.dynastynerds.com/?p=171015',
        'ranks': ['Jeremiah Smith', 'Jadan Baugh', 'Kewan Lacy', 'Arch Manning', 'Darian Mensah', 'Julian Sayin',
                  'Trinidad Chambliss', 'Dante Moore', 'Cam Coleman', 'Jamari Johnson', 'Charlie Becker',
                  'Jayden Maiava', 'CJ Carr', 'Drew Mestemaker', 'KJ Duff', 'Justice Haynes',
                  'Ryan Coleman-Williams', 'Fluff Bothwell', 'Nate Frazier', 'Ahmad Hardy', 'Mark Fletcher Jr.',
                  'Reed Harris', 'Nick Marsh', "Trey'Dez Green", 'Brendan Sorsby', 'Ryan Wingo',
                  'Daylan Smothers', 'LaNorris Sellers', 'LJ Martin', 'Carlos Hernandez', 'Nico Iamaleava',
                  'Anthony Evans III', 'Bryant Wesco Jr.', 'Duce Robinson', 'Deuce Alexander', 'Omarion Miller'],
    },
    'Draft Sharks SF rookie rankings (Nov 4, 2026)': {
        'url': 'https://www.draftsharks.com/article/2027-superflex-rookie-rankings',
        'ranks': ['Jeremiah Smith', 'Charlie Becker', 'Drew Mestemaker', 'Jadan Baugh', 'Darian Mensah',
                  'Cam Coleman', 'KJ Duff', 'Nick Marsh', 'Kewan Lacy', 'Dante Moore', 'Trinidad Chambliss',
                  'Jamari Johnson', "Trey'Dez Green", 'Reed Harris', 'Jackson Harris', 'Deuce Alexander',
                  'Duce Robinson', 'Ahmad Hardy', 'Mark Fletcher Jr.', 'CJ Carr', 'Jamal Roberts',
                  'Ryan Coleman-Williams', 'Ryan Wingo', 'Dylan Riley', 'Austin Simmons', 'Isaac Brown',
                  'Isaiah Sategna III', 'DJ Vonnahme', 'Arch Manning', 'LaNorris Sellers', 'Bryant Wesco Jr.',
                  'Antwan Raymond', 'LJ Martin', 'Wyatt Young', 'Mario Craver', 'Luke Reynolds', 'Cameron Dickey',
                  'Jayden Maiava', 'Omarion Miller', 'Raleek Brown'],
    },
}

INFO = {  # position, school
    'Jeremiah Smith': ('WR', 'Ohio State'), 'Jadan Baugh': ('RB', 'Florida'), 'Kewan Lacy': ('RB', 'Ole Miss'),
    'Arch Manning': ('QB', 'Texas'), 'Darian Mensah': ('QB', 'Miami'), 'Julian Sayin': ('QB', 'Ohio State'),
    'Trinidad Chambliss': ('QB', 'Ole Miss'), 'Dante Moore': ('QB', 'Oregon'), 'Cam Coleman': ('WR', 'Texas'),
    'Jamari Johnson': ('TE', 'Oregon'), 'Charlie Becker': ('WR', 'Indiana'), 'Jayden Maiava': ('QB', 'USC'),
    'CJ Carr': ('QB', 'Notre Dame'), 'Drew Mestemaker': ('QB', 'Oklahoma State'), 'KJ Duff': ('WR', 'Rutgers'),
    'Justice Haynes': ('RB', 'Georgia Tech'), 'Ryan Coleman-Williams': ('WR', 'Alabama'),
    'Fluff Bothwell': ('RB', 'Mississippi State'), 'Nate Frazier': ('RB', 'Georgia'), 'Ahmad Hardy': ('RB', 'Missouri'),
    'Mark Fletcher Jr.': ('RB', 'Miami'), 'Reed Harris': ('WR', 'Arizona State'), 'Nick Marsh': ('WR', 'Indiana'),
    "Trey'Dez Green": ('TE', 'LSU'), 'Brendan Sorsby': ('QB', 'Cincinnati'), 'Ryan Wingo': ('WR', 'Texas'),
    'Daylan Smothers': ('RB', 'Texas'), 'LaNorris Sellers': ('QB', 'South Carolina'), 'LJ Martin': ('RB', 'BYU'),
    'Carlos Hernandez': ('WR', 'Wake Forest'), 'Nico Iamaleava': ('QB', 'UCLA'),
    'Anthony Evans III': ('WR', 'Mississippi State'), 'Bryant Wesco Jr.': ('WR', 'Clemson'),
    'Duce Robinson': ('WR', 'Florida State'), 'Deuce Alexander': ('WR', 'Ole Miss'),
    'Omarion Miller': ('WR', 'Arizona State'), 'Jackson Harris': ('WR', 'LSU'), 'Jamal Roberts': ('RB', 'Missouri'),
    'Dylan Riley': ('RB', 'Boise State'), 'Austin Simmons': ('QB', 'Missouri'), 'Isaac Brown': ('RB', 'Louisville'),
    'Isaiah Sategna III': ('WR', 'Oklahoma'), 'DJ Vonnahme': ('TE', 'Iowa'), 'Antwan Raymond': ('RB', 'Rutgers'),
    'Wyatt Young': ('WR', 'Oklahoma State'), 'Mario Craver': ('WR', 'Texas A&M'), 'Luke Reynolds': ('TE', 'Virginia Tech'),
    'Cameron Dickey': ('RB', 'Texas Tech'), 'Raleek Brown': ('RB', 'Texas'),
}

NOTES = {
    'Arch Manning': 'Footballguys (Oct 21, 2026): likely to return to school or transfer. Confirm he declares.',
}

names = sorted({n for s in SOURCES.values() for n in s['ranks']})
rows = []
for n in names:
    ranks = {k: (s['ranks'].index(n) + 1 if n in s['ranks'] else None) for k, s in SOURCES.items()}
    cons = sum(r or MISSING for r in ranks.values()) / len(ranks)
    pos, school = INFO[n]
    rows.append({'n': n, 'p': pos, 'col': school, 'ranks': list(ranks.values()), 'cons': round(cons, 2),
                 'note': NOTES.get(n)})
rows.sort(key=lambda r: r['cons'])
for i, r in enumerate(rows):
    r['rank'] = i + 1

out = {'class': CLASS, 'sources': [{'name': k, 'url': v['url']} for k, v in SOURCES.items()], 'players': rows}
with open(OUT, 'w') as f:
    json.dump(out, f, indent=1)
print(len(rows), 'prospects;', ', '.join(f"{r['rank']}. {r['n']}" for r in rows[:12]))
