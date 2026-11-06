// "Link a TV by MAC address" support card. Plugs into admin.js through window.SynthAdmin.
(() => {
  const A = window.SynthAdmin; if (!A) return;
  const { api, $ } = A;
  const say = (t, ok) => { const m = $('tvMsg'); m.textContent = t; m.className = 'text-xs min-h-[1rem] ' + (ok ? 'text-emerald-400' : 'text-rose-400'); };
  $('tvAdd').onclick = async () => {
    const btn = $('tvAdd'); btn.disabled = true; say('Linking…', true);
    try {
      const d = await api('/tv', { method: 'POST', body: { target: $('tvTarget').value.trim(), mac: $('tvMac').value.trim(), label: $('tvLabel').value.trim() } });
      say(`Linked ${d.mac} to ${d.code}. It connects as soon as the TV is on the Wi-Fi.`, true); $('tvMac').value = ''; $('tvLabel').value = '';
    } catch (e) { say(e.message, false); } finally { btn.disabled = false; }
  };
})();
