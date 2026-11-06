(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let cfg = null, selected = null, expiresAt = null, currentVoucher = null, outageState = null, timer = null, polling = null;
  const LAST_PHONE = 'synthnet:lastM-PesaPhone';
  const devicesPage = location.pathname === '/my-devices';

  if (devicesPage) {
    $('myDevices').classList.remove('hidden');
    $('buyArea').classList.add('hidden');
    $('connected').classList.add('hidden');
  }

  function savedPhone() { try { return localStorage.getItem(LAST_PHONE) || ''; } catch { return ''; } }
  function rememberPhone(phone) {
    try { localStorage.setItem(LAST_PHONE, phone); } catch { /* Storage may be disabled by the browser. */ }
    $('phone').value = phone;
    $('reconnectPhone').value = phone;
  }

  function renderTiers() {
    const on = cfg.payments.enabled;
    $('tapHint').classList.toggle('hidden', !on);
    $('tiers').replaceChildren(...cfg.tiers.map((t) => {
      const card = el(on ? 'button' : 'div', 'w-full text-left rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 flex items-center justify-between gap-3' + (on ? ' active:scale-[.99] transition' : ''));
      const left = el('div'); left.append(el('p', 'font-semibold', t.name), el('p', 'text-xs text-slate-400', t.note || ''));
      const right = el('div', 'text-right shrink-0'); right.append(el('p', 'text-lg font-extrabold', 'KSh ' + t.priceKsh));
      if (on) right.append(el('span', 'inline-block mt-1 rounded-full bg-cyan-400 text-slate-950 text-[11px] font-bold px-2.5 py-0.5', 'Get this package'));
      card.append(left, right);
      if (on) { card.type = 'button'; card.onclick = () => select(t); }
      return card;
    }));
  }

  function applyTheme(theme) {
    if (!theme) return;
    document.body.dataset.theme = theme.customBackground ? 'custom' : (theme.template || 'default');
    document.body.dataset.anim = theme.animations === false ? 'off' : 'on';
    $('themeBg').style.backgroundImage = theme.customBackground && theme.backgroundUrl ? `url('${theme.backgroundUrl}')` : '';
  }
  function applyLogo(brand) {
    if (brand && brand.logoUrl) { $('logoImg').src = brand.logoUrl; $('logoImg').classList.remove('hidden'); $('logoBadge').classList.add('hidden'); }
    else { $('logoImg').classList.add('hidden'); $('logoBadge').classList.remove('hidden'); }
  }

  // Greeting: time of day in Nairobi (EAT), measured against the SERVER clock so a wrong phone clock can't break it.
  let clockOffset = 0;
  function renderGreeting() {
    const box = $('greeting'); if (!box || !window.Greeting || !cfg) return;
    try { window.Greeting.render(box, cfg.greeting, { now: Date.now() + clockOffset, brand: cfg.brand.name, support: cfg.payment.supportPhone }); }
    catch (e) { box.hidden = true; console.warn('[greeting]', e); }
  }
  async function loadConfig() {
    cfg = await (await fetch('/api/config')).json();
    if (cfg.greeting) clockOffset = cfg.greeting.serverNow - Date.now();
    $('brand').textContent = cfg.brand.name; $('tagline').textContent = cfg.brand.tagline;
    if (cfg.portalUrl) $('portalFallbackLink').href = cfg.portalUrl;
    document.title = cfg.brand.name + ' – Wi-Fi Login';
    applyTheme(cfg.theme); applyLogo(cfg.brand);
    renderTiers(); renderGreeting(); reconnectCopy(); prepareSound();
    const p = cfg.payment;
    $('payMethod').textContent = p.method; $('payTill').textContent = p.till; $('payName').textContent = p.accountName; $('support').textContent = p.supportPhone;
    $('payHow').replaceChildren(...p.instructions.map((s) => el('li', null, s)));
    $('manual').open = !cfg.payments.enabled;
    $('smsNote').classList.toggle('hidden', !(cfg.sms && cfg.sms.receipts && cfg.payments.enabled));
    const phone = savedPhone();
    $('phone').value = phone; $('reconnectPhone').value = phone;
    if (!$('connected').classList.contains('hidden')) renderConnected();
  }

  function select(t) {
    selected = t; $('payTitle').textContent = `Get ${t.name} for KSh ${t.priceKsh}`;
    $('payCard').classList.remove('hidden'); say('payMsg', '', true); $('phone').focus();
    $('payCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* "You are connected" sound (admin chooses it in the dashboard). Plays ONLY on the moment a connection is established:
     voucher login, a finished payment, or a reconnect. Never when the page is merely re-opened while already connected,
     and never more than once per 4 seconds. A browser that blocks audio just stays silent. */
  let connectedShown = false, initialStatusDone = false, lastSoundAt = 0;
  function connectSound() {
    const snd = cfg && cfg.sound;
    if (!snd || !snd.enabled || !window.ConnectSound || Date.now() - lastSoundAt < 4000) return;
    lastSoundAt = Date.now();
    try { window.ConnectSound.play({ preset: snd.preset, volume: snd.volume, customUrl: snd.customUrl }); } catch (e) { console.warn('[sound]', e); }
  }
  function prepareSound() { if (cfg && cfg.sound && cfg.sound.preset === 'custom' && cfg.sound.customUrl && window.ConnectSound) window.ConnectSound.preload(cfg.sound.customUrl); }

  function showConnected(data, opts) {
    const newly = !connectedShown; connectedShown = true;
    const details = typeof data === 'number' ? { expiresAt: data } : (data || {});
    expiresAt = details.expiresAt || (details.voucher && details.voucher.expiresAt) || null;
    currentVoucher = details.voucher || (details.code ? details : null);
    outageState = details.outage || outageState;
    clearInterval(polling);
    if (details.message) $('connectedMessage').textContent = details.message;
    $('buyArea').classList.add('hidden'); $('connected').classList.remove('hidden');
    renderConnected();
    clearInterval(timer); tick(); timer = setInterval(tick, 1000);
    if (newly && !(opts && opts.silent) && ((opts && opts.fresh) || initialStatusDone)) connectSound();
  }
  function renderConnected() {
    const v = currentVoucher, info = v && cfg && cfg.tiers.find((t) => t.id === v.tier);
    $('connectedCode').textContent = v && v.code || '–';
    $('connectedPlan').textContent = info ? info.name : (v && v.tier || 'Active package');
    $('connectedExpiry').textContent = expiresAt ? 'Expires ' + new Date(expiresAt).toLocaleString() : '';
    const notice = $('outageNotice');
    notice.classList.toggle('hidden', !(outageState && outageState.active) && !(v && v.lastOutageCreditMs));
    if (outageState && outageState.active) {
      notice.textContent = `Service interruption is being tracked since ${new Date(outageState.startedAt).toLocaleString()}. Your package timer is paused and will be credited when service is restored.`;
    } else if (v && v.lastOutageCreditMs) {
      notice.textContent = `Service was restored. ${formatDuration(v.lastOutageCreditMs)} has been credited to your package.`;
    }
  }
  function showLogin() {
    connectedShown = false;
    clearInterval(timer); expiresAt = null; currentVoucher = null;
    $('connected').classList.add('hidden'); $('buyArea').classList.remove('hidden');
  }
  function formatDuration(ms) {
    const mins = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(mins / 60), m = mins % 60;
    return (h ? h + 'h ' : '') + m + 'm';
  }
  function tick() {
    if (!expiresAt) return;
    const now = Date.now(), s = Math.max(0, Math.floor((expiresAt - now) / 1000));
    if (s === 0) return showLogin();
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    $('remaining').textContent = (d ? d + 'd ' : '') + h + 'h ' + m + 'm ' + (s % 60) + 's';
    if (currentVoucher && currentVoucher.startedAt) {
      const duration = Number(currentVoucher.minutes) * 60000 || (expiresAt - currentVoucher.startedAt + (currentVoucher.pausedMs || 0));
      let pausedMs = currentVoucher.pausedMs || 0;
      if (outageState && outageState.active) pausedMs += Math.max(0, now - Math.max(outageState.startedAt, currentVoucher.startedAt));
      const used = Math.max(0, now - currentVoucher.startedAt - pausedMs);
      const pct = duration > 0 ? Math.min(100, Math.floor(used / duration * 100)) : 0;
      $('usagePercent').textContent = pct + '%';
      $('usageBar').style.width = pct + '%';
      $('usageBar').parentElement.setAttribute('aria-valuenow', String(pct));
    } else {
      $('usagePercent').textContent = '–';
      $('usageBar').style.width = '0%';
      $('usageBar').parentElement.setAttribute('aria-valuenow', '0');
    }
  }
  function say(id, text, ok) { const m = $(id); m.textContent = text; m.className = 'text-sm min-h-[1.25rem] text-center ' + (ok ? 'text-emerald-400' : 'text-rose-400'); }

  const shortId = (key) => { const k = String(key || ''); return /^([0-9a-f]{2}-){5}[0-9a-f]{2}$/i.test(k) ? 'ID …' + k.slice(-5).toUpperCase() : k.startsWith('phone:') ? 'Awaiting first connection' : 'ID ' + k.slice(-9); };
  async function loadMyDevices() {
    try {
      const response = await fetch('/api/my-devices', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        $('devicesOwner').classList.add('hidden'); $('devicesList').replaceChildren(); $('addDeviceForm').classList.remove('hidden'); $('addTvForm').classList.add('hidden');
        $('devicesMsg').replaceChildren(document.createTextNode((data.error || 'Connect with your package to view its devices.') + ' '));
        const a = el('a', 'font-semibold text-cyan-300 underline', 'Reconnect with your M-Pesa number'); a.href = '/login#reconnectCard'; $('devicesMsg').append(a);
        return;
      }
      const tier = cfg && cfg.tiers.find((t) => t.id === data.tier);
      $('devicesOwner').classList.remove('hidden');
      $('devicesVoucherCode').textContent = data.code;
      $('devicesPlan').textContent = (data.tierName || (tier ? tier.name : data.tier) || 'Active package') + (data.expiresAt ? ' · expires ' + niceWhen(data.expiresAt) : '');
      $('devicesCount').textContent = `${data.devices.length} of ${data.maxDevices} devices in use`;
      $('devicesMsg').textContent = data.devices.length ? '' : 'No devices are currently registered to this package.';
      $('devicesList').replaceChildren(...data.devices.map((device) => {
        const phone = device.type === 'mobile' || (device.type === 'primary' && device.isPrimary), tv = !!device.viaMac;
        const row = el('div', 'flex items-center justify-between gap-3 rounded-xl border p-3 ' + (device.isCurrent ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-slate-700 bg-slate-950/70'));
        const left = el('div', 'flex min-w-0 items-center gap-3');
        left.append(el('div', 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-800 text-xl', phone ? '📱' : tv ? '📺' : '💻'));
        const info = el('div', 'min-w-0');
        const title = el('p', 'font-semibold text-slate-100 flex flex-wrap items-center gap-2', phone ? 'Phone' : tv ? (device.label || 'TV') : 'TV / laptop');
        if (tv) title.append(device.online ? el('span', 'rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-300', '● Online') : el('span', 'rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-300', 'Waiting for the TV'));
        if (device.isCurrent) title.append(el('span', 'rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-extrabold uppercase text-slate-950', 'This device'));
        info.append(title, el('p', 'mt-0.5 text-xs text-slate-500', `${tv ? 'MAC ' + device.key.toUpperCase().replace(/-/g, ':') : shortId(device.key)} · added ${device.addedAt ? niceWhen(device.addedAt) : 'earlier'}`));
        left.append(info); row.append(left);
        if (device.type === 'other' && !device.isPrimary) {
          const button = el('button', 'shrink-0 rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25', 'Remove');
          button.onclick = () => removeCompanion(device.key, button);
          row.append(button);
        } else row.append(el('span', 'shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300', device.isPrimary ? 'Main device' : 'Protected'));
        return row;
      }));
      // The add form is for a laptop/TV that is NOT on the package yet; hide it when this device is already on it.
      $('addTvForm').classList.remove('hidden');
      const thisOn = data.devices.some((d) => d.isCurrent);
      $('addDeviceForm').classList.toggle('hidden', thisOn && data.devices.length >= data.maxDevices);
    } catch (e) {
      $('devicesMsg').textContent = 'Could not load devices. Check your connection and try again.';
      console.warn('[devices] Loading devices failed:', e);
    }
  }
  /* ---- Add a TV by MAC address ---- */
  $('tvMac').addEventListener('input', (e) => { const h = e.target.value.replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 12); e.target.value = (h.match(/.{1,2}/g) || []).join(':'); });
  $('addTvForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const mac = $('tvMac').value.trim(), btn = $('tvBtn');
    if (mac.replace(/[^0-9a-f]/gi, '').length !== 12) return say('tvMsg', 'Enter all 12 characters of the TV\'s MAC address.', false);
    btn.disabled = true; say('tvMsg', 'Adding your TV…', true);
    try {
      const r = await fetch('/api/my-devices/add-tv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac, label: $('tvLabel').value.trim() }) });
      const d = await r.json();
      if (!r.ok || !d.ok) return say('tvMsg', d.error || 'Could not add this TV.', false);
      $('tvMac').value = ''; $('tvLabel').value = '';
      say('tvMsg', 'TV added. Switch it on and join this Wi-Fi: it gets internet within about 10 seconds, no sign-in needed.' + (d.localAdmin ? ' Tip: this looks like a private/random address. If the TV does not connect, turn off "Private Wi-Fi address" on the TV and add the address it shows.' : ''), true);
      await loadMyDevices();
    } catch { say('tvMsg', 'Cannot reach the hotspot. Try again.', false); }
    finally { btn.disabled = false; }
  });
  $('devicesCopy').addEventListener('click', async () => {
    const code = $('devicesVoucherCode').textContent;
    try { await navigator.clipboard.writeText(code); $('devicesCopy').textContent = 'Copied ✓'; }
    catch { const r = document.createRange(); r.selectNodeContents($('devicesVoucherCode')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); $('devicesCopy').textContent = 'Select & copy'; }
    setTimeout(() => { $('devicesCopy').textContent = 'Copy'; }, 1800);
  });
  async function removeCompanion(key, button) {
    if (!confirm('Remove this TV/laptop from your package? Its internet access will stop immediately.')) return;
    button.disabled = true;
    $('devicesMsg').textContent = 'Removing companion device…';
    try {
      const response = await fetch('/api/my-devices/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not remove this device.');
      await loadMyDevices();
      $('devicesMsg').textContent = 'Device removed. Its internet access has been stopped.';
    } catch (e) {
      $('devicesMsg').textContent = e.message;
      button.disabled = false;
    }
  }
  $('addDeviceForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('addDeviceBtn'), code = $('addDeviceCode').value.trim();
    if (!code) { $('devicesMsg').textContent = 'Enter your active package voucher code.'; return; }
    button.disabled = true; $('devicesMsg').textContent = 'Checking package and adding this device…';
    try {
      const response = await fetch('/api/my-devices/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add this device.');
      $('addDeviceCode').value = '';
      await loadMyDevices();
      $('devicesMsg').textContent = 'This laptop/TV is now connected to your package.';
    } catch (e) {
      $('devicesMsg').textContent = e.message;
    } finally { button.disabled = false; }
  });

  async function login() {
    const code = $('code').value.trim();
    if (!code) return say('msg', 'Enter your voucher code.', false);
    $('connectBtn').disabled = true; say('msg', 'Checking…', true);
    try {
      const d = await (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json();
      if (!d.ok) return say('msg', d.error || 'Login failed.', false);
      showConnected(d, { fresh: true });
    } catch { say('msg', 'Cannot reach the hotspot. Try again.', false); }
    finally { $('connectBtn').disabled = false; }
  }

  /* ---- Payment: animated popup + fast polling ----
     The SERVER confirms payments on its own (src/pay.js watcher), so even if this page is closed the buyer is connected.
     This page only follows along (every ~1.2 s; the server asks M-Pesa at most every 5 s) to show progress. */
  const PENDING_KEY = 'synthnet:pendingPay', PENDING_MS = 150000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; } };
  const writePending = (rec) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(rec)); } catch { /* storage may be disabled */ } };
  const clearPending = () => { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } };
  function maskNumber(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (/^0[17]\d{8}$/.test(d)) return d.slice(0, 4) + ' *** ' + d.slice(-3);
    if (/^254[17]\d{8}$/.test(d)) return '0' + d.slice(3, 7) + ' *** ' + d.slice(-3);
    return d.length > 4 ? '*** ' + d.slice(-3) : 'your phone';
  }
  function niceWhen(ms) {
    if (!ms) return '';
    const d = new Date(ms), now = new Date(), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const sameDay = d.toDateString() === now.toDateString(), tomorrow = d.toDateString() === new Date(now.getTime() + 864e5).toDateString();
    return sameDay ? 'Today, ' + t : tomorrow ? 'Tomorrow, ' + t : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + t;
  }

  function failPay(title, message, withManual) {
    clearInterval(polling); clearPending(); $('payBtn').disabled = false;
    window.PayPopup.fail(message, {
      title,
      onRetry: () => { $('payCard').classList.remove('hidden'); $('phone').focus(); $('payCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
      onManual: withManual ? () => { $('manual').open = true; $('manual').scrollIntoView({ behavior: 'smooth', block: 'start' }); } : null
    });
  }
  async function finishPay(rec, r) {
    clearInterval(polling); clearPending();
    window.PayPopup.activating();
    showConnected(r, { silent: true });                            // the connected card is ready underneath the popup
    await sleep(500);
    window.PayPopup.success({ name: rec.name, expires: niceWhen(r.expiresAt || (r.voucher && r.voucher.expiresAt)), receipt: r.receipt });
    connectSound();                                                // in step with the "You're online!" screen
    $('payBtn').disabled = false; $('payCard').classList.add('hidden');
  }
  function followPayment(rec) {
    clearInterval(polling);
    const P = window.PayPopup;
    if (!P.isOpen()) P.open({ name: rec.name, amount: rec.amount, masked: rec.masked });
    P.onCancel = () => {
      clearInterval(polling); $('payBtn').disabled = false;
      say('payMsg', 'Cancelled. If you already entered your PIN, you will still be connected automatically.', true);
    };
    P.prompt(Math.max(5, (PENDING_MS - (Date.now() - rec.t0)) / 1000));
    let busy = false, finished = false;
    const check = async () => {
      if (busy || finished) return; busy = true;
      try {
        const r = await (await fetch('/api/pay/status?id=' + encodeURIComponent(rec.id), { cache: 'no-store' })).json();
        if (r.status === 'success') { finished = true; return finishPay(rec, r); }
        if (r.status === 'cancelled') { finished = true; return failPay('Payment cancelled', 'The M-Pesa request was cancelled or the wrong PIN was entered. No money was taken. You can try again.', false); }
        if (r.status === 'timeout') { finished = true; return failPay('No response from M-Pesa', 'We did not get a reply from M-Pesa. If money was deducted, you will be connected automatically within a few minutes, or contact support.', true); }
        if (r.status === 'failed' || r.status === 'unknown') { finished = true; return failPay('Payment not completed', r.message || 'The payment did not go through. No money was taken.', true); }
      } catch { /* hotspot briefly unreachable: keep trying */ }
      finally { busy = false; }
      if (!finished && Date.now() - rec.t0 > PENDING_MS + 15000) { finished = true; failPay('Timed out', 'Still no confirmation. If money was deducted, you will be connected automatically, or contact support.', true); }
    };
    polling = setInterval(check, 1200);
  }
  async function pay() {
    if (!selected) return;
    const tier = selected, typed = $('phone').value.trim(), masked = maskNumber(typed);
    $('payBtn').disabled = true; say('payMsg', '', true);
    window.PayPopup.open({ name: tier.name, amount: tier.priceKsh, masked });
    let d;
    try { d = await (await fetch('/api/pay/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: tier.id, phone: typed }) })).json(); }
    catch { return failPay('Cannot reach the hotspot', 'Check that you are still connected to the Wi-Fi, then try again.', false); }
    if (!d.ok) return failPay('Could not send the request', d.message || 'Could not start payment.', !!(cfg && !cfg.payments.enabled));
    rememberPhone(typed);
    const rec = { id: d.id, t0: Date.now(), tierId: tier.id, name: tier.name, amount: tier.priceKsh, masked };
    writePending(rec); followPayment(rec);
  }
  function resumePending() {                                       // page reloaded (or reopened) while a payment was waiting for the PIN
    const rec = readPending();
    if (!rec) return;
    if (!rec.id || Date.now() - rec.t0 > PENDING_MS) return clearPending();
    $('payBtn').disabled = true; followPayment(rec);
  }

  $('connectBtn').addEventListener('click', login);
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('payBtn').addEventListener('click', pay);
  $('logoutBtn').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); });

  /* Reconnect by M-Pesa number. Laptops/TVs link straight away. Phones get an SMS code first (when the admin leaves
     verification on), because anyone could type someone else's number. */
  let rcNeedCode = false, rcTimer = null;
  function rcResendTimer(sec) {
    clearInterval(rcTimer); const btn = $('reconnectResend'); let left = Math.max(0, Math.round(sec || 0));
    const draw = () => { btn.disabled = left > 0; btn.textContent = left > 0 ? `Send a new code (${left}s)` : 'Send a new code'; };
    draw(); if (left > 0) rcTimer = setInterval(() => { left--; draw(); if (left <= 0) clearInterval(rcTimer); }, 1000);
  }
  function rcReset() { rcNeedCode = false; clearInterval(rcTimer); $('reconnectCodeBox').classList.add('hidden'); $('reconnectCode').value = ''; $('reconnectBtn').textContent = 'Reconnect'; }
  function reconnectCopy() {
    const m = cfg && cfg.reconnect && cfg.reconnect.phones;
    $('reconnectHelp').textContent = m === 'sms'
      ? 'Lost your connection or changed phone? Enter the M-Pesa number you paid with. On a phone we text a 6-digit code to that number to confirm it is you.'
      : m === 'number' ? 'Lost your connection? Enter the M-Pesa number you paid with to get back online.'
      : 'Phones reconnect automatically. For a laptop or TV, enter the M-Pesa number used to pay.';
  }
  async function doReconnect(resend) {
    const phone = $('reconnectPhone').value.trim(), code = $('reconnectCode').value.replace(/\D/g, '');
    if (!phone) return say('reconnectMsg', 'Enter the number you paid with.', false);
    if (rcNeedCode && !resend && code.length !== 6) return say('reconnectMsg', 'Enter the 6-digit code from the SMS.', false);
    $('reconnectBtn').disabled = true; say('reconnectMsg', resend ? 'Sending a new code…' : rcNeedCode ? 'Checking the code…' : 'Checking…', true);
    try {
      const res = await fetch('/api/reconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, ...(rcNeedCode && !resend && code ? { code } : {}) }) });
      const d = await res.json();
      if (d.ok) { rcReset(); rememberPhone(phone); say('reconnectMsg', '', true); return showConnected(d, { fresh: true }); }
      if (d.needCode) {
        const first = !rcNeedCode; rcNeedCode = true;
        $('reconnectCodeBox').classList.remove('hidden'); $('reconnectBtn').textContent = 'Verify & reconnect';
        if (d.resendIn || d.wait) rcResendTimer(d.resendIn || d.wait);
        if (d.expired) { $('reconnectCode').value = ''; rcResendTimer(0); }
        say('reconnectMsg', d.message || 'Enter the code we sent you.', res.ok);
        if (first || res.ok) $('reconnectCode').focus();
        return;
      }
      say('reconnectMsg', d.message || 'Could not reconnect.', false);
    } catch { say('reconnectMsg', 'Cannot reach the hotspot. Try again.', false); }
    finally { $('reconnectBtn').disabled = false; }
  }
  $('reconnectBtn').addEventListener('click', () => doReconnect(false));
  $('reconnectResend').addEventListener('click', () => doReconnect(true));
  $('reconnectPhone').addEventListener('input', () => { if (rcNeedCode) { rcReset(); say('reconnectMsg', '', true); } });
  $('reconnectCode').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); if (e.target.value.length === 6) doReconnect(false); });

  async function refreshStatus() {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const s = await response.json();
      if (!response.ok) throw new Error(s.error || 'Could not check the saved package.');
      $('authStatus').classList.add('hidden');
      $('authStatus').textContent = '';
      outageState = s.outage || outageState;
      if (s.authenticated && devicesPage) { expiresAt = s.expiresAt; currentVoucher = s.voucher; }
      else if (s.authenticated) showConnected(s);
      else if (!$('connected').classList.contains('hidden')) showLogin();
    } catch (e) {
      $('authStatus').textContent = 'Could not check your active package yet. Keep this page open or refresh to retry.';
      $('authStatus').classList.remove('hidden');
      console.warn('[auth] Status check failed:', e);
    } finally { initialStatusDone = true; }
  }
  loadConfig().then(resumePending).catch(() => {});
  setInterval(() => { if (!document.hidden) renderGreeting(); }, 20 * 1000);          // clock + period change (e.g. 11:59 -> 12:00)
  setInterval(async () => {                                                            // pick up admin edits without a page reload
    if (document.hidden || !cfg) return;
    try { const latest = await (await fetch('/api/config')).json(); cfg.greeting = latest.greeting; cfg.brand = latest.brand; cfg.sound = latest.sound; prepareSound(); clockOffset = latest.greeting.serverNow - Date.now(); renderGreeting(); } catch { /* offline: keep what is shown */ }
  }, 60 * 1000);
  refreshStatus();
  if (devicesPage) loadMyDevices();
  setInterval(() => {
    if (document.hidden) return;
    refreshStatus();
    if (devicesPage) loadMyDevices();
  }, 10000);
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const latest = await (await fetch('/api/config')).json();
      if (cfg && latest.theme && latest.theme.backgroundUrl !== cfg.theme.backgroundUrl) {
        cfg.theme = latest.theme;
        applyTheme(latest.theme);
      }
    } catch (e) { console.warn('[theme] Background refresh failed:', e); }
  }, 5 * 60 * 1000);
})();
