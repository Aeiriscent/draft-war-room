// Small shared helpers. Pure functions only (safe to import in Node tests).

export const POS = ['QB', 'RB', 'WR', 'TE'];

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const sum = (a) => a.reduce((s, x) => s + x, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : 0);
export const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};
export function quantile(a, q) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export const median = (a) => quantile(a, 0.5);
export const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// percentile rank (0..1) of each value within its array
export function pctRanks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  const n = values.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
    const p = n === 1 ? 1 : ((i + j) / 2) / (n - 1);
    for (let k = i; k <= j; k++) out[idx[k][1]] = p;
    i = j + 1;
  }
  return out;
}

export function letter(p) {
  if (p == null || Number.isNaN(p)) return '–';
  const cuts = [[0.93, 'A+'], [0.85, 'A'], [0.77, 'A-'], [0.69, 'B+'], [0.6, 'B'], [0.52, 'B-'], [0.44, 'C+'],
    [0.36, 'C'], [0.28, 'C-'], [0.18, 'D']];
  for (const [c, l] of cuts) if (p >= c) return l;
  return 'F';
}

export const logistic = (x) => 1 / (1 + Math.exp(-x));

export function normName(n) {
  return String(n || '').toLowerCase()
    .replace(/[.'’,-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

export const slug = (n) => normName(n).replace(/ /g, '-');

export function ageOn(birthdate, onDate) {
  if (!birthdate) return null;
  const b = new Date(birthdate + 'T00:00:00Z');
  return (onDate - b) / (365.25 * 864e5);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export function fmt(x, d = 1) {
  if (x == null || Number.isNaN(x)) return '–';
  return Number(x).toFixed(d);
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function pickLabel(round, slotInRound, teams) {
  return `${round}.${String(slotInRound).padStart(2, '0')}`;
}

// Seeded random for reproducible practice drafts
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export function gauss(r) {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
