// Tiny HTML helpers shared by views.
import { esc, fmt } from '../util.js';

export { esc, fmt };
export const pos = (p) => `<span class="pos ${esc(p)}">${esc(p)}</span>`;
export const grade = (g) => `<span class="grade ${esc((g || '–')[0])}">${esc(g || '–')}</span>`;
export const tag = (t, tone = '') => `<span class="tag ${tone}">${esc(t)}</span>`;
export const ageTxt = (a) => (a == null ? '–' : a.toFixed(1));

export function playerCell(p, tags = {}) {
  const t = tags[p.id]?.t;
  const mark = t === 'target' ? ' <span class="star" title="Target">★</span>' : t === 'avoid' ? ' <span class="ban" title="Avoid">⛔</span>' : '';
  const sub = p.prospect ? `${esc(p.college || '')} · prospect #${p.prospectRank}` : `${esc(p.team)} · ${ageTxt(p.age)}y${p.rookie ? ' · R' : ''}`;
  return `<div class="pname">${esc(p.name)}${mark}<small>${sub}</small></div>`;
}

export function riskTxt(p) {
  return `<span class="risk-${p.risk.label}" title="${esc(p.risk.parts.map((x) => x[1]).join('; '))}">${p.risk.label}</span>`;
}

let toastBox;
export function toast(msg, ms = 2600) {
  toastBox = toastBox || document.getElementById('toast');
  const d = document.createElement('div');
  d.textContent = msg;
  toastBox.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Weekly lineup helpers
export function kickTxt(g) {
  if (!g) return '';
  if (!g.kick) return g.day || '';
  return g.kick.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
export function fxTag(f) {
  const pct = Math.round((f.mult - 1) * 100);
  const txt = f.label === 'Injury' ? f.label : `${f.label}${pct ? ` ${pct > 0 ? '+' : ''}${pct}%` : ''}`;
  return `<span class="tag ${f.tone === 'muted' ? '' : esc(f.tone)}" title="${esc(f.why)}">${esc(txt)}</span>`;
}

// Line icons (20×20, stroked)
export const ICON = {
  lineup: '<path d="M4 6h12M4 10h12M4 14h7"/><path d="m13 14 2 2 3-4"/>',
  trades: '<path d="M4 7h11l-3-3M16 13H5l3 3"/>',
  board: '<rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="11.5" y="3.5" width="5" height="5" rx="1"/><rect x="3.5" y="11.5" width="5" height="5" rx="1"/><rect x="11.5" y="11.5" width="5" height="5" rx="1"/>',
  rankings: '<path d="M5 16V9M10 16V4M15 16v-5"/>',
  teams: '<circle cx="7" cy="7" r="2.5"/><circle cx="14" cy="8" r="2"/><path d="M2.5 16c.5-3 2.3-4.5 4.5-4.5s4 1.5 4.5 4.5M12 12.5c2.5-.5 4.6.8 5.2 3.5"/>',
  settings: '<path d="M4 6h7M15 6h1M4 14h1M9 14h7"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="14" r="2"/>',
  help: '<circle cx="10" cy="10" r="7"/><path d="M8 8a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1v.5M10 14.5v.01"/>',
  more: '<circle cx="5" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>',
  caret: '<path d="m6 8 4 4 4-4"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3h-3"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
};
export const icon = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 20 20" aria-hidden="true">${ICON[k]}</svg>`;
