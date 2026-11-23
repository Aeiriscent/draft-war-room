// Practice-draft opponents. Each CPU team follows a persona so you can rehearse against real tendencies.
import { gauss, rng } from './util.js';

export const PERSONAS = {
  market: { label: 'Market follower', desc: 'Drafts close to consensus rankings' },
  model: { label: 'Best available', desc: 'Takes the highest model-rated player' },
  qbFirst: { label: 'QB-first', desc: 'Grabs two QBs early', pos: { QB: 1.35 }, until: 5 },
  zeroRb: { label: 'Zero RB', desc: 'Avoids RBs early, loads WR/TE', pos: { RB: 0.6, WR: 1.1, TE: 1.1 }, until: 6 },
  youth: { label: 'Youth movement', desc: 'Pays up for players 24 and under', young: 1.2, old: 0.8 },
  winNow: { label: 'Win-now', desc: 'Prefers proven veterans', young: 0.88, old: 1.12 },
  tePremium: { label: 'TE premium', desc: 'Prioritizes tight ends', pos: { TE: 1.4 }, until: 4 },
  robustRb: { label: 'Robust RB', desc: 'Stacks running backs early', pos: { RB: 1.3 }, until: 5 },
  wildcard: { label: 'Wildcard', desc: 'Unpredictable reaches', noise: 0.2 },
};
export const MIX = ['market', 'model', 'qbFirst', 'zeroRb', 'youth', 'winNow', 'tePremium', 'robustRb', 'market', 'wildcard', 'model', 'youth'];

export function assignPersonas(keys, mode = 'mixed', seed = 7) {
  const r = rng(seed);
  const pool = [...MIX];
  const out = {};
  keys.forEach((k, i) => {
    out[k] = mode === 'mixed' ? pool.splice(Math.floor(r() * pool.length), 1)[0] || 'market' : mode;
    if (!pool.length) pool.push(...MIX);
  });
  return out;
}

const CAP = { QB: 3, RB: 6, WR: 7, TE: 3 };
const LATE_CAP = { QB: 4, RB: 8, WR: 9, TE: 4 };

/** Choose a CPU pick. roster = profiles already owned by that team. */
export function cpuPick({ available, roster, round, rounds, persona = 'market', lineup, random }) {
  const P = PERSONAS[persona] || PERSONAS.market;
  const counts = {};
  for (const p of roster) counts[p.pos] = (counts[p.pos] || 0) + 1;
  const needSlots = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const s of lineup) if (needSlots[s] != null) needSlots[s]++;
  if (lineup.includes('SUPER_FLEX')) needSlots.QB++;
  const late = round > rounds * 0.55;
  const sorted = [...available].sort((a, b) => b.score - a.score);
  const cand = sorted.slice(0, 60);
  for (const pos of Object.keys(needSlots)) {
    if ((counts[pos] || 0) < needSlots[pos]) cand.push(...sorted.filter((p) => p.pos === pos).slice(0, 8));
  }
  let best = null, bestS = -1e9;
  for (const p of cand) {
    let s = persona === 'model' ? p.score : persona === 'market' ? p.idx.market : 0.55 * p.idx.market + 0.45 * p.score;
    if (P.pos && round <= (P.until || 99)) s *= P.pos[p.pos] || 1;
    if (p.age != null) {
      if (p.age <= 24.5 && P.young) s *= P.young;
      if (p.age >= 27 && P.old) s *= P.old;
    }
    const have = counts[p.pos] || 0;
    if (have >= (late ? LATE_CAP : CAP)[p.pos]) s *= 0.35;
    if (have < needSlots[p.pos]) {
      const urgency = round / rounds; // starters still missing get more urgent as the draft goes on
      s *= urgency > 0.5 ? 2.2 : urgency > 0.3 ? 1.45 : 1.08;
    }
    if (p.pos === 'QB' && have >= 2 && round < rounds * 0.5) s *= 0.7;
    s *= 1 + (P.noise || 0.07) * gauss(random);
    if (s > bestS) { bestS = s; best = p; }
  }
  return best;
}

export { rng };
