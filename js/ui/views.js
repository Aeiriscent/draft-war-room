// Page views. Each returns an HTML string; app.js wires events through data-act attributes.
import { esc, fmt, pos, grade, tag, playerCell, riskTxt, ageTxt, ago, kickTxt, fxTag, icon } from './h.js';
import { SLOT_OK } from '../weekly.js';
import { rosterSection, waiverSection } from './tradeviews.js';
import { pickLabel } from '../draft.js';
import { bestLineup } from '../model.js';
import { SLOT_LABEL, describeScoring } from '../league.js';
import { PERSONAS } from '../sim.js';

const POSF = ['ALL', 'QB', 'RB', 'WR', 'TE'];

export function weightControls(lg) {
  const w = lg.prefs;
  return `
  <label class="slider" title="0 = this season only, 100 = three-year dynasty value">Win now
    <input type="range" min="0" max="100" value="${Math.round(w.horizon * 100)}" data-pref="horizon" aria-label="Win now vs dynasty"> Dynasty</label>
  <label class="slider" title="How much to blend in consensus market value">Model
    <input type="range" min="0" max="100" value="${Math.round(w.trust * 100)}" data-pref="trust" aria-label="Model vs market"> Market</label>`;
}

function posChips(ui, key = 'pos') {
  return `<div class="segc" role="group" aria-label="Position">${POSF.map((p) => `<button class="${ui[key] === p ? 'on' : ''}" data-act="ui" data-k="${key}" data-v="${p}">${p === 'ALL' ? 'All' : p}</button>`).join('')}</div>`;
}

// ---------------- Rankings ----------------
const COLS = [
  ['rank', 'Rk', (p) => p.rank, 1], ['tier', 'Tier', (p) => p.tier ?? 999, 1], ['name', 'Player', (p) => p.name, 1],
  ['pos', 'Pos', (p) => p.pos + String(p.posRank).padStart(3, '0'), 1],
  ['proj', 'Proj PPG', (p) => p.proj, -1], ['vorp', 'Value now', (p) => p.vorp, -1], ['dyn', '3-yr value', (p) => p.dyn, -1],
  ['outlook', 'Outlook', (p) => p.proj, -1], ['dynasty', 'Dynasty', (p) => p.dyn, -1], ['ceiling', 'Ceiling', (p) => p.ceilWeek, -1],
  ['floor', 'Floor', (p) => p.consistency ?? -1, -1], ['role', 'Role', (p) => p.role?.metric ?? -1, -1],
  ['risk', 'Risk', (p) => p.risk.score, 1], ['mkt', 'Market #', (p) => p.mktRank ?? 9999, 1], ['delta', 'vs market', (p) => (p.mktRank ? p.mktRank - p.rank : -999), -1],
];

export function rankingsView(C, lg, B) {
  const ui = C.ui;
  let list = B.eligible;
  if (ui.pos !== 'ALL') list = list.filter((p) => p.pos === ui.pos);
  if (ui.q) { const q = ui.q.toLowerCase(); list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase() === q); }
  if (ui.hideTaken && B.state) list = list.filter((p) => !B.takenIds.has(p.id));
  if (ui.tagged) list = list.filter((p) => C.tags[p.id]?.t === 'target');
  const col = COLS.find((c) => c[0] === ui.sort) || COLS[0];
  const dir = col[3] * (ui.flip ? -1 : 1);
  list = [...list].sort((a, b) => { const x = col[2](a), y = col[2](b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  const shown = list.slice(0, ui.limit);
  let lastTier = null;
  const rows = shown.map((p) => {
    const brk = ui.sort === 'rank' && lastTier != null && p.tier !== lastTier;
    lastTier = p.tier;
    const taken = B.takenBy?.get(p.id);
    const d = p.mktRank ? p.mktRank - p.rank : null;
    return `<tr class="click ${taken ? 'taken' : ''} ${brk ? 'tierbreak' : ''}" data-act="player" data-id="${esc(p.id)}">
      <td class="num">${p.rank}</td><td class="num muted">${p.tier ?? ''}</td>
      <td>${playerCell(p, C.tags)}</td><td>${pos(p.pos)}<span class="muted small"> ${p.pos}${p.posRank}</span></td>
      <td class="num">${fmt(p.proj)}</td><td class="num hide-sm xcol">${fmt(p.vorp, 0)}</td><td class="num hide-sm xcol">${fmt(p.dyn, 0)}</td>
      <td>${grade(p.grades.outlook)}</td><td>${grade(p.grades.dynasty)}</td><td class="hide-sm xcol">${grade(p.grades.ceiling)}</td>
      <td class="hide-sm xcol">${grade(p.grades.floor)}</td><td class="hide-sm xcol">${grade(p.grades.role)}</td><td>${riskTxt(p)}</td>
      <td class="num hide-sm">${p.mktRank ?? '–'}</td>
      <td class="num">${d == null ? '–' : `<span class="${d >= 15 ? 'risk-Low' : d <= -15 ? 'risk-High' : 'muted'}">${d > 0 ? '+' : ''}${d}</span>`}</td>
      <td class="small muted hide-sm">${taken ? `Taken ${esc(taken)}` : (p.flags || []).slice(0, 2).map((f) => f.label).join(', ')}</td></tr>`;
  }).join('');
  const head = COLS.map(([k, n]) => {
    const hideSm = (['vorp', 'dyn', 'ceiling', 'floor', 'role', 'mkt'].includes(k) ? ' hide-sm' : '') + (['vorp', 'dyn', 'ceiling', 'floor', 'role'].includes(k) ? ' xcol' : '');
    const num = ['rank', 'tier', 'proj', 'vorp', 'dyn', 'mkt', 'delta'].includes(k) ? ' num' : '';
    return `<th class="${ui.sort === k ? 'sorted' : ''}${hideSm}${num}" data-act="sort" data-k="${k}">${n}${ui.sort === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  }).join('') + '<th class="hide-sm">Notes</th>';
  return `<header class="ph"><div><h1>Rankings</h1><div class="sub">${esc(poolNote(B))} Grades are percentiles within each position; “vs market” is how many spots higher the model ranks him than consensus.</div></div></header>
  <div class="controls">
    ${posChips(ui)}
    <input type="search" class="search" placeholder="Search player or team" value="${esc(ui.q)}" data-ui="q" aria-label="Search">
    ${B.state ? `<label class="toggle"><input type="checkbox" data-ui-check="hideTaken" ${ui.hideTaken ? 'checked' : ''}> Hide drafted</label>` : ''}
    <label class="toggle"><input type="checkbox" data-ui-check="tagged" ${ui.tagged ? 'checked' : ''}> Targets only</label>
    <label class="toggle hide-sm"><input type="checkbox" data-ui-check="allCols" ${ui.allCols ? 'checked' : ''}> All columns</label>
  </div>
  <details class="weights"><summary class="disclose">Weighting: ${Math.round(lg.prefs.horizon * 100)}% dynasty, ${Math.round(lg.prefs.trust * 100)}% market</summary><div class="controls" style="margin-top:6px">${weightControls(lg)}</div></details>
  <div class="panel scroll ${ui.allCols ? 'allcols' : ''}" style="padding:0;margin-top:8px"><table><thead><tr>${head}</tr></thead><tbody>${rows || '<tr><td colspan="16" class="muted">No players match.</td></tr>'}</tbody></table></div>
  ${list.length > shown.length ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-act="more">Show ${Math.min(150, list.length - shown.length)} more</button></div>` : ''}`;
}

function poolNote(B) {
  return {
    only: 'Showing the rookie pool only (rookie draft).',
    exclude: 'Veterans only (rookies excluded for this league).',
    include: 'Veterans and incoming rookies together.',
  }[B.rookieMode] || '';
}

// ---------------- Draft board ----------------
export function boardView(C, lg, B) {
  if (!B.ctx) return noDraft(C, lg, B);
  const { ctx, state, recs } = B;
  const practice = lg.kind === 'practice' || lg.kind === 'manual';
  const T = ctx.numTeams;
  const oc = state.onClock;
  const mineNow = oc && oc.owner === ctx.myKey;
  const teamName = (k) => esc(ctx.teams.find((t) => t.key === k)?.name || k);
  const live = C.live(lg);
  const syncBits = practice ? `
      <button class="btn sm" data-act="undo" ${state.picks.length ? '' : 'disabled'}>Undo pick</button>
      ${lg.kind === 'practice' ? `<button class="btn sm" data-act="autopick" ${oc ? '' : 'disabled'}>${mineNow ? 'Auto-draft my pick' : 'Sim to my pick'}</button>` : ''}
      <button class="btn sm danger" data-act="restart">Restart</button>`
    : `<span class="pill ${live?.error ? 'err' : live?.polling ? 'live' : ''}">${live?.error ? 'Sync error' : live?.polling ? '● Live' : 'Paused'}</span>
      <span class="small muted" ${live?.error ? '' : `data-ago="${live?.lastSync || 0}"`}>${live?.error ? esc(live.error) : `Updated ${ago(live?.lastSync)}`}</span>
      <button class="btn sm" data-act="sync">Sync now</button>
      <button class="btn sm" data-act="toggle-live">${live?.polling ? 'Pause' : 'Go live'}</button>`;
  const clock = oc ? `
    <div class="panel clock ${mineNow ? 'mine' : ''}">
      <div class="big num">${pickLabel(oc)}</div>
      <div><div class="small muted">Pick ${oc.no} of ${ctx.order.length} · ${esc(ctx.status === 'pre_draft' ? 'Draft not started' : 'On the clock')}</div>
      <div style="font-weight:700;font-size:17px">${mineNow ? 'You’re up' : teamName(oc.owner)}</div></div>
    </div>` : `<div class="panel clock"><div class="big">Done</div><div>Draft complete. See Teams for every roster and strategy read.</div></div>`;
  const next = state.myNext ? `
    <div class="panel"><div class="small muted">Your next pick</div>
      <div style="font-weight:700;font-size:17px">${pickLabel(state.myNext)} <span class="muted small">(#${state.myNext.no})</span> — ${state.picksUntil === 0 ? 'now' : `in ${state.picksUntil} pick${state.picksUntil === 1 ? '' : 's'}`}</div>
      ${state.afterNext ? `<div class="small muted">Then ${pickLabel(state.afterNext)} (${state.afterNext.no - state.myNext.no} picks later)</div>` : ''}
      ${B.threats?.length ? `<div class="threat" style="margin-top:6px">${B.threats.filter((t) => t.n).map((t) => tag(`${t.n}/${t.of} need ${t.pos}`, t.n >= Math.ceil(t.of / 2) ? 'warn' : '')).join('')}</div>` : ''}
    </div>` : `<div class="panel"><div class="small muted">Your next pick</div><div>${ctx.myKey ? 'No picks left' : 'Pick which team is yours in League settings'}</div></div>`;
  const canDraft = practice && oc && (lg.kind === 'manual' || mineNow);
  const recHtml = recs.slice(0, 8).map((r, i) => `
    <div class="rec ${i === 0 ? 'first' : ''}">
      <div class="row1">${pos(r.p.pos)}<a href="#" data-act="player" data-id="${esc(r.p.id)}" style="color:inherit;font-weight:700;text-decoration:none">${esc(r.p.name)}</a>
        <span class="muted small">${esc(r.p.prospect ? 'prospect' : r.p.team)} · ${ageTxt(r.p.age)}</span><span class="score num">${fmt(r.score, 0)}</span></div>
      <div class="small muted">Proj ${fmt(r.p.proj)} PPG · ${r.p.grades.outlook} now / ${r.p.grades.dynasty} dynasty · risk ${r.p.risk.label}</div>
      <ul>${r.reasons.slice(0, 4).map((x) => `<li class="${x.tone}">${esc(x.t)}</li>`).join('')}</ul>
      ${canDraft ? `<button class="btn gold sm" style="margin-top:6px" data-act="draft" data-id="${esc(r.p.id)}">Draft ${esc(r.p.name.split(' ').slice(-1)[0])}</button>` : ''}
    </div>`).join('');
  // available list
  const ui = C.ui;
  let avail = B.available;
  if (ui.bpos !== 'ALL') avail = avail.filter((p) => p.pos === ui.bpos);
  if (ui.bq) { const q = ui.bq.toLowerCase(); avail = avail.filter((p) => p.name.toLowerCase().includes(q)); }
  const survMap = new Map(B.allRecs.map((r) => [r.p.id, r.survive]));
  const rows = avail.slice(0, 80).map((p) => `<tr class="click" data-act="player" data-id="${esc(p.id)}">
    <td class="num">${p.rank}</td><td>${playerCell(p, C.tags)}</td><td>${pos(p.pos)}</td><td class="num">${fmt(p.proj)}</td>
    <td>${grade(p.grades.dynasty)}</td><td class="hide-sm">${riskTxt(p)}</td>
    <td class="num">${survMap.has(p.id) ? Math.round(survMap.get(p.id) * 100) + '%' : ''}</td>
    <td>${canDraft ? `<button class="btn sm" data-act="draft" data-id="${esc(p.id)}">Draft</button>` : ''}</td></tr>`).join('');
  const me = B.myPlayers;
  const lu = bestLineup(me, B.cfg.lineup);
  const used = new Set(lu.filled.filter((f) => f.p).map((f) => f.p.id));
  const bench = me.filter((p) => !used.has(p.id)).sort((a, b) => b.score - a.score);
  const myRep = B.reports.get(ctx.myKey);
  const side = `
    <h3>Your lineup <span class="muted small">${fmt(lu.total)} proj PPG${B.table.get(ctx.myKey) ? ` · ${ordinalRank(B.table.get(ctx.myKey).nowRank)} of ${T}` : ''}</span></h3>
    <div class="lineup">${lu.filled.map((f) => `<div><span class="slot">${esc(SLOT_LABEL[f.slot] || f.slot)}</span>${f.p ? `<span>${pos(f.p.pos)} <a href="#" data-act="player" data-id="${esc(f.p.id)}" style="color:inherit">${esc(f.p.name)}</a></span><span class="num small">${fmt(f.p.proj)}</span>` : '<span class="empty">empty</span><span></span>'}</div>`).join('')}</div>
    ${bench.length ? `<h3 style="margin-top:12px">Bench & stash (${bench.length})</h3><div class="small">${bench.slice(0, 30).map((p) => `${pos(p.pos)} ${esc(p.name)}`).join('<br>')}</div>` : ''}
    ${myRep?.labels?.length ? `<h3 style="margin-top:12px">How your draft reads</h3><div class="chips">${myRep.labels.map((l) => tag(l.label, 'info')).join('')}</div><div class="small muted" style="margin-top:6px">${esc(myRep.summary)}</div>` : ''}`;
  return `
  <div class="status">${clock}${next}<div class="sync">${syncBits}</div></div>
  <div class="seg chips" role="tablist">${['recs', 'players', 'roster'].map((s) => `<button class="chip ${ui.seg === s ? 'on' : ''}" data-act="ui" data-k="seg" data-v="${s}">${{ recs: 'Your pick', players: 'Players', roster: 'Your team' }[s]}</button>`).join('')}</div>
  <div class="board" data-seg="${ui.seg}">
    <div class="panel p-recs"><h3>${mineNow ? 'Your pick — on the clock' : 'If you were picking now'}</h3>
      <div class="small muted" style="margin-bottom:8px">${weightControls(lg)}</div>${recHtml || '<div class="muted">No players left in the pool.</div>'}</div>
    <div class="panel p-players">
      <div class="controls">${posChips(ui, 'bpos')}<input type="search" class="search" placeholder="Search" value="${esc(ui.bq)}" data-ui="bq" aria-label="Search available"></div>
      <div class="scroll"><table><thead><tr><th class="num">Rk</th><th>Available</th><th></th><th class="num">Proj</th><th>Dyn</th><th class="hide-sm">Risk</th><th class="num" title="Chance he lasts to your next pick">Lasts</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="panel side">${side}</div>
  </div>
  ${gridHTML(ctx, state, B)}`;
}

const ordinalRank = (n) => `#${n}`;

function gridHTML(ctx, state, B) {
  const T = ctx.numTeams;
  const keysBySlot = [...ctx.teams].sort((a, b) => a.slot - b.slot);
  const head = keysBySlot.map((t) => `<div class="head" title="${esc(t.name)}">${t.key === ctx.myKey ? '★ ' : ''}${esc(t.name)}</div>`).join('');
  const cells = ctx.order.map((o) => {
    const pk = state.made.get(o.no);
    const p = pk && B.M.byId.get(pk.pid);
    const name = p ? p.name : pk?.name || '';
    const ps = p?.pos || pk?.pos || '';
    const traded = o.owner !== o.orig ? ` → ${esc(ctx.teams.find((t) => t.key === o.owner)?.name || '')}` : '';
    const col = keysBySlot.findIndex((t) => t.slot === o.slot) + 1;
    return `<div class="cell ${ps} ${o.owner === ctx.myKey ? 'mine' : ''} ${state.onClock?.no === o.no ? 'clock' : ''}" style="grid-column:${col}" ${p ? `data-act="player" data-id="${esc(p.id)}"` : ''}>
      <span class="muted">${pickLabel(o)}${traded}</span><b>${esc(name)}</b>${ps ? `<span>${esc(ps)}</span>` : ''}</div>`;
  }).join('');
  return `<h3 style="margin-top:18px">Draft grid</h3><div class="dgrid" style="grid-template-columns:repeat(${T}, minmax(96px, 1fr))">${head}${cells}</div>`;
}

function noDraft(C, lg, B) {
  const live = C.live(lg);
  let msg = '';
  if (lg.kind === 'sleeper') msg = live?.error ? `Couldn’t reach Sleeper: ${esc(live.error)}` : live?.loading ? 'Loading your league from Sleeper…' : 'This league has no draft scheduled on Sleeper yet. Rankings and Teams still work; the board appears as soon as Sleeper creates the draft.';
  else if (lg.kind === 'mock') msg = live?.error ? `Couldn’t load that draft: ${esc(live.error)}` : 'Loading draft…';
  else msg = 'Set up the draft in League settings.';
  return `<div class="panel empty-state"><h2>No draft board yet</h2><p class="muted">${msg}</p>
    <div class="chips" style="justify-content:center"><button class="btn" data-act="sync">Try again</button><button class="btn" data-act="view" data-v="settings">League settings</button></div></div>`;
}

// ---------------- Teams ----------------
export function teamsView(C, lg, B) {
  if (!B.ctx) return `<div class="panel empty-state"><h2>No teams yet</h2><p class="muted">Teams appear once a draft or league rosters are loaded.</p></div>`;
  const { ctx } = B;
  const cards = [...ctx.teams].sort((a, b) => (a.key === ctx.myKey ? -1 : b.key === ctx.myKey ? 1 : a.slot - b.slot)).map((t) => {
    const r = B.reports.get(t.key), tb = B.table.get(t.key);
    const ro = B.rosters.get(t.key);
    const drafted = ro.drafted.map((d) => `<div><span class="muted num small">${d.pick.round}.${String(((d.pick.no - 1) % ctx.numTeams) + 1).padStart(2, '0')}</span>${d.p ? `${pos(d.p.pos)} <a href="#" data-act="player" data-id="${esc(d.p.id)}" style="color:inherit">${esc(d.p.name)}</a>` : esc(d.pick.name || '—')}</div>`).join('');
    const existing = ro.existing.length ? `<h3 style="margin-top:10px">Roster before this draft (${ro.existing.length})</h3><div class="roster">${[...ro.existing].sort((a, b) => b.score - a.score).slice(0, 24).map((p) => `<div>${pos(p.pos)} <a href="#" data-act="player" data-id="${esc(p.id)}" style="color:inherit">${esc(p.name)}</a></div>`).join('')}</div>` : '';
    const counts = ['QB', 'RB', 'WR', 'TE'].map((p) => `${p} ${r.counts[p] || 0}`).join(' · ');
    return `<div class="panel team ${t.key === ctx.myKey ? 'mine-team' : ''}">
      <h3>${t.key === ctx.myKey ? '★ ' : ''}${esc(t.name)} <span class="muted small">slot ${t.slot}${tb && B.showWindow ? ` · ${tb.window}` : ''}</span></h3>
      <div class="labels">${r.labels.map((l) => `<span class="label" title="${esc(l.why)}">${esc(l.label)}</span>`).join('') || '<span class="muted small">No picks yet</span>'}</div>
      <div class="small muted">${esc(r.summary)}</div>
      <div class="kv"><div><b class="num">${fmt(r.lineupPpg)}</b><span>Lineup PPG (#${tb?.nowRank ?? '–'})</span></div>
        <div><b class="num">#${tb?.valueRank ?? '–'}</b><span>Roster value</span></div>
        <div><b class="num">${r.avgAge != null ? r.avgAge.toFixed(1) : '–'}</b><span>Avg age (picks)</span></div></div>
      <div class="small">${counts}</div>
      ${r.labels.length ? `<div class="small" style="margin-top:6px">${r.labels.map((l) => `<b>${esc(l.label)}:</b> ${esc(l.why)}`).join(' · ')}</div>` : ''}
      ${r.steals.length ? `<div class="small" style="margin-top:6px">Best values: ${r.steals.map((s) => `${esc(s.d.p.name)} (+${s.delta})`).join(', ')}</div>` : ''}
      ${r.reaches.length ? `<div class="small">Reaches: ${r.reaches.map((s) => `${esc(s.d.p.name)} (${s.delta})`).join(', ')}</div>` : ''}
      ${r.needPos.length ? `<div class="small" style="margin-top:6px"><b>Needs</b> ${r.needPos.join(', ')}${r.nextGuess.length && t.key !== ctx.myKey ? `<span class="muted">. Likely to take ${r.nextGuess.join(' or ')} next.</span>` : ''}</div>` : ''}
      ${drafted ? `<h3 style="margin-top:10px">This draft</h3><div class="roster">${drafted}</div>` : ''}
      ${existing}
    </div>`;
  }).join('');
  return `<div class="small muted" style="margin-bottom:10px">Strategy reads update with every pick. “Values/reaches” compare the pick number with the player’s market rank among the draft pool.</div><div class="teams">${cards}</div>`;
}

// ---------------- League settings ----------------
export function settingsView(C, lg, B) {
  const c = lg.config;
  const sc = c.scoring;
  const live = C.live(lg);
  const teams = B.ctx?.teams || [];
  const sfield = (k, label, step = 0.5) => `<label class="field"><span>${label}</span><input type="number" step="${step}" value="${sc[k] ?? 0}" data-score="${k}"></label>`;
  const sleeperBox = lg.kind === 'sleeper' || lg.kind === 'mock' ? `
    <div class="panel"><h2>Sleeper connection</h2>
      <div class="formgrid">
        ${lg.kind === 'sleeper' ? `<label class="field"><span>League ID</span><input type="text" value="${esc(lg.sleeper.leagueId || '')}" data-sl="leagueId"></label>` : ''}
        <label class="field"><span>Draft</span>${live?.drafts?.length ? `<select data-sl="draftId">${live.drafts.map((d) => `<option value="${d.draft_id}" ${d.draft_id === (lg.sleeper.draftId || live.draft?.draft_id) ? 'selected' : ''}>${esc(d.season)} ${esc(d.status)} · ${d.settings?.rounds || '?'} rds</option>`).join('')}</select>` : `<input type="text" value="${esc(lg.sleeper.draftId || '')}" data-sl="draftId" placeholder="auto">`}</label>
        <label class="field"><span>Your team</span><select data-sl="myKey"><option value="">Auto (from username)</option>${teams.map((t) => `<option value="${esc(t.key)}" ${lg.sleeper.myKey === t.key ? 'selected' : ''}>${esc(t.name)} (slot ${t.slot})</option>`).join('')}</select></label>
        <label class="field"><span>Sleeper username</span><input type="text" value="${esc(lg.sleeper.username || '')}" data-sl="username"></label>
      </div>
      <div class="chips" style="margin-top:10px"><button class="btn" data-act="sync-full">Reload from Sleeper</button>
        ${lg.kind === 'sleeper' ? '<button class="btn" data-act="pull-config">Use Sleeper’s scoring & lineup</button>' : ''}</div>
      <p class="small muted">Status: ${esc(live?.league?.status || live?.draft?.status || '–')} · last sync ${ago(live?.lastSync)}</p>
    </div>` : '';
  const practiceBox = lg.kind === 'practice' || lg.kind === 'manual' ? `
    <div class="panel"><h2>${lg.kind === 'practice' ? 'Practice draft' : 'Draft tracker'}</h2>
      <div class="formgrid">
        <label class="field"><span>Your slot</span><input type="number" min="1" max="${c.teams}" value="${lg.practice.mySlot}" data-pr="mySlot"></label>
        <label class="field"><span>Rounds</span><input type="number" min="1" max="40" value="${lg.practice.rounds}" data-pr="rounds"></label>
        <label class="field"><span>Order</span><select data-pr="type"><option value="snake" ${lg.practice.type === 'snake' && !lg.practice.reversal ? 'selected' : ''}>Snake</option><option value="3rr" ${lg.practice.reversal ? 'selected' : ''}>Snake, 3rd-round reversal</option><option value="linear" ${lg.practice.type === 'linear' ? 'selected' : ''}>Linear (rookie style)</option></select></label>
        ${lg.kind === 'practice' ? `<label class="field"><span>Opponents</span><select data-pr="cpu">${[['mixed', 'Mixed strategies'], ...Object.entries(PERSONAS).map(([k, v]) => [k, `All ${v.label}`])].map(([k, v]) => `<option value="${k}" ${lg.practice.cpu === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field"><span>CPU speed</span><select data-pr="speed"><option value="0" ${lg.practice.speed == 0 ? 'selected' : ''}>Instant</option><option value="250" ${lg.practice.speed == 250 ? 'selected' : ''}>Quick</option><option value="900" ${lg.practice.speed == 900 ? 'selected' : ''}>Realistic</option></select></label>` : ''}
      </div>
      <p class="small muted">Changing these restarts the board.</p>
    </div>` : '';
  return `
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr))">
    <div class="panel"><h2>League</h2>
      <div class="formgrid">
        <label class="field"><span>Name</span><input type="text" value="${esc(lg.name)}" data-lg="name"></label>
        <label class="field"><span>Teams</span><input type="number" min="4" max="32" value="${c.teams}" data-cfg="teams"></label>
        <label class="field"><span>Stage</span><select data-lg="phase"><option value="startup" ${lg.phase === 'startup' ? 'selected' : ''}>Startup (empty rosters)</option><option value="existing" ${lg.phase === 'existing' ? 'selected' : ''}>Existing league</option></select></label>
        <label class="field"><span>Player pool</span><select data-cfg="rookies">${[['auto', 'Auto'], ['include', 'Veterans + rookies'], ['exclude', 'Veterans only'], ['only', 'Rookies only']].map(([k, v]) => `<option value="${k}" ${c.rookies === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label class="field" style="margin-top:10px"><span>Starting lineup (comma separated: QB, RB, WR, TE, FLEX, SUPER_FLEX, REC_FLEX, WRRB_FLEX)</span><input type="text" value="${esc(c.lineup.join(', '))}" data-cfg="lineup"></label>
      <p class="small muted">Auto pool: startup = veterans + rookies, existing league = rookies only.</p>
    </div>
    <div class="panel"><h2>Scoring <span class="muted small">${esc(describeScoring(sc))}</span></h2>
      <div class="formgrid">${sfield('rec', 'Per reception')}${sfield('bonus_rec_te', 'TE bonus / rec')}${sfield('pass_td', 'Pass TD', 1)}${sfield('pass_yd', 'Pass yard', 0.01)}
      ${sfield('pass_int', 'Interception', 1)}${sfield('rush_yd', 'Rush yard', 0.01)}${sfield('rec_yd', 'Rec yard', 0.01)}${sfield('rush_td', 'Rush TD', 1)}
      ${sfield('rec_td', 'Rec TD', 1)}${sfield('fum_lost', 'Fumble lost', 1)}${sfield('rush_fd', 'Rush 1st down')}${sfield('rec_fd', 'Rec 1st down')}</div>
    </div>
    ${sleeperBox}${practiceBox}
    <div class="panel"><h2>Backup</h2><p class="small muted">Leagues, tags and notes live in this browser. Export a backup before switching devices.</p>
      <div class="chips"><button class="btn" data-act="export">Export backup</button><button class="btn" data-act="import">Import backup</button><button class="btn danger" data-act="delete-league">Remove this league</button></div></div>
  </div>`;
}

// ---------------- Method ----------------
export function methodView(C) {
  const m = C.data.meta;
  return `<div class="wrap" style="max-width:900px">
  <h1>How the grades work</h1>
  <p>Every number is computed in <b>your league’s scoring and lineup</b>. Change the scoring in League settings and the whole board re-grades.</p>
  <div class="panel" style="margin:14px 0"><h2>Data</h2>
    <p class="small">Weekly stats, snaps, injury reports and rosters for ${(m.seasons || []).join(' and ')} (through week ${m.week}), built ${esc(m.built)}. Market values from ${esc(m.valuesDate)}.</p>
    <ul class="small">${m.sources.map(([n, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a></li>`).join('')}<li>Live league, roster, draft and player-status data from the <a href="https://docs.sleeper.com" target="_blank" rel="noopener">Sleeper API</a></li></ul>
    <div class="chips"><button class="btn" data-act="refresh-market">Refresh market values now</button><button class="btn" data-act="refresh-sleeper">Refresh Sleeper player list</button></div>
  </div>
  <div class="panel"><h2>The model, step by step</h2><ol class="small">
    <li><b>Production:</b> fantasy points per game, latest season weighted 1.0 and the one before 0.55, with the last 6 games given extra weight. Small samples are pulled toward what the market value implies.</li>
    <li><b>Age curve:</b> a position-specific multiplier for next season (RBs peak ~23–25 and drop from 27; WRs hold to ~28; TEs improve into their mid-20s; QBs hold into their 30s).</li>
    <li><b>Role trend:</b> rising or falling snap share and target/carry share over the last 4 games nudges the projection up to +8% / −6%.</li>
    <li><b>Availability:</b> games missed (IR or ruled out) over two seasons, regressed toward the position average, sets expected games.</li>
    <li><b>Value now</b> = (projected PPG − replacement PPG) × expected games. Replacement is the last starter at the position given your league size, lineup, superflex and TE premium.</li>
    <li><b>3-yr value</b> chains the age curve forward three seasons, discounting years 2 and 3.</li>
    <li><b>Rank</b> = blend of value now and 3-yr value (Win now ↔ Dynasty slider), then blended with consensus market value (Model ↔ Market slider).</li>
    <li><b>Floor</b> = share of games he finished as a starter at his position. <b>Ceiling</b> = his 90th-percentile week. These answer “will he score when I start him”.</li>
    <li><b>Role</b> = snap share plus target share (WR/TE), carry share (RB) or rushing volume (QB). <b>Support cast</b> = team scoring, QB production and how much the team feeds the position.</li>
    <li><b>Risk</b> adds up: injury history, recurring soft-tissue injuries, age past the position cliff, current injury, committee usage, weekly volatility, small samples and no team.</li>
    <li><b>Your pick</b> recommendations start from rank, scale by how much the player improves <i>your</i> starting lineup, and add urgency when his position’s value will be gone before your next turn (using market rank as ADP). Targets get a bump, avoids a penalty.</li>
  </ol><p class="small muted">Prospects before the NFL draft are graded from consensus rookie rankings only. Contracts and coaching changes are not modeled yet: use notes and tags for those.</p></div>
  <div class="panel" style="margin-top:14px"><h2>Weekly lineup (start/sit)</h2><ol class="small">
    <li><b>Starting point:</b> 55% Sleeper’s weekly projection, rescored in your league’s scoring (TE premium included), and 45% his recent form: this season’s points per game with the latest weeks weighted most, pulled slightly toward his season average.</li>
    <li><b>Matchup adjustments</b> to the form half: points the opponent allows to his position (in your scoring, shrunk toward average), the Vegas implied team total vs his team’s season average, game script from the spread (big favorites run more, underdogs pass more), home field, domes, and the kickoff-hour forecast (wind 15+ mph, rain or snow, below 25°F) for outdoor stadiums. Defenses are scored off the opponent’s implied total.</li>
    <li><b>Teammates:</b> when a pass catcher or running back who had been playing is ruled out, his target or carry share is redistributed to healthy teammates in proportion to their roles (Sleeper’s depth chart breaks backfield ties). A starting QB ruling out downgrades his pass catchers.</li>
    <li><b>Role:</b> snap share up or down 10+ points over the last three games moves him ±4%. Players returning from a missed game take a 7% haircut for snap management.</li>
    <li><b>Availability:</b> Out/IR/suspended = 0. Doubtful = 15% to play. Questionable depends on the week’s practice: full 93%, limited 78%, did not practice 45%. Playing through a soft-tissue injury (hamstring, groin, calf, quad, ankle, Achilles) trims efficiency 8%. Expected points = projection × chance to play.</li>
    <li><b>Range and win odds:</b> each player’s spread comes from his own week-to-week volatility plus the chance he sits. Lineup totals add up means and variances, and win probability compares yours to your opponent’s best lineup.</li>
    <li><b>Lineup style:</b> Max points ranks by expected points; Safe floor and Upside shift by about half a standard deviation. Auto picks whichever gives the highest chance to win: favorites get steadier lineups, underdogs get more variance.</li>
    <li><b>Locks:</b> players whose game has kicked off stay where they are in Sleeper; finished games use actual points.</li>
  </ol><p class="small muted">Injury designations come live from Sleeper (refreshed up to twice a day, or tap the injury chip to refresh). Lines refresh from nflverse every few hours, weather from Open-Meteo hourly. Always confirm inactives about 90 minutes before kickoff.</p></div>
  <div class="panel" style="margin-top:14px"><h2>Player outlooks</h2><ol class="small">
    <li><b>How he’s producing:</b> this season’s points per game in your scoring and where that ranks, his share of team targets or carries, snap share, how often he’s been startable or a top-half starter, his typical weekly range, and how the last four games compare with before.</li>
    <li><b>Will it last:</b> touchdowns are compared with what his volume normally produces at his position. Players scoring far above that rate are flagged to cool off, and about half the gap comes off his rest-of-season projection; players far below it get the bump. Efficiency (yards per target, touch or play), the direction of his role, his offense and his health round it out.</li>
    <li><b>Rest of season:</b> recent form, adjusted for each remaining opponent’s points allowed to his position and for touchdown luck, through your league’s fantasy playoffs. Weeks are colored soft or tough; playoff weeks are underlined.</li>
    <li><b>Next three seasons:</b> the model’s projected PPG for each year and the position rank that implies, his career phase from age (ascending, prime, late prime, decline), draft capital, and upside/downside scenarios built from his recent role and his biggest risks.</li>
  </ol></div>
  <div class="panel" style="margin-top:14px"><h2>Trade values and suggestions</h2><ol class="small">
    <li><b>Trade value</b> is the dynasty market price (FantasyPros consensus via DynastyProcess), using superflex values in superflex leagues and adding 15% per point of TE premium for tight ends. It’s what other managers will pay.</li>
    <li><b>The model’s view</b> re-ranks players within each position by production: “this season” uses value over a replacement starter for the rest of this season and next season; “long term” uses the three-year projection. Each player gets the market price of the slot the model puts him in, so the model can disagree about who is better, not about how the market prices positions.</li>
    <li><b>Draft picks</b> are priced from the consensus value of each rookie pick slot. Next year’s picks use a projected slot from the current standings (worst record picks first); later years use a mid-round slot, discounted 10% per year.</li>
    <li><b>Team timeline:</b> each team is a Contender, Middle or Rebuilding from its record and lineup strength. Rebuilders value picks and young players more; contenders value this season’s production more. You can override your own.</li>
    <li><b>Grading a trade:</b> packages of several smaller pieces are discounted (the best player in a deal carries a premium). “Realistic” is judged on market value tilted by the other team’s timeline and needs; “good for you” uses the model on your timeline, blended with the market by your Model ↔ Market slider, plus the change to your starting lineup.</li>
    <li><b>Suggestions:</b> sell candidates are players the market values above what they’re worth to you (age, touchdown luck, bench depth, timeline). Buy targets are the reverse, with motivated sellers first. Ready-made offers search your expendable players and picks for packages the other team should accept and that leave you better off.</li>
  </ol></div>
  </div>`;
}

// ---------------- Lineup (weekly start/sit) ----------------
const MODES = [['auto', 'Auto'], ['safe', 'Safe floor'], ['balanced', 'Max points'], ['upside', 'Upside']];
const SLOT_TXT = { SUPER_FLEX: 'SF', FLEX: 'FLEX', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', DEF: 'DEF', K: 'K' };
const posBadge = (p) => (['QB', 'RB', 'WR', 'TE'].includes(p) ? pos(p) : `<span class="pos">${esc(p)}</span>`);
const pctTxt = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const lastName = (n) => { const w = n.split(' ').filter((x) => !/^(Jr\.?|Sr\.?|II|III|IV|V)$/.test(x)); return w[w.length - 1] || n; };

function topFactors(e, n = 3) {
  const fx = [...e.factors].sort((a, b) => Math.abs(b.mult - 1) - Math.abs(a.mult - 1));
  const inj = fx.find((f) => f.label === 'Injury' || f.label === 'Practice');
  const out = fx.filter((f) => f !== inj && Math.abs(f.mult - 1) >= 0.02).slice(0, inj ? n - 1 : n);
  return inj ? [inj, ...out] : out;
}

// Game status, said the same way everywhere: Final (scored), Live (so far), or the kickoff time (projected).
export function gameLine(e) {
  const g = e.game;
  if (e.bye || !g) return 'Bye week';
  const at = `${g.home ? 'vs' : 'at'} ${esc(g.opp)}`;
  if (e.state === 'final') {
    const sc = g.score ? `<span class="nw">${g.score[0] > g.score[1] ? 'W' : g.score[0] < g.score[1] ? 'L' : 'T'} ${g.score[0]}–${g.score[1]}</span> ` : '';
    return `<span class="gst">Final</span> ${sc}${at}`;
  }
  if (e.state === 'live') return `<span class="gst live">Live</span> ${at}`;
  return `${at}, ${esc(kickTxt(g))}`;
}
export function ptsBlock(e) {
  if (e.bye) return '<div class="pts bye"><span class="lbl">Bye</span><b>0</b></div>';
  if (e.state === 'final') {
    if (e.noScore || e.actual == null) return `<div class="pts final"><span class="lbl">Played</span><b>–</b><small>score not in yet</small></div>`;
    const d = e.actual - e.projExp;
    return `<div class="pts final"><span class="lbl">Scored</span><b>${fmt(e.actual)}</b><small>proj ${fmt(e.projExp)}, <span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}</span></small></div>`;
  }
  if (e.state === 'live') return `<div class="pts live"><span class="lbl">So far</span><b>${fmt(e.actual ?? 0)}</b><small>on pace for ${fmt(e.exp)}</small></div>`;
  return `<div class="pts proj"><span class="lbl">Projected</span><b>${fmt(e.exp)}</b><small>${fmt(e.floor)}–${fmt(e.ceil)}</small></div>`;
}
const injShort = (inj) => (inj ? `<span class="inj ${inj === 'Questionable' ? 'q' : ''}" title="${esc(inj)}">${esc(inj === 'Questionable' ? 'Q' : inj === 'Doubtful' ? 'D' : inj)}</span>` : '');

// one quiet line of context for players who haven't played: the biggest thing moving his number
function whyLine(e) {
  if (e.bye || e.state !== 'upcoming') return '';
  const inj = e.factors.find((f) => f.label === 'Injury');
  if (inj) return `<div class="why">${esc(inj.why.split('.')[0])}.</div>`;
  const f = [...e.factors].filter((x) => Math.abs(x.mult - 1) >= 0.08).sort((a, b) => Math.abs(b.mult - 1) - Math.abs(a.mult - 1))[0];
  if (!f) return '';
  const pct = Math.round((f.mult - 1) * 100);
  return `<div class="why"><b class="${pct > 0 ? 'good' : 'bad'}">${pct > 0 ? '+' : '−'}${Math.abs(pct)}%</b> ${esc(f.label.replace(/^[A-Z][a-z]/, (s) => s.toLowerCase()))}</div>`;
}

function luRow(e, slot, { isNew = false } = {}) {
  if (!e) return `<div class="lu-row"><span class="slot">${esc(SLOT_TXT[slot] || slot)}</span><span class="empty">${SLOT_OK[slot] ? 'Empty slot' : 'Not modeled (IDP)'}</span><span></span></div>`;
  const p = e.p;
  const upcoming = !e.bye && e.state === 'upcoming';
  const dead = e.bye || (upcoming && e.pPlay === 0);
  const click = p.stub ? '' : `data-act="player" data-id="${esc(p.id)}"`;
  return `<div class="lu-row st-${e.bye ? 'bye' : e.state} ${p.stub ? '' : 'click'} ${isNew ? 'new' : ''} ${dead ? 'dead' : ''}" ${click}>
    <span class="slot">${slot ? esc(SLOT_TXT[slot] || slot) : ''}</span>
    <div><div class="pname"><span>${esc(p.name)}</span>${posBadge(p.pos)}${upcoming ? injShort(e.status?.injury) : ''}</div>
      <div class="gline">${esc(e.team || p.team || 'FA')} ${gameLine(e)}</div>${whyLine(e)}</div>
    ${ptsBlock(e)}</div>`;
}

function statusLine(sp) {
  if (!sp) return '';
  if (!sp.played && !sp.live) return `<div class="lu-status"><span><i class="up"></i>Nobody has played yet</span></div>`;
  return `<div class="lu-status"><span><i class="fin"></i>Played <b>${sp.played}</b>, <b>${fmt(sp.playedPts)}</b> pts</span>
    ${sp.live ? `<span><i class="lv"></i>Live <b>${sp.live}</b>, <b>${fmt(sp.livePts)}</b> so far</span>` : ''}
    <span><i class="up"></i>To play <b>${sp.left}</b>, <b>${fmt(sp.upcomingProj)}</b> projected</span></div>`;
}

function pivots(X) {
  // questionable starters: who replaces them if they sit
  const rec = X.rec, out = [];
  rec.filled.forEach((e, i) => {
    if (!e || e.locked || !(e.pPlay > 0 && e.pPlay < 0.9)) return;
    const used = new Set(rec.filled.filter(Boolean).map((x) => x.p.id));
    const alt = X.me.entries.filter((x) => !used.has(x.p.id) && !x.locked && !x.bye && x.pPlay > 0.5 && (SLOT_OK[rec.slots[i]] || []).includes(x.pos)).sort((a, b) => b.exp - a.exp)[0];
    out.push({ e, alt });
  });
  return out;
}

const LU_TABS = [['week', 'This week'], ['roster', 'Roster'], ['waiver', 'Waiver wire']];
export function lineupHead(C, X, sub = '') {
  return `<header class="ph"><div><h1>Lineup</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <div class="ph-ctl">
      <select data-lu="luTeam" aria-label="Team">${X.teams.map((t) => `<option value="${t.rid}" ${t.rid === X.rid ? 'selected' : ''}>${t.rid === X.mine ? '★ ' : ''}${esc(t.name)}</option>`).join('')}</select>
      <select data-lu="luWeek" aria-label="Week">${Array.from({ length: 18 }, (_, i) => i + 1).map((w) => `<option value="${w}" ${w === X.week ? 'selected' : ''}>Week ${w}${w === X.curWeek ? ' (now)' : ''}</option>`).join('')}</select>
      <button class="btn" data-act="lu-refresh" title="Refresh rosters, projections, lines and weather">${icon('refresh')}<span class="hide-sm">Refresh</span></button>
    </div></header>
    <nav class="utabs">${LU_TABS.map(([k, n]) => `<button class="${C.ui.luSeg === k ? 'on' : ''}" data-act="lu-seg" data-v="${k}">${n}</button>`).join('')}</nav>`;
}

export function lineupView(C, lg, X) {
  const msg = {
    loading: ['Loading this week', 'Pulling rosters, matchups, Sleeper projections, Vegas lines and weather.'],
    error: ['Couldn’t load the week', X.error ? `Sleeper said: ${X.error}` : ''],
    'no-rosters': ['No rosters yet', 'Start/sit advice appears once teams have players on Sleeper.'],
    offseason: ['Season hasn’t started', `This league is set up for the ${X.season} season. Start/sit advice turns on once its games begin.`],
    'not-sleeper': ['Sleeper leagues only', 'Lineup advice needs a Sleeper league with rosters.'],
  }[X.msg];
  if (msg) {
    return `<header class="ph"><h1>Lineup</h1></header><div class="panel empty-state"><h2>${esc(msg[0])}</h2><p class="muted">${esc(msg[1])}</p>
      ${X.msg === 'error' ? '<button class="btn" data-act="lu-refresh">Try again</button>' : ''}</div>`;
  }
  const mineView = X.rid === X.mine;
  const me = X.me, opp = X.opp, rec = X.rec;
  const meName = me.team?.name || 'Team';
  const sub = `Week ${X.week}${opp ? ` against ${esc(opp.team?.name || 'opponent')}` : ''}${mineView ? '' : `, viewing ${esc(meName)}`}`;
  const head = lineupHead(C, X, sub);
  if (C.ui.luSeg === 'roster' && X.roster) return head + rosterSection(C, lg, X);
  if (C.ui.luSeg === 'waiver' && X.waiver) return head + waiverSection(C, lg, X);

  // the band: the scoreboard
  const max = Math.max(rec.total, X.oppBest?.total || 0, 1);
  const side = (name, L, sp, cls) => {
    const allDone = sp && sp.left === 0 && sp.live === 0;
    return `<div class="side ${cls}"><div class="tname">${esc(name)}</div><div class="big">${fmt(L.total)}</div>
      <div class="sub">${allDone ? 'Final' : sp && (sp.played || sp.live) ? 'Projected final' : 'Projected'}</div>
      ${sp ? `<div class="sbar"><i class="sc" style="width:${(100 * sp.scored) / max}%"></i><i class="tc" style="width:${(100 * Math.max(0, sp.toCome)) / max}%"></i></div>
      <div class="sub">${fmt(sp.scored)} scored, ${fmt(Math.max(0, sp.toCome))} to come</div>` : ''}</div>`;
  };
  const band = opp ? `<section class="band"><div class="score-band">
      ${side(meName, rec, X.split.rec, 'me')}
      <div class="mid"><div class="big">${pctTxt(X.winRec)}</div><div class="sub">chance to win</div>
        <div class="sub">${X.swaps.length ? `<b>${pctTxt(X.winNow)}</b> as set now` : 'lineup is set'}</div>
        ${X.medianInfo ? `<div class="sub"><b>${pctTxt(X.medianInfo.p)}</b> to beat the median</div>` : ''}</div>
      ${side(opp.team?.name || 'Opponent', X.oppBest, X.split.opp, 'them')}</div>
      <div class="band-key"><span><i class="sc"></i>Scored</span><span><i class="tc"></i>Still to play</span></div></section>`
    : `<section class="band"><div class="score-band"><div class="side me"><div class="tname">${esc(meName)}</div><div class="big">${fmt(rec.total)}</div><div class="sub">Projected, no head-to-head matchup this week</div></div></div></section>`;

  // your moves
  const piv = pivots(X);
  const moves = X.swaps.map((sw) => {
    const gain = sw.in.exp - (sw.out ? sw.out.exp : 0);
    const why = [...topFactors(sw.in, 2).filter((f) => f.tone === 'good').map((f) => `<li class="good">${esc(f.why)}</li>`),
      ...(sw.out ? topFactors(sw.out, 3).filter((f) => f.tone === 'bad' || f.tone === 'warn').map((f) => `<li class="bad">${esc(lastName(sw.out.p.name))}: ${esc(f.why)}</li>`) : []),
      ...(sw.out?.bye ? [`<li class="bad">${esc(sw.out.p.name)} is on bye.</li>`] : []),
      ...(gain < 0 && X.mode !== 'balanced' ? [`<li>A little lower on average, but ${X.mode === 'safe' ? 'a steadier floor' : 'more ceiling'}, which suits this matchup.</li>`] : [])].slice(0, 4).join('');
    return `<div class="mv"><div class="l1"><span>Start <b>${esc(sw.in.p.name)}</b>${sw.out ? ` for <b>${esc(sw.out.p.name)}</b>` : ' in the empty slot'}</span><span class="gain">${gain >= 0 ? '+' : '−'}${fmt(Math.abs(gain))}</span></div>
      <div class="l2">${fmt(sw.in.exp)} projected${sw.out ? ` vs ${fmt(sw.out.exp)}` : ''}</div>
      ${why ? `<details><summary class="disclose">Why</summary><ul>${why}</ul></details>` : ''}</div>`;
  }).join('');
  const watch = piv.map(({ e, alt }) => `<div class="watch"><b>${esc(e.p.name)}</b> is ${esc((e.status?.injury || 'questionable').toLowerCase())} (${pctTxt(e.pPlay)} to play). ${alt ? `If he’s ruled out, start ${esc(alt.p.name)}.` : 'No healthy backup at his slot on your bench.'}${e.gameTimeDecision ? ' Late kickoff: check inactives 90 minutes before.' : ''}</div>`).join('');
  const movesSect = `<section class="sect moves">
    <header><h3>${mineView ? 'Your moves' : 'Their moves'}</h3>
      <div class="segc" role="group" aria-label="Lineup style">${MODES.map(([k, n]) => `<button class="${C.ui.luMode === k ? 'on' : ''}" data-act="lu-mode" data-v="${k}">${n}</button>`).join('')}</div></header>
    ${C.ui.luMode === 'auto' ? `<p class="small muted">${esc(X.why)}</p>` : ''}
    ${moves || `<div class="ok">${X.empties ? 'Fill the empty slot in Sleeper.' : 'Your Sleeper lineup is already the best one.'}</div>`}
    ${watch ? `<h4 style="margin-top:14px">Injury watch</h4>${watch}` : ''}
    <p class="small" style="margin:12px 0 4px"><a href="https://sleeper.com/leagues/${esc(lg.sleeper.leagueId)}/team" target="_blank" rel="noopener">Make changes in Sleeper</a> <span class="muted">(other apps can’t edit lineups)</span></p>
  </section>
  ${opp ? `<details class="sect"><summary class="disclose">${esc(opp.team?.name || 'Opponent')}’s lineup, ${fmt(X.oppBest.total)}</summary>${X.oppBest.filled.map((e, i) => luRow(e, X.oppBest.slots[i])).join('')}</details>` : ''}`;

  const recIds = new Set(rec.filled.filter(Boolean).map((e) => e.p.id));
  const curIds = new Set(me.current.filled.filter(Boolean).map((e) => e.p.id));
  const starters = rec.filled.map((e, i) => luRow(e, rec.slots[i], { isNew: e && !curIds.has(e.p.id) })).join('');
  const benchList = me.entries.filter((e) => !recIds.has(e.p.id)).sort((a, b) => b.exp - a.exp);
  const bench = benchList.map((e) => luRow(e, curIds.has(e.p.id) ? 'Sit' : 'BN')).join('');
  const lists = `<section class="sect"><header><h3>Starters</h3>${X.swaps.length ? '<span class="sub">Yellow edge: change from Sleeper</span>' : ''}</header>${statusLine(X.split.rec)}${starters}</section>
    <section class="sect"><header><h3>Bench</h3><span class="sub">${benchList.length} players</span></header>${bench || '<p class="muted">No bench players.</p>'}</section>`;

  const s = X.sources;
  const foot = `<div class="datafoot"><span>Sleeper projections for ${s.proj || 'no'} players, betting lines for ${s.lines} of ${s.games} games, weather for ${s.wx} of ${s.outdoor} outdoor games.</span>
    <span>Injury news from ${esc(ago(s.injAt))} <button class="linkbtn" data-act="lu-injuries">Refresh injuries</button></span>
    <span data-ago="${s.at}">Updated ${esc(ago(s.at))}</span>${s.loading ? '<span>Refreshing…</span>' : ''}
    <button class="linkbtn" data-act="method">How projections work</button></div>`;
  return `${head}${band}<div class="lu-cols"><div class="c-moves">${movesSect}</div><div class="c-list">${lists}</div></div>${foot}`;
}
