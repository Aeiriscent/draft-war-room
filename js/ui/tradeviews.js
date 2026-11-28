// Lineup → Roster breakdown / Waiver wire, and the Trades tab.
import { esc, fmt, tag } from './h.js';
import { posBadge, outlookHTML, valueHTML, scheduleStrip, tradeCard, assetLabel } from './insight.js';

const num = (x) => (x == null ? '–' : Math.round(x).toLocaleString());
const SLOT_TXT = { SUPER_FLEX: 'SF', FLEX: 'FLEX', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R' };
const injTag = (inj) => (inj ? ` <span class="tag ${inj === 'Questionable' ? 'warn' : 'bad'}">${esc(inj === 'Questionable' ? 'Q' : inj === 'Doubtful' ? 'D' : inj)}</span>` : '');

// ---------------- Lineup: roster breakdown ----------------
export function rosterSection(C, lg, X) {
  const list = X.roster;
  const cards = list.map(({ e, slot, o, r }) => {
    const p = e.p;

    return `<details class="pcard" ${C.ui.luOpen ? 'open' : ''}>
      <summary>
        <div class="pc-top">
          <div class="pc-who"><span class="slot">${slot ? esc(SLOT_TXT[slot] || slot) : 'BN'}</span>${posBadge(p.pos)} <b>${esc(p.name)}</b> <small class="muted">${esc(p.team || 'FA')}${p.age ? ` · ${Math.floor(p.age)}` : ''}</small>${injTag(e.status?.injury)}</div>
          <div class="pc-nums">
            <div><b>${e.bye ? 'BYE' : fmt(e.exp)}</b><span>Week ${X.week}</span></div>
            <div><b>${o.ros ? fmt(o.ros.ppg) : '–'}</b><span>${o.ros ? `Rest of season · ${esc(p.pos)}${o.ros.rank}` : 'Rest of season'}</span></div>
            <div><b>${r ? num(r.a.value) : '–'}</b><span>Trade value</span></div>
          </div>
        </div>
        <div class="pc-head">${tag(o.role.label, o.role.tone)}${r ? tag(r.verdict, r.tone) : ''}<span>${esc(o.tagline)}</span></div>
        ${scheduleStrip(o.ros)}
      </summary>
      <div class="pc-body">
        ${outlookHTML({ ...o, ros: null }, p, { headline: false })}
        ${r ? `<div class="ol-sec"><h4>Trade value</h4>${valueHTML(r, { canTrade: true })}</div>` : ''}
        <button class="btn sm" data-act="player" data-id="${esc(p.id)}">Full profile and game log</button>
      </div>
    </details>`;
  }).join('');
  return `<div class="row-between" style="margin-bottom:10px"><p class="small muted" style="margin:0">Every player on ${esc(X.me.team?.name || 'this team')}: role, this week, the rest of the season, the next three years and what he’s worth in a trade. Recommended starters first. Tap a player to expand.</p>
    <button class="btn sm" data-act="lu-open">${C.ui.luOpen ? 'Collapse all' : 'Expand all'}</button></div>${cards}`;
}

// ---------------- Lineup: waiver wire ----------------
export function waiverSection(C, lg, X) {
  const W = X.waiver;
  const posF = `<div class="chips" style="margin-bottom:10px">${['ALL', 'QB', 'RB', 'WR', 'TE'].map((k) => `<button class="chip ${C.ui.wvPos === k ? 'on' : ''}" data-act="wv-pos" data-v="${k}">${k === 'ALL' ? 'All' : k}</button>`).join('')}</div>`;
  const rows = W.rows.map(({ p, e, R, o, v, over }) => `<div class="wv-row click" data-act="player" data-id="${esc(p.id)}">
      <div class="pc-top">
        <div class="pc-who">${posBadge(p.pos)} <b>${esc(p.name)}</b> <small class="muted">${esc(p.team || 'FA')}${p.age ? ` · ${Math.floor(p.age)}` : ''}</small>${injTag(e.status?.injury)}</div>
        <div class="pc-nums">
          <div><b>${e.bye ? 'BYE' : fmt(e.exp)}</b><span>Week ${X.week}</span></div>
          <div><b>${fmt(R.ppg)}</b><span>Rest of season · ${esc(p.pos)}${R.rank}</span></div>
          <div><b>${v ? num(v.value) : '–'}</b><span>Trade value</span></div>
        </div>
      </div>
      <div class="pc-head">${tag(o.role.label, o.role.tone)}${over ? tag(`Starts over ${over.who.p.name} this week (+${fmt(over.gain)})`, 'good') : ''}</div>
      <ul class="ol-list small">${o.adv.slice(0, 2).map((a) => `<li class="good"><b>${esc(a.title)}.</b> ${esc(a.why)}</li>`).join('')}${o.risk.slice(0, 1).map((a) => `<li class="bad"><b>${esc(a.title)}.</b> ${esc(a.why)}</li>`).join('')}</ul>
    </div>`).join('') || '<p class="muted">No available players with production this season at that position.</p>';
  const stash = W.stash.map(({ p, v, o }) => `<div class="wv-row click" data-act="player" data-id="${esc(p.id)}">
      <div class="pc-top"><div class="pc-who">${posBadge(p.pos)} <b>${esc(p.name)}</b> <small class="muted">${esc(p.team || 'FA')} · ${Math.floor(p.age)}</small></div>
      <div class="pc-nums"><div><b>${num(v.dyn)}</b><span>Long-term value</span></div><div><b>${fmt(p.years?.[1])}</b><span>Proj. PPG ${p.years ? 'in 2 yrs' : ''}</span></div></div></div>
      <p class="small" style="margin:6px 0 0">${esc(o.future.text.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.'))}</p></div>`).join('') || '<p class="muted">No young players with real long-term value are unrostered.</p>';
  return `${posF}<div class="lu-grid"><div class="panel"><h3>Best available</h3><p class="small muted">Not on any roster in this league, ranked by rest-of-season scoring with this week’s matchup mixed in.</p>${rows}</div>
    <div class="panel"><h3>Dynasty stashes</h3><p class="small muted">Young unrostered players the model sees long-term value in. Worth a bench or taxi spot.</p>${stash}</div></div>
    <p class="small muted">Claim players in Sleeper. Players on IR and taxi squads count as rostered.</p>`;
}

// ---------------- Trades tab ----------------
export function tradesView(C, lg, I) {
  const msg = {
    loading: ['Loading the league…', 'Pulling rosters, records and traded picks from Sleeper.'],
    error: ['Couldn’t load the league', I.error || ''],
    'no-rosters': ['No rosters yet', 'Trade tools turn on once teams have players.'],
  }[I.msg];
  if (msg) return `<div class="panel empty-state"><h2>${esc(msg[0])}</h2><p class="muted">${esc(msg[1])}</p></div>`;
  const { T, me } = I;
  const rankOf = [...T.teams].sort((a, b) => b.totalValue - a.totalValue).findIndex((t) => t.rid === me.rid) + 1;
  const winTone = { Contender: 'good', Rebuilding: 'info', Middle: 'warn' }[me.window.label];
  const myPicks = me.picks.filter((p) => p.round <= 2);
  const head = `<div class="panel tr-head">
    <div class="tr-me">
      ${I.mineKnown ? `<h3 style="margin:0 0 4px">${esc(me.name)}</h3>` : `<label class="field"><span>Which team is yours?</span><select data-tr="trMe">${T.teams.map((t) => `<option value="${t.rid}" ${t.rid === me.rid ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`}
      <div class="chips" style="margin:6px 0">${tag(me.window.label + (me.window.auto ? '' : ' (your setting)'), winTone)}<span class="small muted">${esc(me.window.why)}</span></div>
      <div class="chips"><span class="small muted">Plan as:</span>${[['auto', 'Auto'], ['contend', 'Contending'], ['rebuild', 'Rebuilding']].map(([k, n]) => `<button class="chip ${I.window === k ? 'on' : ''}" data-act="tr-window" data-v="${k}">${n}</button>`).join('')}</div>
    </div>
    <div class="tr-facts">
      <div><b>${num(me.totalValue)}</b><span>Total asset value · ${rankOf ? `${rankOf} of ${T.teams.length}` : ''}</span></div>
      <div><span class="small muted">Needs</span><div class="chips">${me.needs.length ? me.needs.map((n) => tag(n.pos, 'bad')).join('') : '<span class="small muted">none</span>'}</div></div>
      <div><span class="small muted">Deep at</span><div class="chips">${me.strong.length ? me.strong.map((p) => tag(p, 'good')).join('') : '<span class="small muted">none</span>'}</div></div>
      <div><span class="small muted">Your 1sts and 2nds</span><div class="small">${myPicks.map((p) => `${esc(p.label)}${p.slot ? ` (${esc(p.detail.replace('projected ', ''))})` : ''}${p.via ? ` via ${esc(p.via)}` : ''}`).join(', ') || 'none'}</div></div>
    </div></div>`;
  const seg = `<div class="chips subseg">${[['ideas', 'Ideas for you'], ['builder', 'Trade builder'], ['chart', 'Value chart']].map(([k, n]) => `<button class="chip ${C.ui.trSeg === k ? 'on' : ''}" data-act="tr-seg" data-v="${k}">${n}</button>`).join('')}</div>`;
  let body = '';
  if (C.ui.trSeg === 'ideas') body = ideas(C, I);
  else if (C.ui.trSeg === 'builder') body = builder(C, I);
  else body = chart(C, I);
  return head + seg + body + `<p class="small muted" style="margin-top:12px">Values use the dynasty market (FantasyPros consensus via DynastyProcess) adjusted for superflex and TE premium, so “realistic” means fair by what other managers see. “Good for you” uses the model on your team’s timeline, blended with the market by your Model ↔ Market slider. Acceptance odds are an estimate. Send offers in Sleeper.</p>`;
}

function ideas(C, I) {
  const { T } = I;
  const ready = I.ready.length ? I.ready.map((o) => tradeCard(o, { title: `Target: ${esc(o.get[0].label)} <span class="muted">(${esc(o.them.name)})</span>` })).join('')
    : '<p class="muted">No offers that are both realistic and clearly good for you right now. Try the builder or the buy list.</p>';
  const sells = I.sells.map((s) => {
    const open = I.shop?.a.id === s.a.id;
    return `<div class="idea">
      <div class="idea-top"><div>${assetLabel(s.a)}</div><b>${num(s.a.value)}</b></div>
      <div class="small">${esc(s.why.join('; ').replace(/^./, (c) => c.toUpperCase()))}.</div>
      ${s.buyers.length ? `<div class="small muted">Likely buyers: ${s.buyers.map((t) => esc(t.name)).join(', ')}</div>` : ''}
      <div class="chips" style="margin-top:6px"><button class="btn sm" data-act="tr-shop" data-id="${esc(s.a.id)}">${open ? 'Hide offers' : 'See what he’d fetch'}</button><button class="btn sm" data-act="player" data-id="${esc(s.a.id)}">Profile</button></div>
      ${open ? `<div class="idea-offers">${I.shop.offers.length ? I.shop.offers.map((o) => tradeCard(o)).join('') : '<p class="muted small">No realistic returns found: teams that need him lack matching assets.</p>'}</div>` : ''}
    </div>`;
  }).join('') || '<p class="muted">Nobody on your roster stands out as a sell.</p>';
  const buys = I.buys.map((b) => {
    const open = I.target?.a.id === b.a.id;
    return `<div class="idea">
      <div class="idea-top"><div>${assetLabel(b.a)} <small class="muted">· ${esc(b.them.name)} (${esc(b.them.window.label.toLowerCase())})</small></div><b>${num(b.a.value)}</b></div>
      <div class="small">${esc(b.why.join('; ').replace(/^./, (c) => c.toUpperCase()))}.</div>
      <div class="chips" style="margin-top:6px"><button class="btn sm gold" data-act="tr-ideas-target" data-id="${esc(b.a.id)}">${open ? 'Hide offers' : 'Build offers'}</button><button class="btn sm" data-act="player" data-id="${esc(b.a.id)}">Profile</button></div>
      ${open ? `<div class="idea-offers">${I.target.offers.length ? I.target.offers.map((o) => tradeCard(o)).join('') : '<p class="muted small">No package from your roster lines up: you may need to include a starter. Try the builder.</p>'}</div>` : ''}
    </div>`;
  }).join('') || '<p class="muted">No clear bargains on other rosters right now.</p>';
  return `<div class="lu-grid">
    <div class="panel"><h3>Ready-made offers</h3><p class="small muted">Fair by market value (so they’re realistic to send) and good for you by the model.</p>${ready}</div>
    <div>
      <div class="panel" style="margin-bottom:14px"><h3>Who to send away</h3><p class="small muted">Worth more on the market than to your team: sell high, cash in depth, or move vets that don’t fit your timeline.</p>${sells}</div>
      <div class="panel"><h3>Best-value targets</h3><p class="small muted">Worth more to your team than they cost, with motivated owners first.</p>${buys}</div>
    </div></div>`;
}

function builder(C, I) {
  const { T, me } = I;
  const partner = I.partner;
  const sel = (ids) => new Set(ids);
  const give = sel(C.ui.trGive), get = sel(C.ui.trGet);
  const list = (team, chosen) => {
    const players = team.players.map((p) => T.assets.get(p.id)).filter(Boolean).sort((a, b) => b.value - a.value);
    const picks = team.picks.filter((p) => p.round <= 3);
    const row = (a) => `<button class="as-row ${chosen.has(a.id) ? 'on' : ''}" data-act="tr-toggle" data-id="${esc(a.id)}"><span>${assetLabel(a)}${a.starter ? ' <span class="tag good">starter</span>' : ''}</span><b>${num(a.value)}</b></button>`;
    return `<div class="as-list">${players.map(row).join('')}<div class="as-sep">Picks</div>${picks.map(row).join('')}</div>`;
  };
  const chosenChips = (ids) => ids.map((id) => T.assets.get(id)).filter(Boolean).map((a) => `<button class="chip on" data-act="tr-toggle" data-id="${esc(a.id)}">${esc(a.label)} ✕</button>`).join('') || '<span class="small muted">Tap players or picks below</span>';
  let ev = '<p class="muted">Pick what you’d send and what you want back. The grade, acceptance odds, lineup impact and fixes appear here.</p>';
  if (I.ev) {
    const o = I.ev;
    const mx = Math.max(o.mGive, o.mGet, o.vGive, o.vGet, 1);
    const bars = (label, a, b) => `<div class="cmp"><span>${label}</span><div><i class="send" style="width:${(100 * a) / mx}%"></i><em>${num(a)}</em></div><div><i class="get" style="width:${(100 * b) / mx}%"></i><em>${num(b)}</em></div></div>`;
    ev = `<div class="chips">${tag(o.grade[0], o.grade[1])}${tag(`${o.acc.label[0]} · ${Math.round(o.acc.p * 100)}%`, o.acc.label[1])}</div>
      <div class="cmp-key small muted"><span class="send"></span>You send <span class="get"></span>You get</div>
      ${bars('Market value', o.mGive, o.mGet)}${bars('Value to you', o.vGive, o.vGet)}
      <ul class="ol-list">${o.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${T.X ? `<p class="small muted">${esc(partner.name)}’s lineup: ${o.theirLine.ros >= 0 ? '+' : '−'}${fmt(Math.abs(o.theirLine.ros))} PPG this season, ${o.theirLine.next >= 0 ? '+' : '−'}${fmt(Math.abs(o.theirLine.next))} next season.</p>` : ''}
      ${o.balance.length ? `<h4>To even it out</h4>${o.balance.map((b) => `<div class="flag"><button class="btn sm" data-act="tr-toggle" data-id="${esc(b.a.id)}">${b.side === 'give' ? 'Add' : 'Ask for'} ${esc(b.a.label)} (${num(b.a.market)})</button><span class="muted small">${esc(b.why)}</span></div>`).join('')}` : ''}
      <div class="chips" style="margin-top:8px"><button class="btn sm" data-act="tr-clear">Clear</button></div>`;
  }
  const suggest = I.suggest ? `<div class="panel" style="margin-top:14px"><h3>Packages that could get it done</h3>${I.suggest.length ? I.suggest.map((o) => tradeCard(o)).join('') : '<p class="muted">Nothing on your roster lines up without a starter. Add pieces yourself.</p>'}</div>` : '';
  return `<div class="panel tb-eval"><h3>Your offer to <select data-tr="trPartner" class="inline">${T.teams.filter((t) => t.rid !== me.rid).map((t) => `<option value="${t.rid}" ${t.rid === partner?.rid ? 'selected' : ''}>${esc(t.name)} (${esc(t.window.label.toLowerCase())})</option>`).join('')}</select></h3>
      ${partner ? `<p class="small muted" style="margin-top:0">They need: ${partner.needs.map((n) => n.pos).join(', ') || 'nothing in particular'} · deep at: ${partner.strong.join(', ') || '–'} · ${esc(partner.window.why)}</p>` : ''}
      ${ev}</div>
    ${suggest}
    <div class="lu-grid" style="margin-top:14px">
      <div class="panel"><h3>You send</h3><div class="chips">${chosenChips(C.ui.trGive)}</div>${list(me, give)}</div>
      <div class="panel"><h3>You get</h3><div class="chips">${chosenChips(C.ui.trGet)}</div>${partner ? list(partner, get) : ''}</div>
    </div>
    ${I.ev ? `<div class="tb-sticky"><div class="chips">${tag(I.ev.grade[0], I.ev.grade[1])}${tag(`${I.ev.acc.label[0]} · ${Math.round(I.ev.acc.p * 100)}%`, I.ev.acc.label[1])}</div><span class="small">Market: send <b>${num(I.ev.mGive)}</b> · get <b>${num(I.ev.mGet)}</b></span><button class="btn sm" data-act="tr-top">Details ↑</button></div>` : ''}`;
}

function chart(C, I) {
  const { T, me } = I;
  const f = `<div class="chips" style="margin-bottom:10px">
    <select data-tr="vcPos" class="inline">${['ALL', 'QB', 'RB', 'WR', 'TE', 'PICK'].map((k) => `<option value="${k}" ${C.ui.vcPos === k ? 'selected' : ''}>${k === 'ALL' ? 'All positions' : k === 'PICK' ? 'Draft picks' : k}</option>`).join('')}</select>
    <select data-tr="vcTeam" class="inline"><option value="ALL">All teams</option>${T.teams.map((t) => `<option value="${t.rid}" ${String(C.ui.vcTeam) === String(t.rid) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`;
  const rows = I.chart.map(({ a, own, forMe }, i) => {
    const gap = a.market > 0 ? (forMe - a.market) / a.market : 0;
    const mine = a.owner === me.rid;
    const v = mine ? (gap <= -0.15 ? ['Sell', 'bad'] : ['Hold', '']) : gap >= 0.15 ? ['Buy', 'good'] : gap <= -0.15 ? ['Overpriced', 'bad'] : ['Fair', ''];
    return `<tr ${a.kind === 'player' ? `class="click" data-act="player" data-id="${esc(a.id)}"` : ''}>
      <td class="num">${i + 1}</td><td>${assetLabel(a)}</td><td class="small">${own ? esc(own.name) : ''}${mine ? ' ★' : ''}</td>
      <td class="num"><b>${num(a.value)}</b></td><td class="num">${num(a.market)}</td><td class="num hide-sm">${a.kind === 'pick' ? '–' : num(a.now)}</td><td class="num hide-sm">${a.kind === 'pick' ? '–' : num(a.dyn)}</td><td>${tag(v[0], v[1])}</td></tr>`;
  }).join('');
  return `${f}<div class="panel scroll" style="padding:0"><table><thead><tr><th>#</th><th>Player / pick</th><th>Team</th><th class="num">Value</th><th class="num">Market</th><th class="num hide-sm">Model now</th><th class="num hide-sm">Model long-term</th><th>For you</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
