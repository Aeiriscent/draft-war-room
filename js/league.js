// League format: lineup slots, scoring, and how many starters each position supplies league-wide.
import { POS } from './util.js';

export const DEFAULT_LINEUP = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX'];

// Full PPR, full TE premium (+1.0/rec), 4-pt passing TD — your leagues' format. Editable per league.
export const DEFAULT_SCORING = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2, bonus_rec_te: 1,
};

// Sleeper roster_positions -> eligible fantasy positions
export const SLOT_ELIG = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'],
};
export const SLOT_LABEL = { FLEX: 'W/R/T', SUPER_FLEX: 'SF', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R' };

const SCORE_KEYS = Object.keys({
  pass_yd: 1, pass_td: 1, pass_int: 1, pass_2pt: 1, pass_cmp: 1, pass_inc: 1, pass_att: 1, pass_fd: 1,
  rush_yd: 1, rush_td: 1, rush_2pt: 1, rush_att: 1, rush_fd: 1,
  rec: 1, rec_yd: 1, rec_td: 1, rec_2pt: 1, rec_fd: 1, fum_lost: 1,
  bonus_rec_te: 1, bonus_rec_rb: 1, bonus_rec_wr: 1,
  bonus_pass_yd_300: 1, bonus_pass_yd_400: 1, bonus_rush_yd_100: 1, bonus_rush_yd_200: 1,
  bonus_rec_yd_100: 1, bonus_rec_yd_200: 1,
});

export function scoringFromSleeper(s = {}) {
  const out = {};
  for (const k of SCORE_KEYS) if (s[k] != null && s[k] !== 0) out[k] = Number(s[k]);
  return Object.keys(out).length ? out : { ...DEFAULT_SCORING };
}

export function lineupFromSleeper(rp = []) {
  const l = rp.filter((p) => SLOT_ELIG[p]);
  return l.length ? l : [...DEFAULT_LINEUP];
}

// Field index map built from data.meta.fields; weekly rows start at offset 4
export function makeScorer(fields) {
  const I = Object.fromEntries(fields.map((f, i) => [f, i + 4]));
  return function points(row, sc, pos) {
    const g = (k) => row[I[k]] || 0;
    const s = (k) => sc[k] || 0;
    const pyd = g('pyd'), ryd = g('ryd'), reyd = g('reyd');
    let p = pyd * s('pass_yd') + g('ptd') * s('pass_td') + g('int') * s('pass_int') + g('p2') * s('pass_2pt')
      + g('cmp') * s('pass_cmp') + (g('att') - g('cmp')) * s('pass_inc') + g('att') * s('pass_att') + g('pfd') * s('pass_fd')
      + ryd * s('rush_yd') + g('rtd') * s('rush_td') + g('r2') * s('rush_2pt') + g('car') * s('rush_att') + g('rfd') * s('rush_fd')
      + g('rec') * (s('rec') + s('bonus_rec_' + pos.toLowerCase())) + reyd * s('rec_yd') + g('retd') * s('rec_td')
      + g('re2') * s('rec_2pt') + g('refd') * s('rec_fd') + g('fl') * s('fum_lost');
    if (pyd >= 300) p += s('bonus_pass_yd_300');
    if (pyd >= 400) p += s('bonus_pass_yd_400');
    if (ryd >= 100) p += s('bonus_rush_yd_100');
    if (ryd >= 200) p += s('bonus_rush_yd_200');
    if (reyd >= 100) p += s('bonus_rec_yd_100');
    if (reyd >= 200) p += s('bonus_rec_yd_200');
    return p;
  };
}

export const isSuperflex = (lineup) => lineup.includes('SUPER_FLEX') || lineup.filter((s) => s === 'QB').length >= 2;

// Expected number of starters at each position across the league.
// Flex spots are split by how managers typically fill them; TE premium pushes TEs into flex more.
export function starterDemand(cfg) {
  const { teams, lineup, scoring } = cfg;
  const tep = scoring.bonus_rec_te || 0;
  const d = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const flexShare = { RB: 0.4 - 0.1 * tep, WR: 0.45, TE: 0.15 + 0.1 * tep };
  for (const slot of lineup) {
    if (POS.includes(slot)) d[slot] += 1;
    else if (slot === 'FLEX') for (const p of ['RB', 'WR', 'TE']) d[p] += flexShare[p];
    else if (slot === 'SUPER_FLEX') { d.QB += 0.88; d.RB += 0.05; d.WR += 0.05; d.TE += 0.02; }
    else if (slot === 'REC_FLEX') { d.WR += 0.65; d.TE += 0.35; }
    else if (slot === 'WRRB_FLEX') { d.WR += 0.5; d.RB += 0.5; }
  }
  for (const p of POS) d[p] = Math.max(1, d[p] * teams);
  return d;
}

export function describeScoring(sc) {
  const bits = [];
  bits.push(sc.rec ? (sc.rec === 1 ? 'Full PPR' : sc.rec === 0.5 ? 'Half PPR' : `${sc.rec} PPR`) : 'Standard');
  if (sc.bonus_rec_te) bits.push(`TE +${sc.bonus_rec_te}/rec`);
  bits.push(`${sc.pass_td ?? 4}-pt pass TD`);
  if (sc.pass_int) bits.push(`INT ${sc.pass_int}`);
  if (sc.rush_fd || sc.rec_fd) bits.push('first-down bonus');
  return bits.join(' · ');
}

export function normalizeConfig(c = {}) {
  return {
    teams: c.teams || 12,
    lineup: c.lineup?.length ? c.lineup : [...DEFAULT_LINEUP],
    scoring: c.scoring ? { ...c.scoring } : { ...DEFAULT_SCORING },
    rounds: c.rounds || null,
    rookies: c.rookies || 'auto', // auto | include | exclude | only
  };
}
