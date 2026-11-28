// Player profile drawer.
import { esc, fmt, pos, grade, tag, ageTxt, kickTxt, fxTag } from './h.js';
import { outlookHTML, valueHTML } from './insight.js';
import { CLIFF } from '../model.js';

const GRADE_NAMES = [['outlook', 'Next-yr outlook'], ['dynasty', 'Dynasty 3-yr'], ['ceiling', 'Ceiling'], ['floor', 'Floor'],
  ['role', 'Role'], ['cast', 'Support cast'], ['safety', 'Safety']];

export function playerHTML(p, M, opts = {}) {
  const { tags = {}, draftInfo = null, canDraft = false, canMark = false, week = null, outlook = null, value = null, canTrade = false } = opts;
  const t = tags[p.id] || {};
  const d = p.draft || {};
  const cap = d.round ? `Round ${d.round}${d.ovr ? ` (#${d.ovr} overall)` : ''}, ${d.year}` : p.prospect ? `${d.year} class, pre-draft` : d.year ? `${d.year} entry` : 'Undrafted/unknown';
  const g = p.grades;
  const flagsHtml = (p.flags || []).map((f) => `<div class="flag">${tag(f.label, f.tone)}<span class="muted">${esc(f.why)}</span></div>`).join('')
    || '<div class="muted small">No red or green flags.</div>';
  const actions = `
    <div class="chips" style="margin:8px 0">
      <button class="chip ${t.t === 'target' ? 'on' : ''}" data-act="tag" data-id="${esc(p.id)}" data-v="target">★ Target</button>
      <button class="chip ${t.t === 'avoid' ? 'on' : ''}" data-act="tag" data-id="${esc(p.id)}" data-v="avoid">⛔ Avoid</button>
      ${canDraft ? `<button class="btn gold sm" data-act="draft" data-id="${esc(p.id)}">Draft for team on the clock</button>` : ''}
      ${canMark ? `<button class="btn sm" data-act="mark" data-id="${esc(p.id)}" title="Use if live sync is down">Mark taken at current pick</button>` : ''}
    </div>`;
  return `
  <button class="iconbtn close" data-act="close-drawer" aria-label="Close">Close ✕</button>
  <div class="phead">
    <div>
      <div class="muted small">${pos(p.pos)} ${esc(p.prospect ? p.college || '' : p.team)} · Rank ${p.rank} overall · ${p.pos}${p.posRank} · Tier ${p.tier ?? '–'}</div>
      <h2>${esc(p.name)}</h2>
      <div class="muted small">Age ${ageTxt(p.age)} next Sept · ${p.yearsExp != null ? `${p.yearsExp} yrs exp` : ''} · ${esc(cap)}${p.college && !p.prospect ? ` · ${esc(p.college)}` : ''}</div>
      ${draftInfo ? `<div style="margin-top:6px">${tag(draftInfo, 'info')}</div>` : ''}
    </div>
  </div>
  ${actions}
  ${week ? weekHTML(week) : ''}
  <div class="grades">${GRADE_NAMES.map(([k, n]) => `<div><b class="grade ${(g[k] || '–')[0]}" style="background:none;font-size:20px">${esc(g[k] || '–')}</b><span>${n}</span></div>`).join('')}</div>
  <div class="stats">
    <div><b>${fmt(p.proj)}</b><span>Projected PPG ${M.nextSeason}</span></div>
    <div><b>${fmt(p.expGames, 1)}</b><span>Expected games</span></div>
    <div><b>${fmt(p.proj - p.repl)}</b><span>PPG over replacement (${p.pos}${Math.round(M.demand[p.pos])})</span></div>
    <div><b>${p.years.map((y) => fmt(y)).join(' → ')}</b><span>PPG path, next 3 yrs</span></div>
    <div><b>${fmt(p.floorWeek)}–${fmt(p.ceilWeek)}</b><span>Typical bad–great week</span></div>
    <div><b>${p.consistency != null ? Math.round(p.consistency * 100) + '%' : '–'}</b><span>Weeks startable (top ${M.thr[p.pos].start} ${p.pos})</span></div>
    <div><b class="risk-${p.risk.label}">${p.risk.label}</b><span>Risk score ${p.risk.score}/100</span></div>
    <div><b>${p.mktRank ? '#' + p.mktRank : '–'}</b><span>Market rank (model #${p.rank})</span></div>
  </div>
  ${outlook ? `<section class="block outlook"><h3>Outlook</h3>${outlookHTML(outlook, p)}</section>` : ''}
  ${value ? `<section class="block"><h3>Trade value</h3>${valueHTML(value, { canTrade })}</section>` : ''}
  <section class="block"><h3>What stands out</h3><div class="flags">${flagsHtml}</div>
    ${p.risk.parts.length ? `<div class="small muted">Risk drivers: ${esc(p.risk.parts.map((x) => x[1]).join('; '))}</div>` : ''}
  </section>
  ${p.weeks.length ? weeklyBlock(p, M) : ''}
  ${roleBlock(p, M)}
  ${p.cast ? castBlock(p) : ''}
  ${injuryBlock(p)}
  ${p.prospect ? prospectBlock(p) : ''}
  <section class="block"><h3>Your notes</h3>
    <textarea data-note="${esc(p.id)}" placeholder="Film notes, trade ideas, landing-spot thoughts…">${esc(t.note || '')}</textarea>
  </section>`;
}

function weeklyBlock(p, M) {
  const w = p.weeks;
  const max = Math.max(...w.map((x) => x.pts), p.ceilWeek, 10);
  const n = w.length, W = Math.max(n * 14, 280), H = 140, bw = W / n;
  const thr = M.thr[p.pos];
  let prevS = null, seps = '';
  const bars = w.map((x, i) => {
    const h = Math.max(1.5, (x.pts / max) * (H - 18));
    const c = x.rk <= thr.strong ? 'var(--good)' : x.rk <= thr.start ? 'var(--info)' : 'var(--bad)';
    if (prevS !== null && x.s !== prevS) seps += `<line x1="${i * bw}" x2="${i * bw}" y1="0" y2="${H}" stroke="var(--line)" stroke-dasharray="3 3"/>`;
    prevS = x.s;
    return `<rect x="${i * bw + 1.5}" y="${H - h}" width="${Math.max(2, bw - 3)}" height="${h}" rx="2" fill="${c}"><title>${x.s} wk ${x.wk} vs ${x.opp}: ${x.pts.toFixed(1)} pts (${p.pos}${x.rk})${x.snap >= 0 ? `, ${Math.round(x.snap)}% snaps` : ''}</title></rect>`;
  }).join('');
  const py = H - (p.proj / max) * (H - 18);
  const seasons = [...new Set(w.map((x) => x.s))];
  const rows = [p.s.prev, p.s.cur].map((s, i) => (s ? `<tr><td>${[M.prev, M.cur][i]}</td><td class="num">${s.g}</td><td class="num">${fmt(s.ppg)}</td><td class="num">${Math.round(s.start * 100)}%</td><td class="num">${Math.round(s.strong * 100)}%</td><td class="num">${Math.round(s.bust * 100)}%</td><td class="num">${fmt(s.p90)}</td></tr>` : '')).join('');
  return `<section class="block"><h3>Every game, your scoring (${seasons.join(' & ')})</h3>
    <div class="fig"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Weekly fantasy points">
      ${seps}${bars}<line x1="0" x2="${W}" y1="${py}" y2="${py}" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/></svg></div>
    <div class="legend"><span><i style="background:var(--good)"></i>Top-half starter week</span><span><i style="background:var(--info)"></i>Startable</span><span><i style="background:var(--bad)"></i>Below starter level</span><span><i style="background:var(--gold)"></i>${M.nextSeason} projection</span></div>
    <div class="scroll"><table class="mini"><thead><tr><th>Season</th><th class="num">G</th><th class="num">PPG</th><th class="num">Startable</th><th class="num">Top-half</th><th class="num">Bust</th><th class="num">90th pct wk</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function roleBlock(p) {
  const r = p.role;
  if (!r) return '';
  const tr = p.trend;
  const arrow = (v) => (v == null ? '' : v > 0.5 ? ` <span class="tag good">▲ ${fmt(v, 0)}</span>` : v < -0.5 ? ` <span class="tag bad">▼ ${fmt(Math.abs(v), 0)}</span>` : '');
  const items = [
    ['Snap share', r.snap != null ? `${Math.round(r.snap)}%` + arrow(tr?.snap) : '–'],
    p.pos === 'QB' ? ['Pass att / game', fmt(r.att)] : ['Target share', `${fmt(r.ts, 1)}%` + (p.pos !== 'RB' ? arrow(tr?.share) : '')],
    p.pos === 'RB' ? ['Carry share', `${Math.round(r.cs)}%` + arrow(tr?.share)] : ['Targets / game', fmt(r.tgt)],
    ['Carries / game', fmt(r.car)],
    ['Catches / game', fmt(r.rec)],
    ['Depth chart', esc(p.depth || '–')],
  ];
  return `<section class="block"><h3>Role & usage (latest season)</h3><div class="stats">${items.map(([k, v]) => `<div><b style="font-size:16px">${v}</b><span>${k}</span></div>`).join('')}</div>
  <div class="small muted">Arrows compare the last 4 games with earlier games this season.</div></section>`;
}

function castBlock(p) {
  const c = p.cast;
  return `<section class="block"><h3>Supporting cast (${esc(p.team)}, latest season)</h3>
    <div class="stats"><div><b>${fmt(c.teamPpg)}</b><span>Team points / game</span></div>
    <div><b>${fmt(c.qbPpg)}</b><span>QB fantasy PPG (${esc(c.qb || '–')})</span></div>
    <div><b>${fmt(c.passAtt, 0)} / ${fmt(c.rushAtt, 0)}</b><span>Pass / rush att per game</span></div>
    <div><b>${fmt(c.posPts)}</b><span>Team ${p.pos} pts / game</span></div></div>
    <div class="small muted">Coaching changes, free agency and the NFL draft can change this before next season.</div></section>`;
}

function injuryBlock(p) {
  const seasons = Object.entries(p.inj || {});
  if (!seasons.length && !p.injBody.length && !p.injury) return '';
  return `<section class="block"><h3>Availability</h3>
    <div class="small">${seasons.map(([s, [gp, m]]) => `${s}: played ${gp}, missed ${m}`).join(' · ') || 'No data'}${p.injury ? ` · Sleeper status now: <b class="risk-High">${esc(p.injury)}</b>` : ''}</div>
    ${p.injBody.length ? `<div class="small muted" style="margin-top:4px">Injury-report history: ${p.injBody.map(([b, n]) => `${esc(b)} (${n} wk${n > 1 ? 's' : ''})`).join(', ')}</div>` : ''}
    <div class="small muted" style="margin-top:4px">Model expects ${fmt(p.expGames, 1)} of 17 games (${Math.round(p.missRate * 100)}% miss rate, regressed toward the ${p.pos} average).</div>
    ${p.age != null && p.age >= CLIFF[p.pos] - 1 ? `<div class="small" style="margin-top:4px">Age note: ${p.pos}s usually start declining around ${CLIFF[p.pos]}.</div>` : ''}
  </section>`;
}

function prospectBlock(p) {
  return `<section class="block"><h3>Prospect board</h3>
    <div class="small">Consensus rookie rank <b>#${p.prospectRank}</b>${p.prospectRanks ? ` (sources: ${p.prospectRanks.map((r) => r ?? 'unranked').join(' / ')})` : ''}.
    Market value is estimated from where that rookie pick usually trades. After the NFL draft the app swaps in real draft capital, landing spot and market value.</div></section>`;
}

function weekHTML({ e, week }) {
  const g = e.game;
  if (e.bye) return `<div class="panel wkbox"><h3>Week ${week}</h3><p class="muted" style="margin:0">Bye week.</p></div>`;
  const fx = e.factors.map((f) => `<div class="flag">${fxTag(f)}<span class="muted">${esc(f.why)}</span></div>`).join('') || '<div class="muted small">Nothing unusual this week.</div>';
  const vs = `${g.home ? 'vs' : '@'} ${esc(g.opp)}`;
  const status = e.state === 'final' ? `<span class="gst final">Final</span>${g.score ? ` ${g.score[0]}–${g.score[1]}` : ''}` : e.state === 'live' ? '<span class="gst live"><i class="ldot"></i>Live</span>' : `<span class="gst up">${esc(kickTxt(g))}</span>`;
  const top = e.state === 'final'
    ? `<div><b>${e.actual != null ? fmt(e.actual) : '–'}</b><span>Points scored (final)</span></div><div><b>${fmt(e.projExp)}</b><span>What we projected</span></div>`
    : e.state === 'live'
      ? `<div><b>${fmt(e.actual ?? 0)}</b><span>Points so far (live)</span></div><div><b>${fmt(e.exp)}</b><span>Projected finish</span></div>`
      : `<div><b>${fmt(e.exp)}</b><span>Projected points</span></div><div><b>${fmt(e.floor)}–${fmt(e.ceil)}</b><span>Likely range</span></div><div><b>${Math.round(e.pPlay * 100)}%</b><span>Chance he plays</span></div>`;
  return `<div class="panel wkbox"><h3>Week ${week}: ${vs} ${status}</h3>
    <div class="stats">${top}
      <div><b>${e.sleeperPts != null ? fmt(e.sleeperPts) : '–'}</b><span>Sleeper projection (your scoring)</span></div>
      <div><b>${e.form != null ? fmt(e.form) : '–'}</b><span>Recent form (PPG)</span></div>
      <div><b>×${fmt(e.matchupMult ?? 1, 2)}</b><span>Matchup adjustment</span></div>
    </div>${e.state === 'upcoming' ? fx : `<details><summary class="small muted">What went into the pre-game projection</summary>${fx}</details>`}</div>`;
}
