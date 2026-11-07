// SMS section of the admin dashboard. Plugs into admin.js through window.SynthAdmin.
(() => {
  const A = window.SynthAdmin; if (!A) return;
  const { api, $, el, badge, toast } = A;
  const say = (id, text, ok) => { const m = $(id); m.textContent = text; m.className = 'text-xs min-h-[1rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400'); };
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

  let status = null, timer = null;
  const kindEditors = {};                                          // kind -> { enabled, template, counter, extra }

  /* ---------- overview ---------- */
  function renderStats(st) {
    $('smsStatQueued').textContent = st.queued; $('smsStatSent').textContent = st.sent24h; $('smsStatFailed').textContent = st.failed24h;
  }
  function renderState() {
    const s = $('smsState');
    s.textContent = status.configured ? 'connected' : 'not set up';
    s.className = 'ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ' + (status.configured ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300');
    $('smsSender').value = status.senderId || '';
    $('smsToken').placeholder = status.configured ? 'Token saved securely; paste a new token to replace it.' : 'API token from sms.ots.co.ke';
    if (!status.configured) $('smsConn').open = true;
    renderStats(status.stats);
  }

  async function loadStatus() {
    status = await api('/sms/status');
    renderState(); buildKinds(); fillSettings();
  }

  /* ---------- connection ---------- */
  $('smsCredSave').onclick = async () => {
    const btn = $('smsCredSave'); btn.disabled = true;
    try {
      status = await api('/sms/credentials', { method: 'POST', body: { token: $('smsToken').value.trim(), senderId: $('smsSender').value.trim() } });
      $('smsToken').value = ''; renderState(); say('smsConnMsg', 'Saved.', true);
    } catch (e) { say('smsConnMsg', e.message, false); } finally { btn.disabled = false; }
  };
  $('smsTestConn').onclick = async () => {
    say('smsConnMsg', 'Contacting Olympus SMS…', true);
    try { const d = await api('/sms/test-connection', { method: 'POST' }); say('smsConnMsg', d.ok ? 'Connected: the token is accepted.' : d.error, d.ok); }
    catch (e) { say('smsConnMsg', e.message, false); }
  };
  $('smsTestSend').onclick = async () => {
    const btn = $('smsTestSend'); btn.disabled = true; say('smsConnMsg', 'Sending…', true);
    try { await api('/sms/test-send', { method: 'POST', body: { phone: $('smsTestPhone').value.trim() } }); say('smsConnMsg', 'Test SMS accepted by Olympus. It should arrive in a few seconds.', true); loadLog(); }
    catch (e) { say('smsConnMsg', e.message, false); } finally { btn.disabled = false; }
  };

  /* ---------- automatic messages ---------- */
  const counterText = (m) => `${m.length} characters · ${m.segments} SMS${m.segments === 1 ? '' : ' segments'}${m.encoding === 'Unicode' ? ' · contains special characters (curly quotes, emoji…): only 70 characters fit per SMS' : ''}`;
  const refreshCounter = debounce(async (kind) => {
    const ed = kindEditors[kind]; if (!ed) return;
    try { const m = await api('/sms/preview', { method: 'POST', body: { template: ed.template.value } }); ed.counter.textContent = 'Example: ' + m.text + '  —  ' + counterText(m); ed.counter.className = 'text-xs ' + (m.segments > 1 ? 'text-amber-300' : 'text-slate-400'); }
    catch { /* ignore transient errors while typing */ }
  }, 300);

  function buildKinds() {
    $('smsPlaceholders').textContent = 'Placeholders you can use: ' + status.placeholders.map((p) => '{' + p + '}').join(' ') + '. Keep each message to one SMS (160 plain characters) to keep costs down.';
    const box = $('smsKinds'); box.replaceChildren();
    for (const kind of status.kinds) {
      const s = status.settings[kind];
      const card = el('div', 'rounded-xl bg-slate-950/60 border border-slate-800 p-3 space-y-2');
      const head = el('label', 'flex items-center gap-2 text-sm font-medium');
      const enabled = el('input'); enabled.type = 'checkbox'; enabled.className = 'accent-emerald-400'; enabled.checked = !!s.enabled;
      head.append(enabled, status.labels[kind]);
      const template = el('textarea', 'w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-sm'); template.rows = 2; template.maxLength = 480; template.value = s.template;
      const counter = el('p', 'text-xs text-slate-400', '');
      card.append(head, template);
      const ed = { enabled, template, counter };
      if (kind === 'reminder') {
        const row = el('div', 'grid gap-2 sm:grid-cols-2');
        const leads = el('input', 'block w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs'); leads.value = (s.leadMinutes || []).join(', '); leads.placeholder = '1440, 15';
        const minPrice = el('input', 'block w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs'); minPrice.type = 'number'; minPrice.min = '0'; minPrice.value = s.minPriceKsh ?? 0;
        const l1 = el('label', 'text-xs text-slate-400 space-y-1 block'); l1.append('Remind when this many minutes are left (1440 = 1 day; a package only gets reminders up to half its length)', leads);
        const l2 = el('label', 'text-xs text-slate-400 space-y-1 block'); l2.append('Only for packages priced at or above KSh (an SMS costs money; reminders on tiny packages may not pay for themselves)', minPrice);
        row.append(l1, l2); card.append(row); ed.leads = leads; ed.minPrice = minPrice;
      }
      card.append(counter); box.append(card);
      template.oninput = () => refreshCounter(kind);
      kindEditors[kind] = ed; refreshCounter(kind);
    }
  }
  function fillSettings() {
    $('smsMaster').checked = !!status.settings.enabled;
    $('smsOptOut').value = (status.settings.doNotMessage || []).join(', ');
  }
  $('smsSettingsSave').onclick = async () => {
    const body = { enabled: $('smsMaster').checked, doNotMessage: $('smsOptOut').value };
    for (const [kind, ed] of Object.entries(kindEditors)) {
      body[kind] = { enabled: ed.enabled.checked, template: ed.template.value };
      if (kind === 'reminder') { body[kind].leadMinutes = ed.leads.value; body[kind].minPriceKsh = ed.minPrice.value === '' ? 0 : +ed.minPrice.value; }
    }
    const btn = $('smsSettingsSave'); btn.disabled = true;
    try { status = await api('/sms/settings', { method: 'POST', body }); say('smsSettingsMsg', 'Saved. Applies to the next message.', true); fillSettings(); }
    catch (e) { say('smsSettingsMsg', e.message, false); } finally { btn.disabled = false; }
  };

  /* ---------- broadcast ---------- */
  const bcBody = () => ({ audience: $('bcAudience').value, numbers: $('bcNumbers').value, days: +$('bcDays').value || 0, message: $('bcMessage').value });
  const refreshAudience = debounce(async () => {
    const b = bcBody();
    $('bcNumbers').classList.toggle('hidden', b.audience !== 'custom');
    $('bcDays').classList.toggle('hidden', b.audience === 'custom' || b.audience === 'active');
    try {
      const d = await api('/sms/audience', { method: 'POST', body: b });
      $('bcCounter').textContent = counterText(d);
      $('bcCounter').className = 'text-xs ' + (d.encoding === 'Unicode' || d.segments > 1 ? 'text-amber-300' : 'text-slate-400');
      const bits = [`${d.count} recipient${d.count === 1 ? '' : 's'}`];
      if (d.excluded) bits.push(`${d.excluded} skipped (do-not-message)`);
      if (d.invalid.length) bits.push(`${d.invalid.length} invalid number${d.invalid.length === 1 ? '' : 's'} ignored`);
      if (d.count && d.segments) bits.push(`about ${d.units} SMS unit${d.units === 1 ? '' : 's'} in total`);
      $('bcAudienceInfo').textContent = bits.join(' · ');
    } catch (e) { $('bcAudienceInfo').textContent = e.message; }
  }, 300);
  ['bcAudience', 'bcNumbers', 'bcDays', 'bcMessage'].forEach((id) => { $(id).addEventListener('input', refreshAudience); $(id).addEventListener('change', refreshAudience); });

  $('bcSend').onclick = async () => {
    const b = bcBody(); b.scheduleTime = $('bcSchedule').value || '';
    if (!b.message.trim()) return say('bcMsg', 'Write a message first.', false);
    let info; try { info = await api('/sms/audience', { method: 'POST', body: b }); } catch (e) { return say('bcMsg', e.message, false); }
    if (!info.count) return say('bcMsg', 'No recipients match that audience.', false);
    if (!confirm(`Send this message to ${info.count} recipient${info.count === 1 ? '' : 's'} (about ${info.units} SMS unit${info.units === 1 ? '' : 's'})${b.scheduleTime ? ' at ' + b.scheduleTime.replace('T', ' ') : ' now'}?`)) return;
    const btn = $('bcSend'); btn.disabled = true; say('bcMsg', 'Queuing…', true);
    try {
      const d = await api('/sms/broadcast', { method: 'POST', body: b });
      say('bcMsg', `${d.scheduled ? 'Scheduled' : 'Queued'} for ${d.queued} recipient${d.queued === 1 ? '' : 's'}. Watch the Message log for delivery.`, true);
      $('bcMessage').value = ''; refreshAudience(); loadLog(); $('smsLogBox').open = true;
    } catch (e) { say('bcMsg', e.message, false); } finally { btn.disabled = false; }
  };

  /* ---------- log ---------- */
  const KIND = { purchase: 'Receipt', otp: 'Reconnect code', voucher: 'Voucher', award: 'Award', reminder: 'Reminder', expired: 'Ended', outage_start: 'Outage', outage_end: 'Restored', broadcast: 'Broadcast' };
  const COLORS = { sent: 'bg-emerald-500/20 text-emerald-300', queued: 'bg-amber-500/20 text-amber-300', failed: 'bg-rose-500/20 text-rose-300', cancelled: 'bg-slate-600/40 text-slate-300' };
  async function loadLog() {
    const { log, stats } = await api('/sms/log?limit=100');
    renderStats(stats);
    $('smsLog').replaceChildren(...log.map((m) => {
      const tr = el('tr', 'border-t border-slate-800');
      tr.title = `${m.text}${m.error ? '\n\n⚠ ' + m.error : ''}${m.attempts ? `\n(attempts: ${m.attempts})` : ''}`;
      const st = el('td', 'pr-3'); st.append(badge(m.scheduleTime && m.status === 'sent' ? 'scheduled' : m.status, COLORS[m.status] || ''));
      const act = el('td', 'text-right whitespace-nowrap');
      const doit = async (path) => { try { await api(`/sms/log/${m.id}/${path}`, { method: 'POST' }); loadLog(); } catch (e) { toast(e.message); } };
      if ((m.status === 'failed' || m.status === 'cancelled') && m.retryable !== false) { const b = el('button', 'rounded-lg bg-slate-700 px-2 py-1 text-xs', 'Retry'); b.onclick = () => doit('retry'); act.append(b); }
      if (m.status === 'queued') { const b = el('button', 'rounded-lg bg-slate-700 px-2 py-1 text-xs', 'Cancel'); b.onclick = () => doit('cancel'); act.append(b); }
      tr.append(el('td', 'py-1.5 pr-3 text-xs text-slate-400', new Date(m.createdAt).toLocaleString()), el('td', 'pr-3 font-mono text-xs', m.to), el('td', 'pr-3 text-xs', KIND[m.kind] || m.kind), st, act);
      return tr;
    }));
  }

  /* ---------- lifecycle ---------- */
  const boot = () => {
    loadStatus().then(refreshAudience).catch((e) => toast(e.message));
    loadLog().catch(() => {});
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) loadLog().catch(() => {}); }, 10000);
  };
  A.onStart.push(boot);
  if (!$('app').classList.contains('hidden')) boot();             // dashboard finished unlocking before this script loaded
  A.onLock.push(() => clearInterval(timer));
})();
