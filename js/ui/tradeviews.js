// Lineup → Roster breakdown / Waiver wire, and the Trades tab.
import { esc, fmt, tag, icon } from './h.js';
import { posBadge, outlookHTML, valueHTML, tradeCard, assetLabel } from './insight.js';
import { gameLine } from './views.js';

const num = (x) => (x == null ? '–' : Math.round(x).toLocaleString());
const SLOT_TXT = { SUPER_FLEX: 'SF', FLEX: 'FLEX', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R' };
// this week's number with a label that says whether it's a projection or real points
function weekNum(e, wk) {
  if (e.bye) return `<div><b>–</b><span>Bye in week ${wk}</span></div>`;
  if (e.state === 'final') return `<div><b>${e.actual != null ? fmt(e.actual) : '–'}</b><span>Scored, week ${wk}</span></div>`;
  if (e.state === 'live') return `<div><b class="bad">${fmt(e.actual ?? 0)}</b><span>So far, week ${wk}</span></div>`;
  return `<div class="proj"><b>${fmt(e.exp)}</b><span>Projected, week ${wk}</span></div>`;
}
const injShort = (inj) => (inj ? `<span class="inj ${inj === 'Questionable' ? 'q' : ''}" title="${esc(inj)}">${esc(inj === 'Questionable' ? 'Q' : inj === 'Doubtful' ? 'D' : inj)}</span>` : '');
const roleTxt = (o) => `<span class="role ${o.role.tone}">${esc(o.role.label)}</span>`;

// ---------------- Lineup: roster breakdown ----------------
export function rosterSection(C, lg, X) {
  const cards = X.roster.map(({ e, slot, o, r }) => {
    const p = e.p;
    return `<details class="pcard" ${C.ui.luOpen ? 'open' : ''}>
      <summary>
        <div>
          <div class="pc-who"><b>${esc(p.name)}</b>${posBadge(p.pos)}${e.state === 'upcoming' ? injShort(e.status?.injury) : ''}</div>
          <div class="pc-line">${roleTxt(o)}${slot ? `, starting at ${esc(SLOT_TXT[slot] || slot)}` : ', on the bench'}. ${esc(o.tagline)}</div>
          <div class="pc-line">${esc(p.team || 'FA')} ${gameLine(e)}</div>
        </div>
        <div class="pc-nums">
          ${weekNum(e, X.week)}
          <div><b>${o.ros ? fmt(o.ros.ppg) : '–'}</b><span>${o.ros ? `Rest of season, ${esc(p.pos)}${o.ros.rank}` : 'Rest of season'}</span></div>
          <div><b>${r ? num(r.a.value) : '–'}</b><span>Trade value</span></div>
        </div>
      </summary>
      <div class="pc-body">
        ${outlookHTML(o, p, { headline: false })}
        ${r ? `<div class="ol-sec"><h4>Trade value</h4>${valueHTML(r, { canTrade: true })}</div>` : ''}
        <button class="btn sm" data-act="player" data-id="${esc(p.id)}">Open full profile</button>
      </div>
    </details>`;
  }).join('');
  return `<div class="row-between" style="margin-bottom:12px"><p class="muted" style="margin:0;max-width:70ch">Each player’s role on your team, this week, the rest of the season, the next three years and his trade value. Tap a player for the full write-up.</p>
    <button class="btn sm ghost" data-act="lu-open">${C.ui.luOpen ? 'Collapse all' : 'Expand all'}</button></div><div class="plist">${cards}</div>`;
}

// ---------------- Lineup: waiver wire ----------------
export function waiverSection(C, lg, X) {
  const W = X.waiver;
  const posF = `<div class="segc" role="group" aria-label="Position" style="margin-bottom:14px">${['ALL', 'QB', 'RB', 'WR', 'TE'].map((k) => `<button class="${C.ui.wvPos === k ? 'on' : ''}" data-act="wv-pos" data-v="${k}">${k === 'ALL' ? 'All' : k}</button>`).join('')}</div>`;
  const rows = W.rows.map(({ p, e, R, o, v, over }) => `<div class="wv-row" data-act="player" data-id="${esc(p.id)}">
      <div>
        <div class="pc-who"><b>${esc(p.name)}</b>${posBadge(p.pos)}${e.state === 'upcoming' ? injShort(e.status?.injury) : ''}</div>
        <div class="pc-line">${roleTxt(o)} for the rest of the season. ${esc(o.tagline)}</div>
        <div class="pc-line">${esc(p.team || 'FA')} ${gameLine(e)}</div>
        ${over ? `<div class="hint mv">Would start over ${esc(over.who.p.name)} this week (+${fmt(over.gain)})</div>` : ''}
      </div>
      <div class="pc-nums">
        ${e.bye || e.state === 'upcoming' ? weekNum(e, X.week) : `<div><b>–</b><span>Already ${e.state === 'live' ? 'playing' : 'played'}</span></div>`}
        <div><b>${fmt(R.ppg)}</b><span>Rest of season, ${esc(p.pos)}${R.rank}</span></div>
        <div><b>${v ? num(v.value) : '–'}</b><span>Trade value</span></div>
      </div></div>`).join('') || '<p class="muted" style="padding:16px">No available players with production this season at that position.</p>';
  const stash = W.stash.map(({ p, v, o }) => `<div class="wv-row" data-act="player" data-id="${esc(p.id)}">
      <div><div class="pc-who"><b>${esc(p.name)}</b>${posBadge(p.pos)}</div>
        <div class="pc-line">${esc(p.team || 'FA')}, age ${Math.floor(p.age)}. ${esc(o.future.text.split('. ')[0].replace(/\.?$/, '.'))}</div></div>
      <div class="pc-nums"><div><b>${num(v.dyn)}</b><span>Long-term value</span></div><div><b>${fmt(p.years?.[1])}</b><span>Projected PPG in 2 years</span></div></div></div>`).join('') || '<p class="muted" style="padding:16px">No young players with real long-term value are unrostered.</p>';
  return `${posF}
    <section style="margin-bottom:22px"><h3>Best available</h3><p class="muted small">Not on any roster in your league, ranked by rest-of-season scoring with this week mixed in. Claim players in Sleeper.</p><div class="plist">${rows}</div></section>
    <section><h3>Dynasty stashes</h3><p class="muted small">Young unrostered players with long-term value, worth a bench or taxi spot.</p><div class="plist">${stash}</div></section>`;
}

// ---------------- Trades tab ----------------
const TR_TABS = [['ideas', 'Ideas'], ['builder', 'Build a trade'], ['chart', 'Value chart']];
export function tradesView(C, lg, I) {
  const msg = {
    loading: ['Loading the league', 'Pulling rosters, records and traded picks from Sleeper.'],
    error: ['Couldn’t load the league', I.error || ''],
    'no-rosters': ['No rosters yet', 'Trade tools turn on once teams have players.'],
  }[I.msg];
  if (msg) return `<header class="ph"><h1>Trades</h1></header><div class="panel empty-state"><h2>${esc(msg[0])}</h2><p class="muted">${esc(msg[1])}</p></div>`;
  const { T, me } = I;
  const rankOf = [...T.teams].sort((a, b) => b.totalValue - a.totalValue).findIndex((t) => t.rid === me.rid) + 1;
  const top = me.picks.filter((p) => p.round === 1 && p.season === T.next);
  const head = `<header class="ph"><div><h1>Trades</h1><div class="sub">${esc(me.name)}</div></div>
    ${I.mineKnown ? '' : `<div class="ph-ctl"><label class="small muted" for="trMe">Your team</label><select id="trMe" data-tr="trMe">${T.teams.map((t) => `<option value="${t.rid}" ${t.rid === me.rid ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`}</header>`;
  const band = `<section class="band"><div class="trade-band">
    <div><h2>${esc(me.window.label)}${me.window.auto ? '' : ' (your setting)'}</h2><p>${esc(me.window.why)}.</p>
      <div class="segc" role="group" aria-label="Plan as">${[['auto', 'Auto'], ['contend', 'Contending'], ['rebuild', 'Rebuilding']].map(([k, n]) => `<button class="${I.window === k ? 'on' : ''}" data-act="tr-window" data-v="${k}">${n}</button>`).join('')}</div></div>
    <div class="facts">
      <div><b>${num(me.totalValue)}</b><span>Total value, ${rankOf ? `${rankOf} of ${T.teams.length}` : ''}</span></div>
      <div><b>${me.needs.length ? me.needs.map((n) => n.pos).join(', ') : 'None'}</b><span>Needs</span></div>
      <div><b>${me.strong.length ? me.strong.join(', ') : '–'}</b><span>Deepest at</span></div>
      <div><b>${top.length ? top.map((p) => (p.slot ? `1.${String(p.slot).padStart(2, '0')}` : '1st')).join(', ') : 'None'}</b><span>${T.next} first-round picks</span></div>
    </div></div></section>
    <nav class="utabs">${TR_TABS.map(([k, n]) => `<button class="${C.ui.trSeg === k ? 'on' : ''}" data-act="tr-seg" data-v="${k}">${n}</button>`).join('')}</nav>`;
  const body = C.ui.trSeg === 'ideas' ? ideas(C, I) : C.ui.trSeg === 'builder' ? builder(C, I) : chart(C, I);
  return head + band + body + `<p class="foot">Trade values are dynasty market prices (FantasyPros consensus via DynastyProcess), adjusted for superflex and TE premium, so a “realistic” offer is fair by what other managers see. “Good for you” uses the model on your timeline, blended with the market by your Model/Market setting. Acceptance odds are estimates. Send offers in Sleeper.</p>`;
}

function ideas(C, I) {
  const ready = I.ready.length ? I.ready.map((o) => tradeCard(o)).join('')
    : '<p class="muted" style="padding:10px 0">Nothing is both realistic and clearly good for you right now. Try the buy list or build one yourself.</p>';
  const row = (a, extra, why, btn, open, offersHTML) => `<div class="idea">
      <div class="idea-top"><div class="pc-who"><b>${esc(a.label)}</b>${posBadge(a.pos)}<small class="muted">${esc(a.p.team || '')}, ${a.p.age ? Math.floor(a.p.age) : ''}${extra}</small></div><span class="v">${num(a.value)}</span></div>
      <div class="why">${esc(why)}</div>
      <div class="acts">${btn}<button class="btn sm ghost" data-act="player" data-id="${esc(a.id)}">Profile</button></div>
      ${open ? `<div class="idea-offers">${offersHTML}</div>` : ''}</div>`;
  const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
  const more = (k, list) => (C.ui[k] ? list : list.slice(0, 5));
  const moreBtn = (k, list) => (list.length > 5 ? `<button class="btn sm ghost" data-act="ui-toggle" data-k="${k}" style="margin:8px 0 4px">${C.ui[k] ? 'Show fewer' : `Show all ${list.length}`}</button>` : '');
  const sells = more('trAllSell', I.sells).map((s) => {
    const open = I.shop?.a.id === s.a.id;
    const why = `${cap(s.why.join('; '))}.${s.buyers.length ? ` Likely buyers: ${s.buyers.map((t) => t.name).join(', ')}.` : ''}`;
    return row(s.a, '', why, `<button class="btn sm" data-act="tr-shop" data-id="${esc(s.a.id)}">${open ? 'Hide offers' : 'See what he’d fetch'}</button>`, open,
      open ? (I.shop.offers.length ? I.shop.offers.map((o) => tradeCard(o)).join('') : '<p class="muted small">No realistic returns: teams that need him lack matching assets.</p>') : '');
  }).join('') || '<p class="muted" style="padding:10px 0">Nobody on your roster stands out as a sell.</p>';
  const buys = more('trAllBuy', I.buys).map((b) => {
    const open = I.target?.a.id === b.a.id;
    return row(b.a, `, ${esc(b.them.name)}`, `${cap(b.why.join('; '))}.`, `<button class="btn sm" data-act="tr-ideas-target" data-id="${esc(b.a.id)}">${open ? 'Hide offers' : 'Build offers'}</button>`, open,
      open ? (I.target.offers.length ? I.target.offers.map((o) => tradeCard(o)).join('') : '<p class="muted small">Nothing on your roster lines up without a starter. Try the builder.</p>') : '');
  }).join('') || '<p class="muted" style="padding:10px 0">No clear bargains on other rosters right now.</p>';
  return `<div class="lu-cols">
    <div class="c-list"><section class="sect"><header><h3>Offers worth sending</h3><span class="sub">Fair by market value, good for you</span></header>${ready}</section></div>
    <div class="c-moves">
      <section class="sect"><header><h3>Sell</h3><span class="sub">Worth more to others than to you</span></header>${sells}${moreBtn('trAllSell', I.sells)}</section>
      <section class="sect"><header><h3>Buy</h3><span class="sub">Worth more to you than they cost</span></header>${buys}${moreBtn('trAllBuy', I.buys)}</section>
    </div></div>`;
}

function builder(C, I) {
  const { T, me } = I;
  const partner = I.partner;
  const give = new Set(C.ui.trGive), get = new Set(C.ui.trGet);
  const list = (team, chosen) => {
    const players = team.players.map((p) => T.assets.get(p.id)).filter(Boolean).sort((a, b) => b.value - a.value);
    const picks = team.picks.filter((p) => p.round <= 3);
    const row = (a) => `<button class="as-row ${chosen.has(a.id) ? 'on' : ''}" data-act="tr-toggle" data-id="${esc(a.id)}" aria-pressed="${chosen.has(a.id)}"><span>${assetLabel(a)}${a.starter ? ' <span class="st">starter</span>' : ''}</span><span class="v">${num(a.value)}</span></button>`;
    return `<div class="as-list">${players.map(row).join('')}<div class="as-sep">Draft picks</div>${picks.map(row).join('')}</div>`;
  };
  const chosenChips = (ids) => ids.map((id) => T.assets.get(id)).filter(Boolean).map((a) => `<button class="chip" data-act="tr-toggle" data-id="${esc(a.id)}" aria-label="Remove ${esc(a.label)}">${esc(a.label)} ${icon('close')}</button>`).join('') || '<span class="small muted">Tap players or picks below to add them.</span>';
  let ev = '<p class="muted" style="margin:8px 0 4px">Pick what you’d send and what you want back. The grade, the odds they accept, the lineup change and what would even it out show up here.</p>';
  if (I.ev) {
    const o = I.ev;
    const mx = Math.max(o.mGive, o.mGet, o.vGive, o.vGet, 1);
    const bars = (label, a, b) => `<span>${label}</span><div class="bars2"><div><i class="send" style="width:${(70 * a) / mx}%"></i><em>send ${num(a)}</em></div><div><i class="get" style="width:${(70 * b) / mx}%"></i><em>get ${num(b)}</em></div></div>`;
    ev = `<div class="chips" style="margin:6px 0">${tag(o.grade[0], o.grade[1])}${tag(`${o.acc.label[0]}, ${Math.round(o.acc.p * 100)}%`, o.acc.label[1])}</div>
      <div class="cmp">${bars('Market value', o.mGive, o.mGet)}${bars('Worth to you', o.vGive, o.vGet)}</div>
      <ul class="ol-list">${o.lines.map((l) => `<li>${esc(l)}</li>`).join('')}${T.X ? `<li>${esc(partner.name)}’s lineup: ${o.theirLine.ros >= 0 ? '+' : '−'}${fmt(Math.abs(o.theirLine.ros))} PPG this season, ${o.theirLine.next >= 0 ? '+' : '−'}${fmt(Math.abs(o.theirLine.next))} next season.</li>` : ''}</ul>
      ${o.balance.length ? `<h4 style="margin-top:14px">To even it out</h4>${o.balance.map((b) => `<div class="flag"><button class="btn sm" data-act="tr-toggle" data-id="${esc(b.a.id)}">${b.side === 'give' ? 'Add' : 'Ask for'} ${esc(b.a.label)}</button><span class="muted small">${esc(b.why)}</span></div>`).join('')}` : ''}
      <button class="btn sm ghost" style="margin-top:10px" data-act="tr-clear">Start over</button>`;
  }
  const suggest = I.suggest ? `<section class="sect"><header><h3>Packages that could get it done</h3></header>${I.suggest.length ? I.suggest.map((o) => tradeCard(o)).join('') : '<p class="muted">Nothing on your roster lines up without a starter. Add pieces yourself.</p>'}</section>` : '';
  return `<section class="sect tb-eval"><header><h3>Trade with <select data-tr="trPartner" aria-label="Trade partner">${T.teams.filter((t) => t.rid !== me.rid).map((t) => `<option value="${t.rid}" ${t.rid === partner?.rid ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></h3></header>
      ${partner ? `<p class="small muted" style="margin:0">${esc(partner.window.label)}. They need ${partner.needs.map((n) => n.pos).join(', ') || 'nothing in particular'}${partner.strong.length ? `; deepest at ${partner.strong.join(', ')}` : ''}.</p>` : ''}
      ${ev}</section>
    ${suggest}
    <div class="tb-top" style="margin-top:18px">
      <section class="sect"><header><h3>You send</h3></header><div class="picked">${chosenChips(C.ui.trGive)}</div>${list(me, give)}</section>
      <section class="sect"><header><h3>You get</h3></header><div class="picked">${chosenChips(C.ui.trGet)}</div>${partner ? list(partner, get) : ''}</section>
    </div>
    ${I.ev ? `<div class="tb-sticky"><div class="chips">${tag(I.ev.grade[0], I.ev.grade[1])}${tag(`${I.ev.acc.label[0]}, ${Math.round(I.ev.acc.p * 100)}%`, I.ev.acc.label[1])}</div><span class="small">Market: send ${num(I.ev.mGive)}, get ${num(I.ev.mGet)}</span><button class="btn sm" data-act="tr-top">See details</button></div>` : ''}`;
}

function chart(C, I) {
  const { T, me } = I;
  const f = `<div class="controls">
    <div class="segc" role="group" aria-label="Position">${['ALL', 'QB', 'RB', 'WR', 'TE', 'PICK'].map((k) => `<button class="${C.ui.vcPos === k ? 'on' : ''}" data-act="vc-pos" data-v="${k}">${k === 'ALL' ? 'All' : k === 'PICK' ? 'Picks' : k}</button>`).join('')}</div>
    <select data-tr="vcTeam" aria-label="Team"><option value="ALL">All teams</option>${T.teams.map((t) => `<option value="${t.rid}" ${String(C.ui.vcTeam) === String(t.rid) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`;
  const rows = I.chart.map(({ a, own, forMe }, i) => {
    const gap = a.market > 0 ? (forMe - a.market) / a.market : 0;
    const mine = a.owner === me.rid;
    const v = mine ? (gap <= -0.15 ? ['Sell', 'bad'] : ['Hold', 'muted']) : gap >= 0.15 ? ['Buy', 'good'] : gap <= -0.15 ? ['Overpriced', 'bad'] : ['Fair', 'muted'];
    return `<tr ${a.kind === 'player' ? `class="click" data-act="player" data-id="${esc(a.id)}"` : ''}>
      <td class="num muted">${i + 1}</td><td>${assetLabel(a)}</td><td>${own ? esc(own.name) : ''}${mine ? ' <span class="star">★</span>' : ''}</td>
      <td class="num"><b>${num(a.value)}</b></td><td class="num hide-sm muted">${a.kind === 'pick' ? '–' : num(a.now)}</td><td class="num hide-sm muted">${a.kind === 'pick' ? '–' : num(a.dyn)}</td><td class="${v[1]}">${v[0]}</td></tr>`;
  }).join('');
  return `${f}<section class="sect scroll" style="padding:0"><table><thead><tr><th class="num">#</th><th>Player or pick</th><th>Team</th><th class="num">Trade value</th><th class="num hide-sm">Model, this year</th><th class="num hide-sm">Model, long term</th><th>For you</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}
