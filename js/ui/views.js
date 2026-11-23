// Page views. Each returns an HTML string; app.js wires events through data-act attributes.
import { esc, fmt, pos, grade, tag, playerCell, riskTxt, ageTxt, ago, kickTxt, fxTag } from './h.js';
import { SLOT_OK } from '../weekly.js';
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
  return `<div class="chips">${POSF.map((p) => `<button class="chip ${ui[key] === p ? 'on' : ''}" data-act="ui" data-k="${key}" data-v="${p}">${p}</button>`).join('')}</div>`;
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
      <td class="num">${fmt(p.proj)}</td><td class="num hide-sm">${fmt(p.vorp, 0)}</td><td class="num hide-sm">${fmt(p.dyn, 0)}</td>
      <td>${grade(p.grades.outlook)}</td><td>${grade(p.grades.dynasty)}</td><td class="hide-sm">${grade(p.grades.ceiling)}</td>
      <td class="hide-sm">${grade(p.grades.floor)}</td><td class="hide-sm">${grade(p.grades.role)}</td><td>${riskTxt(p)}</td>
      <td class="num hide-sm">${p.mktRank ?? '–'}</td>
      <td class="num">${d == null ? '–' : `<span class="${d >= 15 ? 'risk-Low' : d <= -15 ? 'risk-High' : 'muted'}">${d > 0 ? '+' : ''}${d}</span>`}</td>
      <td class="small muted hide-sm">${taken ? `Taken ${esc(taken)}` : (p.flags || []).slice(0, 2).map((f) => f.label).join(', ')}</td></tr>`;
  }).join('');
  const head = COLS.map(([k, n]) => {
    const hideSm = ['vorp', 'dyn', 'ceiling', 'floor', 'role', 'mkt'].includes(k) ? ' hide-sm' : '';
    const num = ['rank', 'tier', 'proj', 'vorp', 'dyn', 'mkt', 'delta'].includes(k) ? ' num' : '';
    return `<th class="${ui.sort === k ? 'sorted' : ''}${hideSm}${num}" data-act="sort" data-k="${k}">${n}${ui.sort === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  }).join('') + '<th class="hide-sm">Notes</th>';
  return `
  <div class="controls">
    ${posChips(ui)}
    <input type="search" class="search" placeholder="Search player or team" value="${esc(ui.q)}" data-ui="q" aria-label="Search">
    ${weightControls(lg)}
    ${B.state ? `<label class="toggle"><input type="checkbox" data-ui-check="hideTaken" ${ui.hideTaken ? 'checked' : ''}> Hide drafted</label>` : ''}
    <label class="toggle"><input type="checkbox" data-ui-check="tagged" ${ui.tagged ? 'checked' : ''}> Targets only</label>
  </div>
  <div class="small muted" style="margin-bottom:8px">${esc(poolNote(B))} Grades are percentiles within each position. “vs market” = how many spots higher the model ranks him than consensus.</div>
  <div class="panel scroll" style="padding:0"><table><thead><tr>${head}</tr></thead><tbody>${rows || '<tr><td colspan="16" class="muted">No players match.</td></tr>'}</tbody></table></div>
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
      ${r.needPos.length ? `<div class="small" style="margin-top:6px">Needs: ${r.needPos.map((p) => tag(p, 'warn')).join(' ')} ${r.nextGuess.length && t.key !== ctx.myKey ? `<span class="muted">· likely targets ${r.nextGuess.join('/')} next</span>` : ''}</div>` : ''}
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
  </div>`;
}

// ---------------- Lineup (weekly start/sit) ----------------
const MODES = [['auto', 'Auto'], ['safe', 'Safe floor'], ['balanced', 'Max points'], ['upside', 'Upside']];
const SLOT_TXT = { SUPER_FLEX: 'SF', FLEX: 'FLEX', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', DEF: 'DEF', K: 'K' };
const posBadge = (p) => (['QB', 'RB', 'WR', 'TE'].includes(p) ? pos(p) : `<span class="pos">${esc(p)}</span>`);
const pctTxt = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

function topFactors(e, n = 3) {
  const fx = [...e.factors].sort((a, b) => Math.abs(b.mult - 1) - Math.abs(a.mult - 1));
  const inj = fx.find((f) => f.label === 'Injury' || f.label === 'Practice');
  const out = fx.filter((f) => f !== inj && Math.abs(f.mult - 1) >= 0.02).slice(0, inj ? n - 1 : n);
  return inj ? [inj, ...out] : out;
}

function luRow(e, slot, { isNew = false } = {}) {
  if (!e) return `<div class="lu-row"><span class="slot">${esc(SLOT_TXT[slot] || slot)}</span><span class="empty muted">${SLOT_OK[slot] ? 'Empty' : 'Not modeled (IDP)'}</span><span></span></div>`;
  const p = e.p, g = e.game;
  const inj = e.status?.injury;
  const state = e.done ? 'Final' : e.locked ? 'In progress' : '';
  const gameTxt = e.bye ? '<b class="risk-High">BYE</b>' : `${g.home ? 'vs' : '@'} ${esc(g.opp)} · ${esc(state || kickTxt(g))}`;
  const chips = e.bye ? '' : topFactors(e).map(fxTag).join('') + (e.gameTimeDecision && !e.locked ? tag('Late kickoff: have a pivot', 'warn') : '');
  const dead = e.bye || e.pPlay === 0;
  const val = e.done ? `<b>${fmt(e.exp)}</b><small>final</small>` : e.locked && e.actual != null ? `<b>${fmt(e.actual)}</b><small>so far · proj ${fmt(e.exp)}</small>` : `<b>${fmt(e.exp)}</b><small>${fmt(e.floor)}–${fmt(e.ceil)}</small>`;
  const click = p.stub ? '' : `data-act="player" data-id="${esc(p.id)}"`;
  return `<div class="lu-row ${p.stub ? '' : 'click'} ${isNew ? 'new' : ''} ${dead ? 'dead' : ''}" ${click}>
    <span class="slot">${slot ? esc(SLOT_TXT[slot] || slot) : ''}${e.locked ? ' 🔒' : ''}</span>
    <div><div class="pname">${posBadge(p.pos)} ${esc(p.name)}${inj ? ` <span class="tag ${inj === 'Questionable' ? 'warn' : 'bad'}">${esc(inj === 'Questionable' ? 'Q' : inj === 'Doubtful' ? 'D' : inj)}</span>` : ''}<small>${esc(e.team || p.team || 'FA')} ${gameTxt}</small></div>
      ${chips ? `<div class="fx">${chips}</div>` : ''}</div>
    <div class="pr">${val}</div></div>`;
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

export function lineupView(C, lg, X) {
  const msg = {
    loading: ['Loading this week…', 'Pulling rosters, matchups, Sleeper projections, Vegas lines and weather.'],
    error: ['Couldn’t load the week', X.error ? `Sleeper said: ${X.error}` : ''],
    'no-rosters': ['No rosters yet', 'Start/sit advice appears once teams have players on Sleeper.'],
    offseason: ['Season hasn’t started', `This league is set up for the ${X.season} season. Start/sit advice turns on once its games begin.`],
    'not-sleeper': ['Sleeper leagues only', 'Lineup advice needs a Sleeper league with rosters.'],
  }[X.msg];
  if (msg) {
    return `<div class="panel empty-state"><h2>${esc(msg[0])}</h2><p class="muted">${esc(msg[1])}</p>
      ${X.msg === 'error' ? '<div class="chips" style="justify-content:center"><button class="btn" data-act="lu-refresh">Try again</button></div>' : ''}</div>`;
  }
  const mineView = X.rid === X.mine;
  const s = X.sources;
  const controls = `<div class="lu-top">
    <label class="field"><span>Team</span><select data-lu="luTeam">${X.teams.map((t) => `<option value="${t.rid}" ${t.rid === X.rid ? 'selected' : ''}>${t.rid === X.mine ? '★ ' : ''}${esc(t.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Week</span><select data-lu="luWeek">${Array.from({ length: 18 }, (_, i) => i + 1).map((w) => `<option value="${w}" ${w === X.week ? 'selected' : ''}>Week ${w}${w === X.curWeek ? ' (now)' : ''}</option>`).join('')}</select></label>
    <div class="field"><span>Lineup style</span><div class="chips">${MODES.map(([k, n]) => `<button class="chip ${C.ui.luMode === k ? 'on' : ''}" data-act="lu-mode" data-v="${k}">${n}</button>`).join('')}</div></div>
    <button class="btn" data-act="lu-refresh">Refresh</button></div>
  <div class="lu-src small">
    ${tag(s.proj ? `Sleeper projections · ${s.proj} players` : 'Sleeper projections unavailable', s.proj ? '' : 'warn')}
    ${tag(`Vegas lines · ${s.lines} of ${s.games} games`, s.lines ? '' : 'warn')}
    ${tag(`Weather · ${s.wx} of ${s.outdoor} outdoor games`, '')}
    <button class="tag" data-act="lu-injuries" title="Re-pull injury designations from Sleeper">Injury statuses ${esc(ago(s.injAt))} ↻</button>
    <span class="tag" data-ago="${s.at}">Updated ${esc(ago(s.at))}</span>${s.loading ? tag('Refreshing…', 'info') : ''}</div>`;

  const me = X.me, opp = X.opp, rec = X.rec;
  const meName = me.team?.name || 'Team';
  const match = `<div class="panel">
    <h3>Week ${X.week} matchup${mineView ? '' : ` · ${esc(meName)}`}</h3>
    ${opp ? `<div class="match">
      <div><div class="small muted">${esc(meName)}</div><div class="tot">${fmt(rec.total)}</div><div class="small muted">± ${fmt(rec.sd)} · set now ${fmt(me.current.total)}</div></div>
      <div><div class="big">${pctTxt(X.winRec)}</div><div class="small muted">to win</div></div>
      <div><div class="small muted">${esc(opp.team?.name || 'Opponent')}</div><div class="tot">${fmt(X.oppBest.total)}</div><div class="small muted">± ${fmt(X.oppBest.sd)} · set now ${fmt(opp.current.total)}</div></div></div>
      <p class="small" style="margin:10px 0 0">With the lineup set in Sleeper right now: <b>${pctTxt(X.winNow)}</b> to win. Recommended: <b>${pctTxt(X.winRec)}</b>.
      ${X.medianInfo ? ` Chance to beat the league median (${fmt(X.medianInfo.median)}): <b>${pctTxt(X.medianInfo.p)}</b>.` : ''}</p>`
    : `<p class="muted">No head-to-head matchup found for this week. Projected total: <b>${fmt(rec.total)}</b>.</p>`}
    <p class="small muted" style="margin:8px 0 0"><b>${esc(MODES.find((m) => m[0] === X.mode)?.[1] || '')}</b>${C.ui.luMode === 'auto' ? ` (auto): ${esc(X.why)}` : ''} The opponent is projected with their best lineup.</p></div>`;

  const piv = pivots(X);
  const changes = `<div class="panel">
    <h3>${mineView ? 'Changes to make' : 'Changes they should make'}</h3>
    ${X.swaps.length ? X.swaps.map((sw) => {
      const gain = sw.in.exp - (sw.out ? sw.out.exp : 0);
      const modeNote = gain < 0 && X.mode !== 'balanced' ? `<li class="muted">A touch lower on average, but ${X.mode === 'safe' ? 'a steadier floor' : 'more ceiling'}, which suits this matchup.</li>` : '';
      const why = [...topFactors(sw.in, 2).filter((f) => f.tone === 'good').map((f) => `<li class="good">${esc(f.why)}</li>`),
        ...(sw.out ? topFactors(sw.out, 3).filter((f) => f.tone === 'bad' || f.tone === 'warn').map((f) => `<li class="bad">${esc(sw.out.p.name.split(' ').slice(-1)[0])}: ${esc(f.why)}</li>`) : []),
        ...(sw.out?.bye ? [`<li class="bad">${esc(sw.out.p.name)} is on bye.</li>`] : [])].slice(0, 4).join('') + modeNote;
      return `<div class="rec"><div class="row1">Start ${posBadge(sw.in.pos)} <b>${esc(sw.in.p.name)}</b> <span class="score">${gain >= 0 ? '+' : '−'}${fmt(Math.abs(gain))}</span></div>
        <div class="small muted">${sw.out ? `instead of ${esc(sw.out.p.name)} (${fmt(sw.out.exp)})` : 'in an empty slot'} · ${fmt(sw.in.exp)} projected</div>${why ? `<ul>${why}</ul>` : ''}</div>`;
    }).join('') : `<p>${X.empties ? '' : '✓ '}The lineup set in Sleeper already matches the recommendation.</p>`}
    ${piv.length ? `<h3 style="margin-top:12px">Injury watch</h3>${piv.map(({ e, alt }) => `<div class="flag">${tag(`${e.p.name}: ${pctTxt(e.pPlay)} to play`, 'warn')}<span class="muted">${alt ? `If he’s ruled out, start ${esc(alt.p.name)} (${fmt(alt.exp)}).` : 'No healthy bench option at his slot: consider a waiver pickup.'}${e.gameTimeDecision ? ' Late kickoff: check inactives ~90 minutes before.' : ''}</span></div>`).join('')}` : ''}
    <p class="small muted" style="margin:10px 0 0">Sleeper doesn’t let other apps change lineups, so make these in Sleeper. <a href="https://sleeper.com/leagues/${esc(lg.sleeper.leagueId)}/team" target="_blank" rel="noopener">Open Sleeper ↗</a></p></div>`;

  const recIds = new Set(rec.filled.filter(Boolean).map((e) => e.p.id));
  const curIds = new Set(me.current.filled.filter(Boolean).map((e) => e.p.id));
  const starters = rec.filled.map((e, i) => luRow(e, rec.slots[i], { isNew: e && !curIds.has(e.p.id) })).join('');
  const bench = me.entries.filter((e) => !recIds.has(e.p.id)).sort((a, b) => b.exp - a.exp).map((e) => luRow(e, curIds.has(e.p.id) ? 'SIT' : 'BN')).join('');
  const oppList = opp ? `<details class="panel" style="margin-top:14px"><summary><b>${esc(opp.team?.name || 'Opponent')}’s projected lineup</b> <span class="muted small">${fmt(X.oppBest.total)} pts</span></summary>
    ${X.oppBest.filled.map((e, i) => luRow(e, X.oppBest.slots[i])).join('')}</details>` : '';
  return `${controls}<div class="lu-grid">${match}${changes}</div>
    <div class="lu-grid"><div class="panel"><h3>Recommended starters <span class="muted small">gold bar = change from Sleeper</span></h3>${starters}</div>
    <div class="panel"><h3>Bench</h3>${bench || '<p class="muted">No bench players.</p>'}</div></div>${oppList}
    <p class="small muted">Each projection blends Sleeper’s projection (rescored in this league’s scoring) with recent form adjusted for the opposing defense, the Vegas team total and spread, home field, weather at kickoff, teammate injuries, QB changes and role trends, then multiplies by the chance he plays given his injury and practice status. Tap a player for the full breakdown.</p>`;
}
