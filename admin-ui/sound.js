// "Connection sound" card of the admin dashboard. Uses the same player as the customer portal (public/connectsound.js),
// so what you hear here is exactly what customers hear. Plugs into admin.js through window.SynthAdmin.
(() => {
  const A = window.SynthAdmin, CS = window.ConnectSound; if (!A || !CS) return;
  const { api, $, el } = A;
  let state = null, selected = 'beep', dirty = false;

  const say = (text, ok) => { const m = $('sndMsg'); m.textContent = text; m.className = 'text-xs min-h-[1rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400'); };
  const customUrl = () => (state && state.hasCustom ? `/connect-sound?v=${state.customVersion}` : null);
  const volume = () => +$('sndVolume').value;
  const markDirty = () => { dirty = true; say('Not saved yet. Press "Save sound" to apply it for customers.', false); };

  async function preview(id) {
    if (id === 'custom') { const url = customUrl(); if (!url) return; await CS.load(url); CS.play({ preset: 'custom', volume: volume(), customUrl: url }); }
    else CS.play({ preset: id, volume: volume() });
  }

  function cards() {
    const items = CS.PRESETS.map((p) => ({ id: p.id, name: p.name, hint: p.hint }));
    if (state.hasCustom) items.push({ id: 'custom', name: state.customName || 'My sound', hint: 'Your uploaded clip (first 2 seconds)' });
    const grid = $('sndGrid'); grid.replaceChildren();
    for (const it of items) {
      const on = it.id === selected;
      const c = el('div', 'flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition ' + (on ? 'border-violet-400 bg-violet-400/10' : 'border-slate-700 bg-slate-950/60 hover:border-slate-500'));
      c.setAttribute('role', 'radio'); c.setAttribute('aria-checked', on ? 'true' : 'false'); c.tabIndex = 0;
      const t = el('div', 'min-w-0'); t.append(el('p', 'truncate text-sm font-semibold ' + (on ? 'text-white' : 'text-slate-200'), (it.id === 'custom' ? '🎵 ' : '') + it.name), el('p', 'truncate text-xs text-slate-500', it.hint));
      const play = el('button', 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-400/20 text-violet-200 hover:bg-violet-400/30', '▶'); play.type = 'button'; play.setAttribute('aria-label', 'Play ' + it.name);
      play.onclick = (e) => { e.stopPropagation(); preview(it.id); };
      const choose = () => { selected = it.id; markDirty(); cards(); preview(it.id); };
      c.addEventListener('click', choose); c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
      c.append(t, play); grid.append(c);
    }
  }

  function draw() {
    selected = state.preset; $('sndEnabled').checked = state.enabled; $('sndVolume').value = state.volume; $('sndVolLabel').textContent = state.volume + '%';
    const s = $('sndState'); s.textContent = state.enabled ? 'on' : 'off'; s.className = 'ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ' + (state.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300');
    $('sndRemove').classList.toggle('hidden', !state.hasCustom);
    $('sndCustomInfo').textContent = state.hasCustom ? `Uploaded: ${state.customName}` : 'No custom sound uploaded.';
    dirty = false; cards();
  }
  async function load() {
    try { const d = await api('/sound'); state = d.sound; $('sndMaxKb').textContent = d.maxUploadKb; draw(); } catch (e) { say(e.message, false); }
  }

  $('sndVolume').addEventListener('input', () => { $('sndVolLabel').textContent = volume() + '%'; markDirty(); });
  $('sndVolume').addEventListener('change', () => preview(selected));
  $('sndEnabled').addEventListener('change', markDirty);
  $('sndTest').onclick = () => preview(selected);
  $('sndSave').onclick = async () => {
    const btn = $('sndSave'); btn.disabled = true; say('Saving…', true);
    try { const d = await api('/sound', { method: 'POST', body: { enabled: $('sndEnabled').checked, preset: selected, volume: volume() } }); state = d.sound; draw(); say('Saved. Customers hear this the next time they connect (within about a minute for people already on the page).', true); }
    catch (e) { say(e.message, false); } finally { btn.disabled = false; }
  };

  $('sndFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    const maxKb = +$('sndMaxKb').textContent || 300;
    if (f.size > maxKb * 1024) return say(`That file is ${Math.round(f.size / 1024)} KB. The limit is ${maxKb} KB. Trim it to a short clip first.`, false);
    const dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error('Could not read that file.')); r.readAsDataURL(f); }).catch((err) => { say(err.message, false); return null; });
    if (!dataUrl) return;
    // browsers sometimes label an .mp3 as "audio/mp3" or leave the type empty: normalise from the extension
    const ext = (f.name.split('.').pop() || '').toLowerCase(), mime = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' }[ext];
    const fixed = mime ? dataUrl.replace(/^data:[^;,]*/, 'data:' + mime) : dataUrl;
    say('Uploading…', true);
    try { const d = await api('/sound/upload', { method: 'POST', body: { dataUrl: fixed, name: f.name.replace(/\.[^.]+$/, '') } }); state = d.sound; draw(); await preview('custom'); say('Uploaded and selected. Customers will hear the first 2 seconds. Press "Save sound" if you changed anything else.', true); }
    catch (err) { say(err.message, false); }
  });
  $('sndRemove').onclick = async () => {
    try { const d = await api('/sound/clear', { method: 'POST' }); state = d.sound; draw(); say('Your sound was removed.', true); } catch (e) { say(e.message, false); }
  };

  A.onStart.push(load);
  if (!$('app').classList.contains('hidden')) load();
})();
