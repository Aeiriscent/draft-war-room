// HTML for player outlooks, trade values and trade cards. Shared by the drawer, the Lineup tab and the Trades tab.
import { esc, fmt, pos, tag } from './h.js';
import { ordinal } from '../util.js';

const num = (x) => (x == null ? '–' : Math.round(x).toLocaleString());
const pct = (x) => `${Math.round(x * 100)}%`;
export const posBadge = (p) => (['QB', 'RB', 'WR', 'TE'].includes(p) ? pos(p) : `<span class="pos">${esc(p || 'PK')}</span>`);

export function scheduleStrip(ros) {
  if (!ros?.sch?.length) return '';
  return `<div class="sched" aria-label="Rest-of-season schedule">${ros.sch.map((g) => g.bye
    ? `<span class="wk bye ${g.playoff ? 'po' : ''}" title="Week ${g.wk}: bye"><i>${g.wk}</i>BYE</span>`
    : `<span class="wk ${g.tone} ${g.playoff ? 'po' : ''}" title="Week ${g.wk}: ${g.home ? 'vs' : '@'} ${esc(g.opp)}${g.rank ? `, allows the ${ordinal(g.rank)} most to the position` : ''}"><i>${g.wk}</i>${g.home ? '' : '@'}${esc(g.opp)}</span>`).join('')}</div>
    <div class="small muted sched-key"><span class="dot good"></span>soft <span class="dot bad"></span>tough matchup · <span class="po-key">underlined</span> = fantasy playoffs</div>`;
}

function listHTML(items, tone) {
  if (!items.length) return `<p class="muted small">${tone === 'good' ? 'Nothing that stands out.' : 'No major red flags.'}</p>`;
  return `<ul class="ol-list ${tone}">${items.map((x) => `<li><b>${esc(x.title)}.</b> ${esc(x.why)}</li>`).join('')}</ul>`;
}

export function futureHTML(f, p) {
  if (!f) return '';
  const path = f.path.length ? `<div class="path">${f.path.map((x) => `<div><b>${fmt(x.ppg)}</b><span>${x.season}${x.rank ? ` · ${esc(p.pos)}${x.rank}` : ''}${x.age != null ? ` · age ${x.age}` : ''}</span></div>`).join('<i>→</i>')}</div>` : '';
  const sc = f.bull && f.bear ? `<div class="scen">
      <div class="good"><b>Upside case: ${fmt(f.bull.ppg)} PPG${f.bull.rank ? ` (${esc(p.pos)}${f.bull.rank})` : ''}</b><span>if ${esc(f.bull.why)}</span></div>
      <div class="bad"><b>Downside case: ${fmt(f.bear.ppg)} PPG${f.bear.rank ? ` (${esc(p.pos)}${f.bear.rank})` : ''}</b><span>from ${esc(f.bear.why)}</span></div></div>` : '';
  return `${tag(f.phase, f.phase === 'Ascending' || f.phase === 'Prime' ? 'good' : f.phase === 'Late prime' ? 'warn' : f.phase === 'Pre-draft' ? 'info' : 'bad')}
    ${path}<p>${esc(f.text)}</p>${sc}
    ${f.watch.length ? `<div class="small"><b>What to watch:</b> ${esc(f.watch.join(' · '))}</div>` : ''}`;
}

/** Full outlook block. */
export function outlookHTML(o, p, { headline = true } = {}) {
  if (!o) return '';
  return `${headline ? `<p class="ol-head">${tag(o.role.label, o.role.tone)} ${esc(o.tagline)}</p>` : ''}
    <div class="ol-sec"><h4>How he’s producing</h4><p>${esc(o.now)}</p></div>
    ${o.cont ? `<div class="ol-sec"><h4>Will it last?</h4><p>${esc(o.cont)}</p></div>` : ''}
    ${o.ros ? `<div class="ol-sec"><h4>Rest of season · ${fmt(o.ros.ppg)} PPG (${esc(p.pos)}${o.ros.rank})</h4>${scheduleStrip(o.ros)}</div>` : ''}
    <div class="ol-two">
      <div class="ol-sec"><h4>Advantages</h4>${listHTML(o.adv, 'good')}</div>
      <div class="ol-sec"><h4>Risks</h4>${listHTML(o.risk, 'bad')}</div>
    </div>
    <div class="ol-sec"><h4>Next three seasons</h4>${futureHTML(o.future, p)}</div>`;
}

/** Trade value block. r: valueReport(). */
export function valueHTML(r, { canTrade = false } = {}) {
  if (!r) return '';
  const a = r.a;
  const maxV = Math.max(a.market, a.now, a.dyn, 1);
  const bar = (label, v, cls) => `<div class="vbar"><span>${label}</span><i style="width:${Math.max(2, (100 * v) / maxV)}%" class="${cls}"></i><b>${num(v)}</b></div>`;
  const act = canTrade && r.a.owner != null
    ? (r.mine ? `<button class="btn sm" data-act="tr-shop" data-id="${esc(a.id)}">See what he’d fetch</button>` : `<button class="btn sm gold" data-act="tr-target" data-id="${esc(a.id)}">Build an offer for him</button>`)
    : '';
  return `<div class="tv-top"><div class="tv-num"><b>${num(a.value)}</b><span>Trade value · #${a.rank ?? '–'} overall · ${esc(a.pos)}${a.posRank ?? '–'}</span></div>
      <div>${tag(r.verdict, r.tone)}${r.own ? `<div class="small muted" style="margin-top:4px">${r.mine ? 'On your team' : `Owned by ${esc(r.own.name)} (${esc(r.own.window.label.toLowerCase())})`}</div>` : ''}</div></div>
    ${bar('Market (trade value)', a.market, 'm')}${bar('Model: this season', a.now, 'n')}${bar('Model: long term', a.dyn, 'd')}
    <p class="small">${r.pickEq ? `Worth ${esc(r.pickEq)} in the ${esc(r.season)} rookie draft. ` : ''}To ${r.own && r.mine ? 'you' : 'a team like yours'} he’s worth about <b>${num(r.forMe)}</b> (${r.gap >= 0 ? '+' : '−'}${pct(Math.abs(r.gap))} vs market).</p>
    ${r.reasons.length ? `<ul class="ol-list">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${r.buyers.length ? `<p class="small muted">Teams that need a ${esc(a.pos)}: ${r.buyers.map((t) => esc(t.name)).join(', ')}.</p>` : ''}
    ${act}
    <p class="small muted" style="margin-top:8px">Scale: dynasty market values (FantasyPros consensus via DynastyProcess), adjusted for superflex and TE premium. The model columns re-rank players within each position from production, age and role.</p>`;
}

export function assetLabel(a) {
  if (a.kind === 'pick') return `<span class="pos pk">PK</span> ${esc(a.label)} <small class="muted">${esc(a.detail)}${a.via ? ` · via ${esc(a.via)}` : ''}</small>`;
  return `${posBadge(a.pos)} ${esc(a.label)} <small class="muted">${esc(a.p.team || '')}${a.p.age ? ` · ${Math.floor(a.p.age)}` : ''}</small>`;
}

/** A proposed trade as a card. o: evaluateTrade() result plus {them, giveIds, getIds}. */
export function tradeCard(o, { title = null, open = true } = {}) {
  const side = (list) => list.map((a) => `<div class="tc-asset">${assetLabel(a)} <span class="tc-v">${num(a.market)}</span></div>`).join('');
  const [al, at] = o.acc.label;
  return `<div class="tcard">
    ${title ? `<div class="tc-title">${title}</div>` : ''}
    <div class="tc-sides"><div><div class="tc-h">You send <span>trade value</span></div>${side(o.give)}</div><div class="tc-arrow">⇄</div><div><div class="tc-h">You get from ${esc(o.them.name)} <span>trade value</span></div>${side(o.get)}</div></div>
    <div class="chips" style="margin:8px 0 4px">${tag(o.grade[0], o.grade[1])}${tag(`${al} · ${pct(o.acc.p)}`, at)}</div>
    <ul class="ol-list small">${o.lines.slice(0, 4).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    ${open ? `<button class="btn sm" data-act="tr-open" data-partner="${o.them.rid}" data-give="${esc(o.giveIds.join(','))}" data-get="${esc(o.getIds.join(','))}">Open in trade builder</button>` : ''}
  </div>`;
}
