// Notification bell for the admin dashboard. Plugs into admin.js through window.SynthAdmin.
//   - the bell RINGS (swing + pulse + glow) while there are notifications you have not seen (opened the panel for)
//   - the badge shows how many are UNREAD; items turn read when you click them or press "Mark all read"
(() => {
  const A = window.SynthAdmin; if (!A) return;
  const { api, $, el, toast } = A;
  const BASE_TITLE = document.title;
  const LEVEL = { info: { dot: 'bg-cyan-400', bar: 'border-cyan-400/60', txt: 'text-cyan-300' }, success: { dot: 'bg-emerald-400', bar: 'border-emerald-400/70', txt: 'text-emerald-300' },
    warning: { dot: 'bg-amber-400', bar: 'border-amber-400/70', txt: 'text-amber-300' }, critical: { dot: 'bg-rose-400', bar: 'border-rose-400/80', txt: 'text-rose-300' } };
  const GOTO = { payments: 'paymentsSection', customers: 'clientsSection', outage: 'outageSection', sms: 'smsSection', security: 'secSection', admin: null, system: null };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

  let items = [], counts = { unread: 0, unseen: 0, latestRev: 0, topLevel: 'info', byCategory: {} }, cats = [], muted = [], timer = null;
  let open = false, view = { category: null, unread: false }, hasMore = false, booted = false, lastRev = 0;
  let soundOn = store('synthnet:bellSound') !== '0', desktopOn = store('synthnet:bellDesktop') === '1';

  /* ---------- time (Nairobi, UTC+3, no DST) ---------- */
  const eatParts = (ms) => { const d = new Date(ms + 3 * 3600e3); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const clock = (ms) => { const p = eatParts(ms); return `${p.h % 12 || 12}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`; };
  const absolute = (ms) => { const p = eatParts(ms); return `${p.d} ${MON[p.mo]} ${p.y}, ${clock(ms)} EAT`; };
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 6 * 3600) return Math.round(s / 3600) + ' h ago';
    const a = eatParts(ms), n = eatParts(Date.now()), same = a.d === n.d && a.mo === n.mo && a.y === n.y;
    if (same) return 'Today ' + clock(ms);
    const y = eatParts(Date.now() - 864e5); if (a.d === y.d && a.mo === y.mo && a.y === y.y) return 'Yesterday ' + clock(ms);
    return `${a.d} ${MON[a.mo]}, ${clock(ms)}`;
  }

  /* ---------- sound (generated, no files) ---------- */
  let ctx = null;
  const audio = () => { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); } return ctx; };
  document.addEventListener('click', () => { const c = audio(); if (c && c.state === 'suspended') c.resume(); }, { once: false, passive: true });
  function tone(freq, start, dur, vol) {
    const c = audio(); if (!c || c.state !== 'running') return;
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, c.currentTime + start); g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g); g.connect(c.destination); o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
  }
  function chime(level) {
    if (!soundOn) return;
    try {
      if (level === 'success') { tone(659, 0, 0.18, 0.12); tone(880, 0.15, 0.32, 0.12); }              // money: bright two-note chime
      else if (level === 'critical' || level === 'warning') { tone(392, 0, 0.16, 0.14); tone(330, 0.2, 0.28, 0.14); }   // attention: lower two-note
      else tone(740, 0, 0.18, 0.08);
    } catch { /* audio is a nicety */ }
  }

  /* ---------- bell state ---------- */
  function paintBell() {
    const bell = $('bellBtn'), badge = $('bellBadge');
    bell.classList.toggle('has-unread', counts.unread > 0); bell.classList.toggle('ringing', counts.unseen > 0 && !open);
    for (const l of ['success', 'warning', 'critical']) bell.classList.toggle('lvl-' + l, counts.unread > 0 && counts.topLevel === l);
    badge.classList.toggle('hidden', counts.unread === 0); badge.textContent = counts.unread > 99 ? '99+' : String(counts.unread);
    bell.setAttribute('aria-label', counts.unread ? `Notifications, ${counts.unread} unread` : 'Notifications');
    $('bellCount').textContent = counts.unread ? `${counts.unread} unread` : 'All read';
    document.title = counts.unread ? `(${counts.unread > 99 ? '99+' : counts.unread}) ${BASE_TITLE}` : BASE_TITLE;
  }

  /* ---------- list ---------- */
  const passes = (x) => (!view.category || x.category === view.category) && (!view.unread || !x.read);
  function row(x) {
    const lv = LEVEL[x.level] || LEVEL.info, cat = cats.find((c) => c.id === x.category) || { icon: '•', label: x.category };
    const r = el('div', `n-item relative flex cursor-pointer gap-3 border-l-4 px-4 py-3 hover:bg-slate-800/50 ${lv.bar} ${x.read ? 'opacity-70' : 'bg-slate-800/30'}`);
    r.dataset.id = x.id; r.setAttribute('role', 'button'); r.tabIndex = 0;
    r.append(el('div', 'mt-0.5 text-lg leading-none', cat.icon));
    const body = el('div', 'min-w-0 flex-1');
    const head = el('div', 'flex items-start justify-between gap-2');
    const title = el('p', `text-sm leading-snug ${x.read ? 'font-medium text-slate-300' : 'font-bold text-white'}`, x.title);
    if (x.count > 1) title.append(el('span', 'ml-1.5 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-200', '×' + x.count));
    head.append(title, el('span', 'shrink-0 text-[11px] text-slate-500', ago(x.ts))); head.lastChild.title = absolute(x.ts);
    body.append(head);
    if (x.message) body.append(el('p', 'mt-0.5 break-words text-xs text-slate-400', x.message));
    const foot = el('div', 'mt-1.5 flex items-center gap-3 text-[11px]');
    foot.append(el('span', lv.txt, cat.label));
    const target = GOTO[x.category];
    if (target && document.getElementById(target)) {
      const go = el('button', 'text-cyan-300 underline', 'Go to section'); go.type = 'button';
      go.onclick = (e) => { e.stopPropagation(); readOne(x.id); closePanel(); const t = document.getElementById(target); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); t.animate([{ boxShadow: '0 0 0 3px rgba(34,211,238,.8)' }, { boxShadow: '0 0 0 0 rgba(34,211,238,0)' }], { duration: 1600 }); };
      foot.append(go);
    }
    body.append(foot); r.append(body);
    if (!x.read) r.append(el('span', `absolute right-3 top-9 h-2 w-2 rounded-full ${lv.dot}`));
    const act = () => readOne(x.id);
    r.addEventListener('click', act); r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    return r;
  }
  function paintList() {
    const box = $('bellList'), shown = items.filter(passes).sort((a, b) => b.rev - a.rev);
    box.replaceChildren(...shown.map(row));
    if (!shown.length) box.append(el('div', 'grid h-40 place-items-center px-6 text-center text-sm text-slate-500', view.unread ? 'You are all caught up. Nothing unread.' : view.category ? 'Nothing recorded in this category yet.' : 'No activity yet. Payments, customers, outages and changes will appear here.'));
    if (hasMore) { const more = el('button', 'block w-full py-3 text-xs font-semibold text-cyan-300 hover:bg-slate-800/50', 'Load older'); more.onclick = loadOlder; box.append(more); }
  }
  function paintFilters() {
    const box = $('bellFilters'); box.replaceChildren();
    const chip = (label, active, onclick, badge) => {
      const b = el('button', `shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 font-semibold ${active ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`, label); b.type = 'button';
      if (badge) b.append(el('span', 'ml-1 rounded-full bg-cyan-400 px-1.5 text-[10px] font-extrabold text-slate-950', String(badge)));
      b.onclick = onclick; return b;
    };
    box.append(chip('All', !view.category && !view.unread, () => setView({ category: null, unread: false })), chip('Unread', view.unread, () => setView({ category: view.category, unread: !view.unread }), counts.unread || 0));
    for (const c of cats) box.append(chip(`${c.icon} ${c.label}`, view.category === c.id, () => setView({ category: view.category === c.id ? null : c.id, unread: view.unread }), counts.byCategory[c.id] || 0));
  }
  function paintMutes() {
    const box = $('bellMutes'); box.replaceChildren();
    for (const c of cats) {
      const l = el('label', 'flex items-center gap-1.5'), cb = el('input'); cb.type = 'checkbox'; cb.className = 'accent-cyan-400'; cb.checked = !muted.includes(c.id);
      cb.onchange = async () => { const next = cb.checked ? muted.filter((m) => m !== c.id) : [...muted, c.id]; try { const d = await api('/notifications/prefs', { method: 'POST', body: { muted: next } }); muted = d.prefs.muted; } catch (e) { toast(e.message); cb.checked = !cb.checked; } };
      l.append(cb, `${c.icon} ${c.label}`); box.append(l);
    }
  }
  function paintAll() { paintBell(); if (open) { paintFilters(); paintList(); } }

  /* ---------- data ---------- */
  function merge(list) { for (const n of list) { const i = items.findIndex((x) => x.id === n.id); if (i >= 0) items[i] = n; else items.push(n); } items.sort((a, b) => b.rev - a.rev); if (items.length > 400) items.length = 400; }
  async function fetchView() {
    const q = new URLSearchParams({ limit: '50' }); if (view.category) q.set('category', view.category); if (view.unread) q.set('unread', '1');
    const d = await api('/notifications?' + q);
    cats = d.categories; muted = d.prefs.muted; counts = d.counts; hasMore = d.hasMore; items = d.items; lastRev = Math.max(lastRev, counts.latestRev);
  }
  async function loadOlder() {
    const oldest = items.filter(passes).reduce((m, x) => Math.min(m, x.rev), Infinity); if (!isFinite(oldest)) return;
    const q = new URLSearchParams({ limit: '50', before: String(oldest) }); if (view.category) q.set('category', view.category); if (view.unread) q.set('unread', '1');
    try { const d = await api('/notifications?' + q); hasMore = d.hasMore; merge(d.items); paintList(); } catch (e) { toast(e.message); }
  }
  async function setView(v) { view = v; try { await fetchView(); } catch (e) { toast(e.message); } paintAll(); }

  async function readOne(id) {
    const x = items.find((i) => i.id === id); if (!x || x.read) return;
    x.read = true; counts.unread = Math.max(0, counts.unread - 1); counts.byCategory[x.category] = Math.max(0, (counts.byCategory[x.category] || 1) - 1); paintAll();
    try { const d = await api('/notifications/read', { method: 'POST', body: { ids: [id] } }); counts = d.counts; paintAll(); } catch (e) { x.read = false; toast(e.message); poll(); }
  }
  $('bellReadAll').onclick = async () => {
    try { const d = await api('/notifications/read', { method: 'POST', body: { all: true, category: view.category || undefined } }); counts = d.counts; for (const x of items) if (!view.category || x.category === view.category) x.read = true; paintAll(); }
    catch (e) { toast(e.message); }
  };
  const clearIt = async (scope) => {
    if (scope === 'all' && !confirm('Delete ALL recorded activity? This cannot be undone.')) return;
    try { const d = await api('/notifications/clear', { method: 'POST', body: { scope } }); counts = d.counts; await fetchView(); paintAll(); toast(`${d.removed} item${d.removed === 1 ? '' : 's'} cleared`); } catch (e) { toast(e.message); }
  };
  $('bellClearRead').onclick = () => clearIt('read'); $('bellClearAll').onclick = () => clearIt('all');

  /* ---------- polling, toasts, desktop alerts ---------- */
  function showToast(x) {
    const box = $('bellToasts'), lv = LEVEL[x.level] || LEVEL.info;
    while (box.children.length >= 3) box.firstChild.remove();
    const t = el('button', `n-toast pointer-events-auto flex w-full gap-3 rounded-xl border-l-4 bg-slate-900/95 px-3 py-2.5 text-left shadow-xl shadow-black/50 ring-1 ring-slate-700 ${lv.bar}`); t.type = 'button';
    const cat = cats.find((c) => c.id === x.category);
    t.append(el('span', 'text-lg leading-none', cat ? cat.icon : '🔔'));
    const b = el('span', 'min-w-0'); b.append(el('span', 'block text-sm font-bold text-white', x.title)); if (x.message) b.append(el('span', 'mt-0.5 block truncate text-xs text-slate-400', x.message)); t.append(b);
    t.onclick = () => { t.remove(); openPanel(); };
    box.append(t); setTimeout(() => t.remove(), 7000);
  }
  function desktopAlert(x) {
    if (!desktopOn || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { const n = new Notification(x.title, { body: x.message || '', tag: 'synthnet-' + x.id, silent: true }); n.onclick = () => { window.focus(); openPanel(); n.close(); }; } catch { /* some shells block it */ }
  }
  async function poll() {
    try {
      const d = await api('/notifications/poll?since=' + lastRev);
      const fresh = d.items.filter((x) => !x.read && x.rev > lastRev);
      counts = d.counts; if (d.items.length) merge(d.items.filter(passes));
      lastRev = Math.max(lastRev, counts.latestRev);
      if (booted && fresh.length) {
        const top = fresh.reduce((t, x) => (['info', 'success', 'warning', 'critical'].indexOf(x.level) > ['info', 'success', 'warning', 'critical'].indexOf(t) ? x.level : t), 'info');
        chime(top); fresh.slice(0, 3).forEach((x) => { if (!open) showToast(x); desktopAlert(x); });
        if (fresh.length > 3 && !open) showToast({ level: 'info', category: 'system', title: `${fresh.length - 3} more new notifications`, message: 'Open the bell to see them all.' });
        if (open) { api('/notifications/seen', { method: 'POST' }).then((r) => { counts = r.counts; paintBell(); }).catch(() => {}); }
      }
      paintAll();
    } catch { /* offline or locked: try again next tick */ }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(async () => { await poll(); schedule(); }, document.hidden ? 20000 : 4000); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && booted) { poll(); } });

  /* ---------- open / close ---------- */
  async function openPanel() {
    open = true; $('bellPanel').classList.remove('hidden'); $('bellBtn').setAttribute('aria-expanded', 'true'); paintBell();
    try { await fetchView(); } catch (e) { toast(e.message); }
    paintMutes(); paintAll(); $('bellPanel').focus();
    try { const d = await api('/notifications/seen', { method: 'POST' }); counts = d.counts; paintBell(); } catch { /* the bell will calm down on the next poll */ }
  }
  function closePanel() { open = false; $('bellPanel').classList.add('hidden'); $('bellBtn').setAttribute('aria-expanded', 'false'); paintBell(); }
  $('bellBtn').onclick = (e) => { e.stopPropagation(); open ? closePanel() : openPanel(); };
  $('bellClose').onclick = closePanel;
  $('bellPanel').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { if (open) closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { closePanel(); $('bellBtn').focus(); } });
  $('bellGear').onclick = () => $('bellSettings').classList.toggle('hidden');

  $('bellSound').checked = soundOn;
  $('bellSound').onchange = (e) => { soundOn = e.target.checked; store('synthnet:bellSound', soundOn ? '1' : '0'); if (soundOn) { const c = audio(); if (c && c.state === 'suspended') c.resume(); setTimeout(() => chime('success'), 150); } };
  $('bellDesktop').checked = desktopOn && 'Notification' in window && Notification.permission === 'granted';
  $('bellDesktop').onchange = async (e) => {
    if (!e.target.checked) { desktopOn = false; store('synthnet:bellDesktop', '0'); return; }
    if (!('Notification' in window)) { e.target.checked = false; return toast('This window cannot show desktop alerts.'); }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    desktopOn = perm === 'granted'; e.target.checked = desktopOn; store('synthnet:bellDesktop', desktopOn ? '1' : '0');
    if (!desktopOn) toast('Desktop alerts were blocked in the browser settings.');
  };

  /* ---------- lifecycle ---------- */
  const boot = async () => {
    booted = false; items = []; lastRev = 0;
    try { await fetchView(); } catch { return; }
    paintAll(); booted = true; schedule();
  };
  A.onStart.push(boot);
  A.onLock.push(() => { clearTimeout(timer); closePanel(); booted = false; document.title = BASE_TITLE; $('bellToasts').replaceChildren(); });
  if (!$('app').classList.contains('hidden')) boot();
  window.SynthAdmin.notifications = { refresh: poll, open: openPanel };
})();
