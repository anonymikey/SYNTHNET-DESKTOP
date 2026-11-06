// "Portal greeting" card of the admin dashboard. Uses the same renderer as the customer portal (public/greeting.js),
// so the preview is exactly what customers see. Plugs into admin.js through window.SynthAdmin.
(() => {
  const A = window.SynthAdmin; if (!A || !window.Greeting) return;
  const { api, $, el } = A;
  const say = (text, ok) => { const m = $('grMsg'); m.textContent = text; m.className = 'text-xs min-h-[1rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400'); };
  let meta = null, brand = '', support = '';
  const rows = {};                                                  // period id -> inputs

  const hourLabel = (h) => `${String(h).padStart(2, '0')}:00 (${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'})`;
  const field = (cls, node) => { node.className = cls; return node; };

  function collect() {
    return {
      enabled: $('grEnabled').checked, showClock: $('grClock').checked,
      periods: Object.entries(rows).map(([id, r]) => ({ id, start: +r.start.value, emoji: r.emoji.value, accent: r.accent.value, title: r.title.value, subtitle: r.subtitle.value }))
    };
  }
  function preview() {
    const g = collect(), as = $('grPreviewAs').value;
    $('grPreviewOff').classList.toggle('hidden', g.enabled);
    window.Greeting.render($('grPreview'), g, { now: Date.now(), brand, support, force: as === 'now' ? null : as });
    $('grState').textContent = g.enabled ? 'on' : 'off';
    $('grState').className = 'ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ' + (g.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300');
  }

  function build(data) {
    meta = data; const g = data.greeting;
    $('grEnabled').checked = g.enabled; $('grClock').checked = g.showClock;
    const sel = $('grPreviewAs'), keep = sel.value || 'now'; sel.replaceChildren();
    sel.append(new Option('Right now (Nairobi time)', 'now'));
    const box = $('grRows'); box.replaceChildren();
    for (const p of g.periods) {
      sel.append(new Option(p.title || p.id, p.id));
      const card = el('div', 'rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2');
      const top = el('div', 'grid gap-2 grid-cols-[4rem_1fr_1fr]');
      const emoji = field('rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-center text-lg', el('input')); emoji.value = p.emoji; emoji.maxLength = 6; emoji.title = 'Emoji';
      const start = field('rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-sm', el('select'));
      for (let h = 0; h < 24; h++) start.append(new Option('From ' + hourLabel(h), h));
      start.value = p.start;
      const accent = field('rounded-lg bg-slate-950 border border-slate-700 px-2 py-1.5 text-sm', el('select'));
      for (const a of data.accents) accent.append(new Option(a.name, a.id));
      accent.value = p.accent;
      top.append(emoji, start, accent);
      const title = field('w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm font-semibold', el('input')); title.value = p.title; title.maxLength = 40; title.placeholder = 'Greeting, e.g. Good morning';
      const subtitle = field('w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm', el('textarea')); subtitle.rows = 2; subtitle.value = p.subtitle; subtitle.maxLength = 160; subtitle.placeholder = 'Short message under the greeting';
      card.append(top, title, subtitle); box.append(card);
      rows[p.id] = { emoji, start, accent, title, subtitle };
      for (const inp of [emoji, start, accent, title, subtitle]) { inp.addEventListener('input', preview); inp.addEventListener('change', preview); }
    }
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'now';
    preview();
  }

  async function load() {
    try {
      const [data, cfg] = await Promise.all([api('/greeting'), fetch('/api/config').then((r) => r.json())]);
      brand = cfg.brand.name; support = cfg.payment.supportPhone; build(data);
    } catch (e) { say(e.message, false); }
  }

  $('grEnabled').addEventListener('change', preview); $('grClock').addEventListener('change', preview); $('grPreviewAs').addEventListener('change', preview);
  $('grSave').onclick = async () => {
    const btn = $('grSave'); btn.disabled = true; say('Saving…', true);
    try { const d = await api('/greeting', { method: 'POST', body: collect() }); build({ ...meta, greeting: d.greeting }); say('Saved. Customers see it within a minute (or on their next page load).', true); }
    catch (e) { say(e.message, false); } finally { btn.disabled = false; }
  };
  $('grReset').onclick = async () => {
    if (!confirm('Restore the default greetings, colours and times?')) return;
    try { const d = await api('/greeting/reset', { method: 'POST' }); build({ ...meta, greeting: d.greeting }); say('Defaults restored.', true); }
    catch (e) { say(e.message, false); }
  };
  setInterval(() => { if (!document.hidden && meta) preview(); }, 30000);   // keep the clock line fresh

  A.onStart.push(load);
  if (!$('app').classList.contains('hidden')) load();
})();
