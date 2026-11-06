// Business overview (daily income + growth) and the reconnect-mode card. Plugs into admin.js through window.SynthAdmin.
(() => {
  const A = window.SynthAdmin; if (!A) return;
  const { api, $, el, toast } = A;
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const ksh = (n) => 'KSh ' + Math.round(n || 0).toLocaleString('en-KE');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const parts = (key) => { const d = new Date(key + 'T00:00:00Z'); return { dow: DOW[d.getUTCDay()], day: d.getUTCDate(), mon: MON[d.getUTCMonth()] }; };
  const longDate = (key) => { const p = parts(key); return `${p.dow} ${p.day} ${p.mon}`; };

  // Money with a sign, for profit/loss. Small fractional amounts keep their cents (fees can be KSh 1.30).
  const kshf = (n) => { n = Math.round((n || 0) * 100) / 100; const a = Math.abs(n), body = (a < 100 && !Number.isInteger(a)) ? a.toFixed(2) : Math.round(a).toLocaleString('en-KE'); return (n < 0 ? '\u2212' : '') + 'KSh ' + body; };
  const niceStep = (span) => { const raw = Math.max(span, 1) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag; };
  const addDays = (key, n) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const PALETTE = ['#34d399', '#22d3ee', '#a78bfa', '#fbbf24', '#fb7185', '#60a5fa', '#f472b6'];

  let days = 30, timer = null, lastData = null, selDate = null, costsDirty = false;

  // "▲ 12%" green, "▼ 8%" red, "New" when there was nothing to compare with.
  function change(pct, label) {
    const span = el('span', 'text-xs font-semibold');
    if (pct === null) { span.textContent = 'New ' + label; span.className += ' text-emerald-300'; }
    else if (pct === 0) { span.textContent = 'No change ' + label; span.className += ' text-slate-400'; }
    else { span.textContent = `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% ${label}`; span.className += pct > 0 ? ' text-emerald-300' : ' text-rose-300'; }
    return span;
  }
  function card(label, value, sub, extra) {
    const c = el('div', 'rounded-2xl border border-slate-800 bg-slate-950/60 p-3 space-y-0.5');
    c.append(el('p', 'text-[11px] font-semibold uppercase tracking-wide text-slate-500', label), el('p', 'text-xl font-extrabold text-white', value), el('p', 'text-xs text-slate-400', sub));
    if (extra) c.append(extra);
    return c;
  }

  function renderTrend(d) {
    const t = d.trend, box = $('bizTrend'); box.replaceChildren();
    const up = t.direction === 'up', down = t.direction === 'down';
    const row = el('div', 'flex items-center gap-3');
    row.append(el('div', 'grid h-11 w-11 shrink-0 place-items-center rounded-xl text-2xl ' + (up ? 'bg-emerald-400/15 text-emerald-300' : down ? 'bg-rose-400/15 text-rose-300' : 'bg-slate-700/40 text-slate-300'), up ? '📈' : down ? '📉' : '➖'));
    const txt = el('div', 'min-w-0');
    let head;
    if (t.last7Income === 0 && t.prev7Income === 0) head = 'No sales in the last 14 days yet.';
    else if (t.weekChangePct === null) head = `Sales are picking up: ${ksh(t.last7Income)} in the last 7 days, nothing the week before.`;
    else if (up) head = `Business is growing: last 7 days are up ${t.weekChangePct}% on the week before.`;
    else if (down) head = `Income is down ${Math.abs(t.weekChangePct)}% compared with the week before.`;
    else head = `Business is steady: last 7 days are within ${Math.abs(t.weekChangePct)}% of the week before.`;
    txt.append(el('p', 'font-semibold text-slate-100', head));
    const slope = t.slopePerDay;
    txt.append(el('p', 'text-xs text-slate-400', `Last 7 complete days ${ksh(t.last7Income)} · the 7 before ${ksh(t.prev7Income)}` + (slope ? ` · trend ${slope > 0 ? '+' : '−'}${ksh(Math.abs(slope))} per day over the selected range` : '')));
    row.append(txt); box.append(row);
  }

  function renderKpis(d) {
    const k = d.kpis, box = $('bizKpis'); box.replaceChildren();
    box.append(
      card('Today so far', ksh(k.today.income), `${k.today.sales} sale${k.today.sales === 1 ? '' : 's'}`, change(k.today.changePct, 'vs yesterday so far')),
      card('Yesterday', ksh(k.yesterday.income), `${k.yesterday.sales} sale${k.yesterday.sales === 1 ? '' : 's'}`),
      card('Last 7 days', ksh(k.last7.income), `${k.last7.sales} sales`, change(k.last7.changePct, 'vs previous 7')),
      card('Last 30 days', ksh(k.last30.income), `${k.last30.sales} sales`, change(k.last30.changePct, 'vs previous 30')),
      card('This month', ksh(k.month.income), `${k.month.sales} sales`, change(k.month.changePct, 'vs last month so far')),
      card('Customers', String(k.customers.unique), `${k.customers.new} new · ${k.customers.returning} returning (${d.days}d)`)
    );
    const r = k.range, bits = [`In the last ${d.days} days: ${ksh(r.income)} from ${r.sales} sales`, `average ${ksh(r.avgPerDay)} a day`, r.sales ? `average sale ${ksh(r.avgSale)}` : null];
    if (k.bestDay) bits.push(`best day ${longDate(k.bestDay.date)} (${ksh(k.bestDay.income)})`);
    if (k.successRate != null) bits.push(`${k.successRate}% of M-Pesa requests were paid`);
    $('bizNote').textContent = bits.filter(Boolean).join(' · ') + '.';
  }

  function renderChart(d) {
    const host = $('bizChart'); host.replaceChildren();
    const data = d.daily, W = 720, H = 240, L = 46, R = 8, T = 10, B = 28, pw = W - L - R, ph = H - T - B;
    const maxV = Math.max(1, ...data.map((x) => Math.max(x.income, x.ma7 || 0)));
    const step = (() => { const raw = maxV / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag; })();
    const top = Math.ceil(maxV / step) * step, y = (v) => T + ph - (v / top) * ph, bw = pw / data.length;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-auto', role: 'img', 'aria-label': 'Daily income bar chart with 7-day trend line' });
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: '#1e293b', 'stroke-width': 1 }), svgEl('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', fill: '#64748b', 'font-size': 10 }, v >= 1000 ? (v / 1000) + 'k' : String(v)));
    }
    const tip = el('div', 'pointer-events-none absolute z-10 hidden rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl'); 
    data.forEach((x, i) => {
      const bx = L + i * bw, h = Math.max(x.income > 0 ? 2 : 0, ph - (y(x.income) - T));
      svg.append(svgEl('rect', { x: bx + bw * 0.14, y: T + ph - h, width: Math.max(1, bw * 0.72), height: h, rx: Math.min(3, bw * 0.2), fill: x.partial ? 'url(#bizHatch)' : '#34d399', opacity: x.income ? 1 : 0.25, stroke: x.partial ? '#34d399' : 'none', 'stroke-dasharray': x.partial ? '3 2' : '' }));
      const every = data.length <= 14 ? 1 : data.length <= 31 ? 3 : data.length <= 60 ? 7 : 14;
      if (i % every === 0 || i === data.length - 1) { const p = parts(x.date); svg.append(svgEl('text', { x: bx + bw / 2, y: H - 10, 'text-anchor': 'middle', fill: '#64748b', 'font-size': 10 }, data.length <= 14 ? `${p.dow} ${p.day}` : `${p.day} ${p.mon}`)); }
    });
    const defs = svgEl('defs'); const pat = svgEl('pattern', { id: 'bizHatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.append(svgEl('rect', { width: 6, height: 6, fill: 'rgba(52,211,153,.18)' }), svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#34d399', 'stroke-width': 2 })); defs.append(pat); svg.prepend(defs);
    const pts = data.map((x, i) => (x.ma7 == null ? null : [L + i * bw + bw / 2, y(x.ma7)])).filter(Boolean);
    if (pts.length > 1) svg.append(svgEl('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: '#67e8f9', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    // invisible hit areas for hover / tap
    data.forEach((x, i) => {
      const hit = svgEl('rect', { x: L + i * bw, y: T, width: bw, height: ph, fill: 'transparent', style: 'cursor:pointer' });
      const show = () => {
        tip.replaceChildren(el('p', 'font-semibold text-white', longDate(x.date) + (x.partial ? ' (today, so far)' : '')), el('p', 'text-emerald-300', ksh(x.income)), el('p', 'text-slate-400', `${x.sales} sale${x.sales === 1 ? '' : 's'} · ${x.customers} customer${x.customers === 1 ? '' : 's'}`));
        if (d.includeManual && x.manual) tip.append(el('p', 'text-slate-500', `M-Pesa ${ksh(x.mpesa)} · manual ${ksh(x.manual)}`));
        if (x.ma7 != null) tip.append(el('p', 'text-cyan-300', `7-day trend ${ksh(x.ma7)}`));
        tip.classList.remove('hidden');
        const r = host.getBoundingClientRect(), xPct = (L + i * bw + bw / 2) / W; tip.style.left = Math.min(Math.max(8, xPct * r.width - 70), r.width - 150) + 'px'; tip.style.top = '4px';
      };
      hit.addEventListener('mouseenter', show); hit.addEventListener('click', show); hit.addEventListener('mouseleave', () => tip.classList.add('hidden'));
      svg.append(hit);
    });
    host.append(svg, tip);
    if (!data.some((x) => x.income > 0)) host.append(el('p', 'absolute inset-0 grid place-items-center text-sm text-slate-500', 'No sales in this period yet.'));
  }

  function renderWeeks(d) {
    $('bizWeeks').replaceChildren(...d.weekly.slice().reverse().map((w) => {
      const tr = el('tr', 'border-t border-slate-800'); const p = parts(w.weekStart), c = el('td', 'text-right');
      if (w.partial) c.append(el('span', 'text-xs text-slate-500', 'this week so far'));
      else c.append(w.isNew ? change(null, '') : change(w.changePct, ''));
      tr.append(el('td', 'py-1.5 pr-3 text-slate-300', `${p.day} ${p.mon}`), el('td', 'pr-3 text-right font-semibold', ksh(w.income)), el('td', 'pr-3 text-right text-slate-400', String(w.sales)), c);
      return tr;
    }));
  }

  function renderMix(d) {
    const box = $('bizPackages'); box.replaceChildren();
    if (!d.packages.length) box.append(el('p', 'text-sm text-slate-500', 'No sales in this period yet.'));
    for (const p of d.packages.slice(0, 6)) {
      const row = el('div', 'space-y-1'), top = el('div', 'flex items-baseline justify-between gap-2 text-sm');
      top.append(el('span', 'truncate text-slate-200', p.name), el('span', 'shrink-0 text-slate-400', `${ksh(p.income)} · ${p.sales} sold · ${p.sharePct}%`));
      const bar = el('div', 'h-2 overflow-hidden rounded-full bg-slate-800'), fill = el('div', 'h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400'); fill.style.width = Math.max(2, p.sharePct) + '%'; bar.append(fill);
      row.append(top, bar); box.append(row);
    }
    const h = $('bizHours'); h.replaceChildren();
    const max = Math.max(1, ...d.hours), wrap = el('div', 'flex h-16 items-end gap-[3px]');
    d.hours.forEach((n, hr) => { const b = el('div', 'flex-1 rounded-t ' + (n === max && n > 0 ? 'bg-amber-400' : 'bg-emerald-500/60')); b.style.height = Math.max(n ? 6 : 2, n / max * 100) + '%'; b.title = `${String(hr).padStart(2, '0')}:00 · ${n} sale${n === 1 ? '' : 's'}`; wrap.append(b); });
    const axis = el('div', 'mt-1 flex justify-between text-[10px] text-slate-500'); ['00', '06', '12', '18', '23'].forEach((t) => axis.append(el('span', null, t)));
    h.append(wrap, axis);
  }

  /* ---------- donut / pie ---------- */
  function donut(host, slices, centerTop, centerBottom, emptyText) {
    host.replaceChildren();
    const total = slices.reduce((n, x) => n + x.value, 0);
    if (total <= 0) { host.append(el('p', 'grid h-44 place-items-center text-center text-sm text-slate-500', emptyText)); return; }
    const wrap = el('div', 'flex flex-col items-center gap-3 sm:flex-row sm:items-center');
    const R = 15.91549430918954, svg = svgEl('svg', { viewBox: '0 0 42 42', class: 'h-44 w-44 shrink-0', role: 'img', 'aria-label': 'Pie chart' });
    svg.append(svgEl('circle', { cx: 21, cy: 21, r: R, fill: 'none', stroke: '#1e293b', 'stroke-width': 6 }));
    const top = svgEl('text', { x: 21, y: 20.5, 'text-anchor': 'middle', fill: '#fff', 'font-size': 4.4, 'font-weight': 800, style: 'pointer-events:none' }, centerTop);
    const bot = svgEl('text', { x: 21, y: 25.6, 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': 2.7, style: 'pointer-events:none' }, centerBottom);
    const legend = el('div', 'min-w-0 flex-1 space-y-1.5 w-full'), arcs = [];
    let acc = 0;
    slices.forEach((sl, i) => {
      const pct = sl.value / total * 100, arc = svgEl('circle', { cx: 21, cy: 21, r: R, fill: 'none', stroke: sl.color, 'stroke-width': 6, 'stroke-dasharray': '0 100', 'stroke-dashoffset': String(25 - acc), style: 'transition:stroke-dasharray .8s cubic-bezier(.2,.8,.2,1) ' + (i * 0.06) + 's;cursor:pointer' });
      arc.dataset.dash = `${Math.max(pct - (slices.length > 1 ? 0.6 : 0), 0.01)} ${100 - Math.max(pct - (slices.length > 1 ? 0.6 : 0), 0.01)}`;   // thin gap between slices
      acc += pct; arcs.push(arc); svg.append(arc);
      const row = el('div', 'flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-800/60');
      const left = el('span', 'flex min-w-0 items-center gap-2'); const dot = el('i', 'inline-block h-2.5 w-2.5 shrink-0 rounded-full'); dot.style.background = sl.color; left.append(dot, el('span', 'truncate text-slate-200', sl.label));
      row.append(left, el('span', 'shrink-0 text-xs text-slate-400', `${sl.display} · ${Math.round(pct)}%`)); legend.append(row);
      const on = () => { top.textContent = sl.display; bot.textContent = `${sl.label} · ${Math.round(pct)}%`; arc.setAttribute('stroke-width', 7); };
      const off = () => { top.textContent = centerTop; bot.textContent = centerBottom; arc.setAttribute('stroke-width', 6); };
      for (const t of [arc, row]) { t.addEventListener('mouseenter', on); t.addEventListener('mouseleave', off); t.addEventListener('click', on); }
    });
    svg.append(top, bot); wrap.append(svg, legend); host.append(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => arcs.forEach((a) => a.setAttribute('stroke-dasharray', a.dataset.dash))));
  }

  function renderProfit(d) {
    const f = d.finance, r = f.range, box = $('bizProfit'); box.replaceChildren();
    $('bizProfitRange').textContent = `(last ${d.days} days)`;
    const margin = r.revenue > 0 ? Math.round(r.profit / r.revenue * 1000) / 10 : null;
    const col = r.profit < 0 ? 'text-rose-300' : 'text-emerald-300';
    const costBits = [r.fees ? `fees ${kshf(r.fees)}` : null, r.smsCost ? `SMS ${kshf(r.smsCost)}` : null, r.fixed ? `running ${kshf(r.fixed)}` : null, r.oneOff ? `one-off ${kshf(r.oneOff)}` : null].filter(Boolean);
    const c3 = card('Profit', kshf(r.profit), `Today ${kshf(f.today.profit)} · month ${kshf(f.month.profit)}`);
    c3.children[1].className = 'text-xl font-extrabold ' + col;
    box.append(card('Revenue', kshf(r.revenue), `${d.kpis.range.sales} sales`), card('Costs', kshf(r.cost), costBits.length ? costBits.join(' · ') : 'none entered yet'), c3,
      card('Profit margin', margin === null ? '—' : margin + '%', margin === null ? 'no revenue yet' : 'of revenue kept'));
    $('bizProfitHint').textContent = f.configured ? '' : 'Costs are not entered yet, so profit equals revenue. Open "Costs & profit settings" below to add your M-Pesa fee, SMS cost, running cost and expenses.';
  }

  function renderDay(d) {
    const x = d.dayDetail, today = d.daily[d.daily.length - 1].date;
    const p = parts(x.date);
    $('bizDayLabel').textContent = `${p.dow} ${p.day} ${p.mon}` + (x.isToday ? ' (today, so far)' : '') + (x.isFuture ? ' (in the future)' : '');
    $('bizDayDate').value = x.date; $('bizDayDate').max = today; $('bizDayNext').disabled = x.date >= today;
    const sum = $('bizDaySummary'); sum.replaceChildren();
    const cell = (label, value, cls) => { const c = el('div', 'rounded-xl bg-slate-900/70 px-2 py-2'); c.append(el('p', 'text-[10px] font-semibold uppercase tracking-wide text-slate-500', label), el('p', 'text-base font-extrabold ' + (cls || 'text-white'), value)); return c; };
    sum.append(cell('Revenue', kshf(x.revenue)), cell('Costs', kshf(x.costs.total), 'text-amber-300'), cell(x.profit < 0 ? 'Loss' : 'Profit', kshf(x.profit), x.profit < 0 ? 'text-rose-300' : 'text-emerald-300'));

    // pie 1: earnings by package (top 6 + "Other")
    const pk = x.packages.map((q) => ({ label: q.name, value: q.income, display: kshf(q.income) })), shown = pk.slice(0, 6), rest = pk.slice(6);
    if (rest.length) shown.push({ label: 'Other', value: rest.reduce((n, q) => n + q.value, 0), display: kshf(rest.reduce((n, q) => n + q.value, 0)) });
    shown.forEach((q, i) => { q.color = PALETTE[i % PALETTE.length]; });
    donut($('bizPiePkg'), shown, kshf(x.revenue), `${x.sales} sale${x.sales === 1 ? '' : 's'}`, 'No sales on this day.');

    // pie 2: where the revenue goes (profit + each cost). In a loss, show the costs alone.
    const parts2 = [['M-Pesa fees', x.costs.fees, '#fbbf24'], ['SMS', x.costs.sms, '#38bdf8'], ['Running cost', x.costs.fixed, '#a78bfa'], ['One-off expenses', x.costs.oneOff, '#fb7185']].filter((q) => q[1] > 0);
    const slices = parts2.map(([label, value, color]) => ({ label, value, color, display: kshf(value) }));
    if (x.profit > 0) slices.unshift({ label: 'Profit', value: x.profit, color: '#34d399', display: kshf(x.profit) });
    const loss = x.profit < 0;
    donut($('bizPieMoney'), slices, kshf(x.profit), loss ? 'loss' : x.revenue > 0 ? `profit · ${Math.round(x.profit / x.revenue * 100)}% margin` : 'profit', 'No revenue or costs on this day.');
    if (loss) $('bizPieMoney').append(el('p', 'mt-2 text-xs text-amber-300/90', 'Costs are higher than revenue' + (x.isToday ? ' so far today. The running cost is pro-rated through the day, so this usually improves as sales come in.' : ' on this day.')));
  }

  function renderProfitChart(d) {
    const host = $('bizProfitChart'); host.replaceChildren();
    const data = d.daily, W = 720, H = 220, L = 52, R = 8, T = 10, B = 28, pw = W - L - R, ph = H - T - B;
    const vals = data.map((x) => x.profit), maxV = Math.max(0, ...vals), minV = Math.min(0, ...vals), span = (maxV - minV) || 1, step = niceStep(span);
    const lo = Math.floor(minV / step) * step, hi = Math.ceil(maxV / step) * step || step, y = (v) => T + ph - ((v - lo) / ((hi - lo) || 1)) * ph, bw = pw / data.length, y0 = y(0);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-auto', role: 'img', 'aria-label': 'Daily profit bar chart' });
    const defs = svgEl('defs'), pat = svgEl('pattern', { id: 'bizHatch2', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.append(svgEl('rect', { width: 6, height: 6, fill: 'rgba(148,163,184,.15)' }), svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#94a3b8', 'stroke-width': 2 })); defs.append(pat); svg.append(defs);
    for (let v = lo; v <= hi + 1e-9; v += step) svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: v === 0 ? '#475569' : '#1e293b', 'stroke-width': v === 0 ? 1.5 : 1 }), svgEl('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', fill: '#64748b', 'font-size': 10 }, Math.abs(v) >= 1000 ? (v / 1000) + 'k' : String(Math.round(v))));
    const tip = el('div', 'pointer-events-none absolute z-10 hidden rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl');
    const every = data.length <= 14 ? 1 : data.length <= 31 ? 3 : data.length <= 60 ? 7 : 14;
    data.forEach((x, i) => {
      const bx = L + i * bw, yy = y(x.profit), neg = x.profit < 0, h = Math.max(x.profit !== 0 ? 2 : 0, Math.abs(yy - y0));
      svg.append(svgEl('rect', { x: bx + bw * 0.14, y: neg ? y0 : y0 - h, width: Math.max(1, bw * 0.72), height: h, rx: Math.min(3, bw * 0.2), fill: x.partial ? 'url(#bizHatch2)' : neg ? '#fb7185' : '#34d399', stroke: x.partial ? (neg ? '#fb7185' : '#34d399') : 'none', 'stroke-dasharray': x.partial ? '3 2' : '' }));
      if (i % every === 0 || i === data.length - 1) { const q = parts(x.date); svg.append(svgEl('text', { x: bx + bw / 2, y: H - 10, 'text-anchor': 'middle', fill: '#64748b', 'font-size': 10 }, data.length <= 14 ? `${q.dow} ${q.day}` : `${q.day} ${q.mon}`)); }
      const hit = svgEl('rect', { x: bx, y: T, width: bw, height: ph, fill: 'transparent', style: 'cursor:pointer' });
      const show = () => {
        tip.replaceChildren(el('p', 'font-semibold text-white', longDate(x.date) + (x.partial ? ' (today, so far)' : '')), el('p', neg ? 'text-rose-300' : 'text-emerald-300', (neg ? 'Loss ' : 'Profit ') + kshf(Math.abs(x.profit))), el('p', 'text-slate-400', `Revenue ${kshf(x.income)} · costs ${kshf(x.cost)}`));
        tip.classList.remove('hidden'); const r = host.getBoundingClientRect(), xp = (bx + bw / 2) / W; tip.style.left = Math.min(Math.max(8, xp * r.width - 70), r.width - 170) + 'px'; tip.style.top = '4px';
      };
      hit.addEventListener('mouseenter', show); hit.addEventListener('click', show); hit.addEventListener('mouseleave', () => tip.classList.add('hidden')); svg.append(hit);
    });
    host.append(svg, tip);
  }

  /* ---------- costs & expenses ---------- */
  const finSay = (t, ok) => { const m = $('finMsg'); m.textContent = t; m.className = 'text-xs min-h-[1rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400'); };
  function renderCosts(d) {
    const st = d.finance.settings;
    if (!costsDirty) { $('finFee').value = st.mpesaFeePct || ''; $('finSms').value = st.smsUnitCostKsh || ''; $('finDaily').value = st.dailyCostKsh || ''; }
    if (!$('expDate').value) $('expDate').value = d.daily[d.daily.length - 1].date;
    const list = $('expList'); list.replaceChildren();
    if (!st.expenses.length) list.append(el('p', 'text-xs text-slate-500', 'No one-off expenses recorded.'));
    for (const x of st.expenses) {
      const row = el('div', 'flex items-center justify-between gap-2 rounded-lg bg-slate-900/70 px-3 py-1.5 text-sm'), p = parts(x.date);
      const del = el('button', 'shrink-0 rounded-md bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-200', 'Delete');
      del.onclick = async () => { try { await api('/finance/expense/' + encodeURIComponent(x.id), { method: 'DELETE' }); load(); } catch (e) { finSay(e.message, false); } };
      row.append(el('span', 'min-w-0 truncate text-slate-300', `${p.day} ${p.mon} · ${x.label}`), el('span', 'ml-auto shrink-0 text-slate-400', kshf(x.amountKsh)), del); list.append(row);
    }
  }
  for (const id of ['finFee', 'finSms', 'finDaily']) $(id).addEventListener('input', () => { costsDirty = true; });
  $('finSave').onclick = async () => {
    try { await api('/finance', { method: 'POST', body: { mpesaFeePct: $('finFee').value || 0, smsUnitCostKsh: $('finSms').value || 0, dailyCostKsh: $('finDaily').value || 0 } }); costsDirty = false; finSay('Saved. Profit figures updated.', true); load(); }
    catch (e) { finSay(e.message, false); }
  };
  $('expAdd').onclick = async () => {
    try { await api('/finance/expense', { method: 'POST', body: { date: $('expDate').value, label: $('expLabel').value, amountKsh: $('expAmount').value } }); $('expLabel').value = ''; $('expAmount').value = ''; finSay('Expense added.', true); load(); }
    catch (e) { finSay(e.message, false); }
  };

  /* ---------- day navigation ---------- */
  const goDay = (key) => { selDate = key; load(); };
  $('bizDayPrev').onclick = () => goDay(addDays($('bizDayDate').value || lastData.dayDetail.date, -1));
  $('bizDayNext').onclick = () => goDay(addDays($('bizDayDate').value, 1));
  $('bizDayToday').onclick = () => goDay(null);
  $('bizDayDate').onchange = (e) => { if (e.target.value) goDay(e.target.value); };

  async function load() {
    try {
      const d = await api(`/income?days=${days}&manual=${$('bizManual').checked ? 1 : 0}${selDate ? '&date=' + selDate : ''}`);
      lastData = d; renderTrend(d); renderKpis(d); renderProfit(d); renderDay(d); renderChart(d); renderProfitChart(d); renderWeeks(d); renderMix(d); renderCosts(d);
    } catch (e) { $('bizTrend').textContent = e.message || 'Could not load income.'; }
  }
  function markRange() { for (const b of $('bizRange').children) { const on = +b.dataset.days === days; b.className = 'px-3 py-1.5 ' + (on ? 'bg-emerald-400 text-slate-950' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'); } }
  for (const b of $('bizRange').children) b.onclick = () => { days = +b.dataset.days; markRange(); load(); };
  $('bizRefresh').onclick = load; $('bizManual').onchange = load; markRange();

  /* ---------- reconnect mode ---------- */
  const rcSay = (t, ok) => { const m = $('rcMsg'); m.textContent = t; m.className = 'text-xs min-h-[1rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400'); };
  function rcDraw(d) {
    $('rcMode').value = d.phones;
    const eff = { sms: 'phones confirm with an SMS code', number: 'phones reconnect with the number only', off: 'phones must use the voucher code' }[d.effective];
    $('rcState').textContent = d.effective === 'sms' ? 'SMS code' : d.effective === 'number' ? 'number only' : 'off';
    $('rcState').className = 'ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ' + (d.effective === 'sms' ? 'bg-emerald-500/20 text-emerald-300' : d.effective === 'number' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300');
    $('rcInfo').textContent = `Right now: ${eff}.` + (d.phones === 'sms' && !d.smsConfigured ? ' SMS is not set up, so phones cannot reconnect this way until you save your Olympus token below.' : d.phones === 'auto' && !d.smsConfigured ? ' Set up SMS messaging to turn on code verification.' : '') + ' Each code SMS uses one SMS unit.';
  }
  async function rcLoad() { try { rcDraw(await api('/reconnect')); } catch (e) { rcSay(e.message, false); } }
  $('rcSave').onclick = async () => {
    try { await api('/reconnect', { method: 'POST', body: { phones: $('rcMode').value } }); await rcLoad(); rcSay('Saved.', true); } catch (e) { rcSay(e.message, false); }
  };

  const boot = () => { load(); rcLoad(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(); }, 60000); };
  A.onStart.push(boot); A.onLock.push(() => clearInterval(timer));
  if (!$('app').classList.contains('hidden')) boot();
})();
