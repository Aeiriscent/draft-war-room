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
