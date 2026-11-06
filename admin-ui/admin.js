(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  (() => { const m = /[#&]t=([^&]+)/.exec(location.hash); if (m) { sessionStorage.setItem('synthnetAdmin', decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); } })();
  let token = sessionStorage.getItem('synthnetAdmin') || '';
  let timers = [];

  async function api(path, opts = {}) {
    const r = await fetch('/api/admin' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const response = await r.text();
    let d;
    try { d = response ? JSON.parse(response) : {}; }
    catch { d = { error: response }; }
    if (r.status === 401) { lock(d.error); throw new Error(d.error || 'Unauthorized'); }
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }

  const SynthAdmin = window.SynthAdmin = { api: (...a) => api(...a), $, el, badge: (...a) => badge(...a), toast: (m) => toast(m), say: (...a) => say2(...a), onStart: [], onLock: [] };
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 4000); }
  function lock(msg) {
    token = ''; sessionStorage.removeItem('synthnetAdmin'); timers.forEach(clearInterval); timers = [];
    SynthAdmin.onLock.forEach((fn) => { try { fn(); } catch {} });
    $('app').classList.add('hidden'); $('gate').classList.remove('hidden'); $('gateMsg').textContent = msg || '';
  }
  const dur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + h + 'h ' + m + 'm'; };
  const badge = (text, color) => el('span', `rounded-full px-2 py-0.5 text-xs font-semibold ${color}`, text);

  /* ---------- Clients ---------- */
  async function loadClients() {
    const { clients, now, gate, outage } = await api('/clients');
    showGate(gate);
    showOutage(outage);
    const body = $('clients'); body.replaceChildren();
    $('noClients').classList.toggle('hidden', clients.length > 0);
    $('statAuth').textContent = clients.filter((c) => c.authenticated).length;
    $('statSeen').textContent = clients.filter((c) => !c.authenticated).length;
    clients.forEach((c) => {
      const tr = el('tr', 'border-t border-slate-800');
      const ipCell = el('td', 'py-2 pr-3 font-mono', c.ip);
      if (c.tv) { const t = el('span', 'ml-2 rounded bg-violet-500/20 px-1.5 py-0.5 font-sans text-[10px] font-bold text-violet-200', '📺 ' + (c.label || 'TV')); t.title = 'Connected by MAC address (no sign-in page needed)'; ipCell.append(t); }
      tr.append(ipCell, el('td', 'pr-3 font-mono text-xs text-slate-400', c.mac || '–'));
      const st = el('td', 'pr-3'); st.append(c.authenticated ? badge('Authenticated', 'bg-emerald-500/20 text-emerald-300') : badge('Not logged in', 'bg-amber-500/20 text-amber-300'));
      tr.append(st, el('td', 'pr-3 font-mono text-xs', c.code || '–'), el('td', 'pr-3', c.authenticated ? dur(c.expiresAt - now) : '–'));
      const act = el('td', 'py-1 text-right whitespace-nowrap');
      if (c.authenticated) {
        const a = el('button', 'rounded-lg bg-slate-700 px-2 py-1 text-xs mr-1', 'Revoke');
        const b = el('button', 'rounded-lg bg-rose-600 px-2 py-1 text-xs', 'Revoke + ban code');
        a.onclick = () => revoke(c.ip, false); b.onclick = () => { if (confirm(`Permanently disable ${c.code}?`)) revoke(c.ip, true); };
        act.append(a, b);
      } else {
        const award = el('button', 'rounded-lg bg-amber-400 text-slate-950 px-2 py-1 text-xs font-semibold', 'Award');
        award.onclick = () => {
          $('awardTarget').value = c.ip;
          $('awardType').value = 'mobile';
          document.querySelector('#awardTarget').closest('section').scrollIntoView({ behavior: 'smooth', block: 'center' });
          $('awardTarget').focus();
        };
        act.append(award);
      }
      tr.append(act); body.append(tr);
    });
  }
  function showOutage(outage) {
    if (!outage) return;
    const active = !!outage.active;
    $('outageState').textContent = active
      ? `Outage in progress since ${new Date(outage.startedAt).toLocaleString()}. Active package timers are paused.`
      : 'No outage is currently being tracked.';
    $('outageStartBtn').classList.toggle('hidden', active);
    $('outageResolveBtn').classList.toggle('hidden', !active);
  }
  async function setOutage(action) {
    const prompt = action === 'start'
      ? 'Record the start of a service outage? Active package timers will be paused.'
      : 'Mark service restored? The affected packages will be credited for the outage time.';
    if (!confirm(prompt)) return;
    const button = action === 'start' ? $('outageStartBtn') : $('outageResolveBtn');
    button.disabled = true; $('outageMsg').textContent = 'Updating outage status…';
    try {
      const d = await api('/outage', { method: 'POST', body: { action, notify: $('outageSms').checked } });
      showOutage(d);
      const smsNote = d.sms && d.sms.queued ? ` SMS queued for ${d.sms.queued} customer(s).` : '';
      $('outageMsg').textContent = (action === 'resolve'
        ? `Restored. ${dur(d.durationMs)} credited across ${d.packagesCredited} package(s).`
        : 'Outage recorded. Active package clocks are paused.') + smsNote;
      await loadClients(); await loadVouchers();
    } catch (e) {
      $('outageMsg').textContent = e.message;
    } finally {
      button.disabled = false;
    }
  }
  $('outageStartBtn').onclick = () => setOutage('start');
  $('outageResolveBtn').onclick = () => setOutage('resolve');
  async function revoke(ip, banVoucher) {
    try { await api('/revoke', { method: 'POST', body: { ip, banVoucher } }); toast(`Revoked ${ip}`); loadClients(); loadVouchers(); }
    catch (e) { toast(e.message); }
  }

  /* ---------- Vouchers ---------- */
  async function loadTiers() {
    const c = await (await fetch('/api/config')).json();
    const opts = () => c.tiers.map((t) => { const o = el('option', null, `${t.name} – KSH ${t.priceKsh}`); o.value = t.id; return o; });
    $('vTier').replaceChildren(...opts());
    $('awardTier').replaceChildren(...opts());
  }
  async function loadVouchers() {
    const { vouchers } = await api('/vouchers');
    const colors = { unused: 'bg-sky-500/20 text-sky-300', active: 'bg-emerald-500/20 text-emerald-300', expired: 'bg-slate-600/40 text-slate-300', disabled: 'bg-rose-500/20 text-rose-300' };
    const devLabel = { mobile: 'Phone', other: 'TV/laptop', primary: 'Existing device' };
    $('vList').replaceChildren(...vouchers.map((v) => {
      const tr = el('tr', 'border-t border-slate-800');
      tr.title = [v.phone && `Phone: ${v.phone}`, v.note && `Note: ${v.note}`].filter(Boolean).join(' | ');
      const st = el('td', 'pr-3'); st.append(badge(v.status, colors[v.status] || ''));
      if (v.awarded) st.append(' ', badge('awarded', 'bg-amber-500/20 text-amber-300'));
      const codeCell = el('td', 'py-1.5 pr-3 font-mono text-xs', v.code);
      tr.append(codeCell, el('td', 'pr-3', v.tier || '–'), st,
        el('td', 'pr-3 text-xs text-slate-400', v.devices && v.devices.length ? v.devices.map((d) => devLabel[d] || d).join(' + ') : '–'),
        el('td', 'text-xs text-slate-400', v.expiresAt ? new Date(v.expiresAt).toLocaleString() : '–'));
      return tr;
    }));
  }
  $('vBtn').onclick = async () => {
    $('vBtn').disabled = true;
    try {
      const d = await api('/vouchers', { method: 'POST', body: { tier: $('vTier').value, count: +$('vCount').value, phone: $('vPhone').value.trim() } });
      $('vText').value = d.codes.join('\n'); $('vOut').classList.remove('hidden'); toast(`Saved ${d.codes.length} voucher(s)` + (d.smsQueued ? ' and queued the SMS' : '')); if (d.smsQueued) $('vPhone').value = ''; loadVouchers();
    } catch (e) { toast(e.message); } finally { $('vBtn').disabled = false; }
  };
  $('vCopy').onclick = async () => { try { await navigator.clipboard.writeText($('vText').value); toast('Copied'); } catch { $('vText').select(); toast('Press Ctrl+C to copy'); } };

  $('awardBtn').onclick = async () => {
    const target = $('awardTarget').value.trim();
    if (!target) return say2('awardMsg', 'Enter a device IP or phone number.', false);
    $('awardBtn').disabled = true; say2('awardMsg', 'Awarding…', true);
    try {
      const d = await api('/award', { method: 'POST', body: { tier: $('awardTier').value, target, deviceType: $('awardType').value, note: $('awardNote').value.trim() } });
      say2('awardMsg', d.activated ? `Awarded and activated now: ${d.code}` : d.smsQueued ? `Awarded: ${d.code} — the code was sent to them by SMS.` : `Awarded: ${d.code} — share the code with a phone; a laptop/TV companion can use Reconnect with the M-Pesa number.`, true);
      $('awardTarget').value = ''; $('awardNote').value = ''; loadVouchers(); loadClients();
    } catch (e) { say2('awardMsg', e.message, false); } finally { $('awardBtn').disabled = false; }
  };
  function say2(id, text, ok) { const m = $(id); m.textContent = text; m.className = 'text-sm min-h-[1.25rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400'); }

  /* ---------- Hotspot ---------- */
  function showHotspot(d, fill) {
    $('hState').textContent = d.state || 'unknown'; $('hSsid').textContent = d.ssid || '–';
    $('hClients').textContent = d.clients ?? '–'; $('statHot').textContent = d.state || '?';
    $('hMsg').textContent = d.ok ? (d.message === 'ok' ? '' : d.message) : '⚠ ' + d.message;
    if (fill && d.defaults) { $('hSsidIn').value = d.defaults.ssid; $('hPassIn').value = d.defaults.password; }
  }
  async function loadHotspot(fill) { try { showHotspot(await api('/hotspot'), fill); } catch (e) { $('hMsg').textContent = e.message; } }
  document.querySelectorAll('[data-hs]').forEach((b) => b.onclick = async () => {
    $('hMsg').textContent = 'Working… (can take ~10 seconds)';
    document.querySelectorAll('[data-hs]').forEach((x) => x.disabled = true);
    try { showHotspot(await api('/hotspot', { method: 'POST', body: { action: b.dataset.hs, ssid: $('hSsidIn').value.trim(), password: $('hPassIn').value } })); }
    catch (e) { $('hMsg').textContent = '⚠ ' + e.message; }
    finally { document.querySelectorAll('[data-hs]').forEach((x) => x.disabled = false); }
  });

  /* ---------- Gate + payments ---------- */
  function showGate(g) {
    const s = $('statGate'), r = $('gateReason');
    if (!g) return;
    s.textContent = g.active ? 'ON' : 'OFF';
    s.className = 'text-2xl font-extrabold ' + (g.active ? 'text-emerald-400' : 'text-rose-400');
    if (g.active) r.classList.add('hidden');
    else { r.textContent = 'Internet gate is OFF: unpaid devices can browse freely. ' + (g.reason || ''); r.classList.remove('hidden'); }
  }
  async function loadPayments() {
    const { enabled, payments } = await api('/payments');
    $('payState').textContent = enabled ? '(Courtney Tech STK enabled)' : '(not configured: portal shows manual instructions)';
    const colors = { success: 'bg-emerald-500/20 text-emerald-300', pending: 'bg-amber-500/20 text-amber-300', failed: 'bg-rose-500/20 text-rose-300', timeout: 'bg-slate-600/40 text-slate-300' };
    $('payList').replaceChildren(...payments.map((p) => {
      const tr = el('tr', 'border-t border-slate-800'); tr.title = [p.ref, p.receipt, p.message].filter(Boolean).join(' | '); const st = el('td'); st.append(badge(p.status, colors[p.status] || 'bg-slate-600/40 text-slate-300'));
      tr.append(el('td', 'py-1.5 pr-3 text-xs text-slate-400', new Date(p.createdAt).toLocaleString()), el('td', 'pr-3 font-mono text-xs', p.phone), el('td', 'pr-3', p.tier), el('td', 'pr-3', String(p.amount)), st);
      return tr;
    }));
  }

  /* ---------- Portal content & prices ---------- */
  function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }

  function tierRow(t) {
    const row = el('div', 'grid grid-cols-6 gap-1.5 items-center');
    const idIn = el('input', 'col-span-1 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs font-mono');
    idIn.value = t.id || ''; idIn.placeholder = 'id';
    if (t.id) { idIn.readOnly = true; idIn.className += ' opacity-60'; }
    const nameIn = el('input', 'col-span-2 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs'); nameIn.value = t.name || ''; nameIn.placeholder = 'Name';
    const priceIn = el('input', 'rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs'); priceIn.type = 'number'; priceIn.value = t.priceKsh ?? ''; priceIn.placeholder = 'KSh';
    const minsIn = el('input', 'rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs'); minsIn.type = 'number'; minsIn.value = t.minutes ?? ''; minsIn.placeholder = 'Minutes';
    const delBtn = el('button', 'rounded-lg bg-rose-600/80 text-xs py-1.5', '✕'); delBtn.onclick = () => row.remove();
    row.append(idIn, nameIn, priceIn, minsIn, delBtn);
    const row2 = el('div', 'grid grid-cols-6 gap-1.5 items-center -mt-1');
    const noteIn = el('input', 'col-span-4 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs'); noteIn.value = t.note || ''; noteIn.placeholder = 'Note (e.g. "Unlimited data")';
    const badgeIn = el('input', 'col-span-2 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs'); badgeIn.value = t.badge || ''; badgeIn.placeholder = 'Badge (e.g. "Standard")';
    row2.append(noteIn, badgeIn);
    row._get = () => ({ id: idIn.value.trim(), name: nameIn.value.trim(), priceKsh: +priceIn.value, minutes: +minsIn.value, note: noteIn.value.trim(), badge: badgeIn.value.trim() });
    const wrap = el('div', 'space-y-1 pb-2 border-b border-slate-800/60'); wrap.append(row, row2); wrap._get = row._get; wrap._del = delBtn;
    delBtn.onclick = () => wrap.remove();
    return wrap;
  }
  $('tierAddBtn').onclick = () => $('tierRows').append(tierRow({}));
  $('tiersSaveBtn').onclick = async () => {
    const tiers = [...$('tierRows').children].map((r) => r._get());
    $('tiersSaveBtn').disabled = true;
    try { await api('/portal', { method: 'POST', body: { tiers } }); say2('tiersMsg', 'Saved.', true); loadTiers(); }
    catch (e) { say2('tiersMsg', e.message, false); } finally { $('tiersSaveBtn').disabled = false; }
  };

  $('brandSaveBtn').onclick = async () => {
    try { await api('/portal', { method: 'POST', body: { brand: { name: $('brandName').value.trim(), tagline: $('brandTagline').value.trim() } } }); say2('brandMsg', 'Saved.', true); }
    catch (e) { say2('brandMsg', e.message, false); }
  };
  $('paySaveBtn').onclick = async () => {
    try {
      await api('/portal', { method: 'POST', body: { payment: {
        method: $('payMethodIn').value.trim(), till: $('payTillIn').value.trim(), accountName: $('payNameIn').value.trim(),
        supportPhone: $('paySupportIn').value.trim(), instructions: $('payInstrIn').value.split('\n').map((s) => s.trim()).filter(Boolean)
      } } });
      say2('payEditMsg', 'Saved.', true);
    } catch (e) { say2('payEditMsg', e.message, false); }
  };

  $('logoFile').onchange = async () => {
    const f = $('logoFile').files[0]; if (!f) return;
    try {
      const d = await api('/logo', { method: 'POST', body: { dataUrl: await fileToDataUrl(f) } });
      $('curLogo').src = d.logoUrl + '&r=' + Date.now(); $('curLogo').classList.remove('hidden'); $('curLogoBadge').classList.add('hidden');
      toast('Logo updated');
    } catch (e) { toast(e.message); } finally { $('logoFile').value = ''; }
  };
  $('logoClearBtn').onclick = async () => {
    try { await api('/logo/clear', { method: 'POST' }); $('curLogo').classList.add('hidden'); $('curLogoBadge').classList.remove('hidden'); toast('Logo removed'); }
    catch (e) { toast(e.message); }
  };

  async function loadPortalContent() {
    const { portal: p } = await api('/portal');
    $('brandName').value = p.brand.name || ''; $('brandTagline').value = p.brand.tagline || '';
    if (p.brand.logoUrl) { $('curLogo').src = p.brand.logoUrl; $('curLogo').classList.remove('hidden'); $('curLogoBadge').classList.add('hidden'); }
    $('payMethodIn').value = p.payment.method || ''; $('payTillIn').value = p.payment.till || '';
    $('payNameIn').value = p.payment.accountName || ''; $('paySupportIn').value = p.payment.supportPhone || '';
    $('payInstrIn').value = (p.payment.instructions || []).join('\n');
    $('tierRows').replaceChildren(...p.tiers.map(tierRow));
  }

  /* ---------- Portal theme ---------- */
  function fillTemplateSelect(select, templates, selected) {
    select.replaceChildren();
    let curGroup = null, groupEl = null;
    for (const t of templates) {
      if (t.group !== curGroup) { curGroup = t.group; groupEl = el('optgroup'); groupEl.label = t.group; select.append(groupEl); }
      const o = el('option', null, t.name); o.value = t.id; groupEl.append(o);
    }
    select.value = selected;
  }
  const DOW = [['sunday', 'Sun'], ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat']];
  function holidayRow(h, templates) {
    const row = el('div', 'grid grid-cols-6 gap-1.5 items-center');
    const dateIn = el('input', 'rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs font-mono'); dateIn.placeholder = 'MM-DD'; dateIn.value = h.date || '';
    const nameIn = el('input', 'col-span-2 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs'); nameIn.placeholder = 'Name'; nameIn.value = h.name || '';
    const tmplSel = el('select', 'col-span-2 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs');
    fillTemplateSelect(tmplSel, templates, h.template || 'default');
    const delBtn = el('button', 'rounded-lg bg-rose-600/80 text-xs py-1.5', '✕');
    row.append(dateIn, nameIn, tmplSel, delBtn);
    row._get = () => ({ date: dateIn.value.trim(), name: nameIn.value.trim(), template: tmplSel.value });
    delBtn.onclick = () => row.remove();
    return row;
  }
  function toggleThemeMode() {
    const auto = $('themeModeAuto').checked;
    $('manualThemeRow').classList.toggle('hidden', auto);
    $('autoThemeRows').classList.toggle('hidden', !auto);
  }
  $('themeModeManual').onchange = toggleThemeMode; $('themeModeAuto').onchange = toggleThemeMode;

  let themeTemplates = [];
  async function loadTheme() {
    const { theme, resolved, templates, images, imageFolder, today } = await api('/theme');
    themeTemplates = templates;
    (theme.mode === 'auto' ? $('themeModeAuto') : $('themeModeManual')).checked = true;
    toggleThemeMode();
    fillTemplateSelect($('manualTemplate'), templates, theme.manualTemplate || 'default');
    $('animToggle').checked = theme.animations !== false;
    $('weekdayGrid').replaceChildren(...DOW.map(([key, label]) => {
      const wrap = el('div'); wrap.append(el('label', 'text-[11px] text-slate-500 block mb-0.5', label));
      const sel = el('select', 'w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs');
      fillTemplateSelect(sel, templates, (theme.weekday || {})[key] || 'default'); sel.dataset.day = key;
      wrap.append(sel); return wrap;
    }));
    $('holidayRows').replaceChildren(...(theme.holidays || []).map((h) => holidayRow(h, templates)));
    $('imageFolder').textContent = imageFolder;
    $('imageRotationToggle').checked = theme.imageRotationEnabled === true;
    $('imageTodaySelect').replaceChildren(el('option', null, 'Automatic / no manual choice'));
    $('imageTodaySelect').firstElementChild.value = '';
    for (const image of images) {
      const option = el('option', null, image.filename);
      option.value = image.filename;
      $('imageTodaySelect').append(option);
    }
    const selectedToday = theme.imageOverrideDate === today ? theme.imageOverrideFile : '';
    $('imageTodaySelect').value = images.some((image) => image.filename === selectedToday) ? selectedToday : '';
    showImagePreview(resolved, images);
    if (resolved.customBackground) { $('curBg').src = resolved.backgroundUrl; $('curBg').classList.remove('hidden'); } else $('curBg').classList.add('hidden');
    if (!images.length) say2('imageRotationMsg', 'No background images found yet. Add PNG, JPG or WEBP files to the folder above, then refresh.', false);
    else say2('imageRotationMsg', `${images.length} image${images.length === 1 ? '' : 's'} available. ${resolved.libraryImage ? `Today's background: ${resolved.libraryImage}` : 'The existing theme or uploaded background is currently in use.'}`, true);
  }
  function showImagePreview(resolved, images) {
    const preview = $('imageTodayPreview');
    const selected = $('imageTodaySelect').value;
    const image = images.find((entry) => entry.filename === selected);
    const url = image ? image.url : (resolved.libraryImage ? resolved.backgroundUrl : '');
    if (url) { preview.src = url; preview.classList.remove('hidden'); }
    else { preview.removeAttribute('src'); preview.classList.add('hidden'); }
  }
  $('imageTodaySelect').onchange = async () => {
    const previewSelection = $('imageTodaySelect').value;
    const src = previewSelection ? `/theme-library/${encodeURIComponent(previewSelection)}?preview=${Date.now()}` : '';
    const preview = $('imageTodayPreview');
    if (src) { preview.src = src; preview.classList.remove('hidden'); }
    else {
      try { const { resolved, images } = await api('/theme'); showImagePreview(resolved, images); }
      catch (e) { say2('imageRotationMsg', e.message, false); }
    }
  };
  $('imageRefreshBtn').onclick = async () => {
    $('imageRefreshBtn').disabled = true;
    try { await loadTheme(); }
    catch (e) { say2('imageRotationMsg', e.message, false); }
    finally { $('imageRefreshBtn').disabled = false; }
  };
  $('imageRotationSaveBtn').onclick = async () => {
    const button = $('imageRotationSaveBtn');
    button.disabled = true;
    try {
      const d = await api('/theme', { method: 'POST', body: {
        imageRotationEnabled: $('imageRotationToggle').checked,
        imageOverrideFile: $('imageTodaySelect').value
      } });
      await loadTheme();
      const image = d.resolved.libraryImage;
      say2('imageRotationMsg', image ? `Saved. Today's background is ${image}.` : 'Saved. The existing uploaded background or theme remains in use.', true);
    } catch (e) { say2('imageRotationMsg', e.message, false); }
    finally { button.disabled = false; }
  };
  $('holidayAddBtn').onclick = () => $('holidayRows').append(holidayRow({}, themeTemplates));
  $('themeSaveBtn').onclick = async () => {
    const mode = $('themeModeAuto').checked ? 'auto' : 'manual';
    const body = { mode, animations: $('animToggle').checked };
    if (mode === 'manual') body.manualTemplate = $('manualTemplate').value;
    else {
      body.weekday = {}; [...$('weekdayGrid').querySelectorAll('select')].forEach((s) => { body.weekday[s.dataset.day] = s.value; });
      body.holidays = [...$('holidayRows').children].map((r) => r._get());
    }
    $('themeSaveBtn').disabled = true;
    try { await api('/theme', { method: 'POST', body }); say2('themeMsg', 'Saved — the portal updates immediately.', true); }
    catch (e) { say2('themeMsg', e.message, false); } finally { $('themeSaveBtn').disabled = false; }
  };
  $('bgFile').onchange = async () => {
    const f = $('bgFile').files[0]; if (!f) return;
    say2('bgMsg', 'Uploading…', true);
    try {
      const d = await api('/theme/background', { method: 'POST', body: { dataUrl: await fileToDataUrl(f) } });
      $('curBg').src = d.resolved.backgroundUrl; $('curBg').classList.remove('hidden'); say2('bgMsg', 'Saved — this photo now overrides every template.', true);
    } catch (e) { say2('bgMsg', e.message, false); } finally { $('bgFile').value = ''; }
  };
  $('bgClearBtn').onclick = async () => {
    try { await api('/theme/background/clear', { method: 'POST' }); $('curBg').classList.add('hidden'); say2('bgMsg', 'Removed — templates apply again.', true); }
    catch (e) { say2('bgMsg', e.message, false); }
  };

  $('payTest').onclick = async () => {
    const o = $('payTestOut'); o.classList.remove('hidden'); o.textContent = 'Contacting Courtney Tech…';
    try { const { accounts } = await api('/pay/accounts'); o.textContent = accounts.length ? 'Connected. Your payment_account_id → ' + accounts.map((a) => `${a.id} (${a.type}${a.name ? ', ' + a.name : ''}${a.primary ? ', primary' : ''})`).join(' · ') + '  — put that number in COURTNEYTECH_ACCOUNT_ID' : 'Connected, but no payment accounts found.'; }
    catch (e) { o.textContent = '⚠ ' + e.message; }
  };

  $('adminTokenForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const nextToken = $('newAdminToken').value;
    const confirmation = $('confirmAdminToken').value;
    const message = $('adminTokenMsg');
    if (nextToken !== confirmation) {
      message.className = 'text-sm min-h-[1.25rem] text-rose-400';
      message.textContent = 'The passwords do not match.';
      return;
    }
    const button = $('adminTokenSaveBtn');
    button.disabled = true;
    message.className = 'text-sm min-h-[1.25rem] text-slate-400';
    message.textContent = 'Saving…';
    try {
      await api('/security/admin-token', { method: 'POST', body: { newToken: nextToken } });
      token = nextToken;
      sessionStorage.setItem('synthnetAdmin', token);
      $('newAdminToken').value = '';
      $('confirmAdminToken').value = '';
      message.className = 'text-sm min-h-[1.25rem] text-emerald-400';
      message.textContent = 'Admin password changed and saved.';
    } catch (e) {
      message.className = 'text-sm min-h-[1.25rem] text-rose-400';
      message.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  });

  /* ---------- Boot ---------- */
  async function start() {
    try { await api('/clients'); } catch (e) { return lock(e.message); }
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
    await loadTiers(); loadClients(); loadVouchers(); loadHotspot(true); loadPayments().catch(() => {});
    loadPortalContent().catch((e) => toast(e.message)); loadTheme().catch((e) => toast(e.message));
    SynthAdmin.onStart.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    timers.push(setInterval(() => { if (!document.hidden) loadClients().catch(() => {}); }, 5000));
    timers.push(setInterval(() => { if (!document.hidden) loadHotspot(false); }, 30000));
    timers.push(setInterval(() => { if (!document.hidden) loadPayments().catch(() => {}); }, 15000));
  }
  $('tokenBtn').onclick = async () => {
    const button = $('tokenBtn');
    token = $('tokenInput').value.trim();
    sessionStorage.setItem('synthnetAdmin', token);
    button.disabled = true;
    button.textContent = 'Checking…';
    try { await start(); }
    finally { button.disabled = false; button.textContent = 'Unlock'; }
  };
  $('tokenInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('tokenBtn').click(); });
  $('lockBtn').onclick = () => lock();
  if (token) start();
})();
