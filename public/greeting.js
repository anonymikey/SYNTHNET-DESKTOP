/* Time-of-day greeting for the captive portal. Shared by the portal and the admin live preview.
   Time is ALWAYS Nairobi (EAT = UTC+3, no daylight saving), computed from the SERVER's clock so a phone with a wrong
   date/time still shows the right greeting. Plain ES5-style code on purpose: captive-portal mini browsers can be old.
   Text is inserted with textContent only (never innerHTML), so admin-typed wording can't inject markup. */
(function (root) {
  var EAT_MS = 3 * 3600 * 1000;
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Nairobi wall-clock parts for any instant.
  function eat(ms) {
    var d = new Date(ms + EAT_MS);
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: DAYS[d.getUTCDay()], day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] };
  }
  function clockText(ms) {
    var p = eat(ms), h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
    return p.weekday.slice(0, 3) + ' ' + p.day + ' ' + p.month + ' \u00b7 ' + h12 + ':' + (p.minute < 10 ? '0' : '') + p.minute + ' ' + (p.hour < 12 ? 'AM' : 'PM') + ' EAT';
  }

  // The period whose start hour is the latest one at or before `hour`; before the earliest start it wraps to the last
  // period (e.g. with starts 5/12/17/21, hour 3 belongs to the 21:00 period).
  function resolve(periods, hour) {
    if (!periods || !periods.length) return null;
    var sorted = periods.slice().sort(function (a, b) { return a.start - b.start; }), pick = sorted[sorted.length - 1];
    for (var i = 0; i < sorted.length; i++) if (sorted[i].start <= hour) pick = sorted[i];
    return pick;
  }

  function fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? '' : vars[k]; }).replace(/\s{2,}/g, ' ').trim();
  }

  var CSS = '' +
    '.gr{--ar:56,189,248;--br:99,102,241;position:relative;overflow:hidden;border-radius:1.5rem;padding:1.1rem 1.15rem;display:flex;align-items:center;gap:.95rem;' +
    'border:1px solid rgba(var(--ar),.38);background:linear-gradient(135deg,rgba(var(--ar),.22),rgba(var(--br),.12) 55%,rgba(15,23,42,.72));' +
    'box-shadow:0 14px 40px -14px rgba(var(--ar),.5),inset 0 1px 0 rgba(255,255,255,.09);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}' +
    '.gr::before{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.10) 50%,transparent 65%);transform:translateX(-120%);animation:grShine 8s ease-in-out 1.5s infinite;pointer-events:none}' +
    '.gr-glow{position:absolute;width:12rem;height:12rem;right:-3.5rem;top:-5rem;border-radius:50%;background:radial-gradient(circle,rgba(var(--br),.5),transparent 65%);pointer-events:none}' +
    '.gr-orb{position:relative;flex:none;width:3.75rem;height:3.75rem;border-radius:50%;display:grid;place-items:center;font-size:1.95rem;line-height:1;' +
    'background:radial-gradient(circle at 30% 25%,rgba(255,255,255,.38),rgba(var(--ar),.36) 45%,rgba(var(--br),.26));box-shadow:0 0 0 1px rgba(255,255,255,.18) inset,0 10px 26px -6px rgba(var(--ar),.75)}' +
    '.gr-orb span{display:block;animation:grFloat 4.5s ease-in-out infinite}' +
    '.gr-orb::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:1px solid rgba(var(--ar),.6);animation:grRing 3.4s ease-out infinite}' +
    '.gr-body{position:relative;min-width:0;flex:1}' +
    '.gr-kicker{margin:0;font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.62)}' +
    '.gr-title{margin:.12rem 0 0;font-size:1.6rem;line-height:1.15;font-weight:800;letter-spacing:-.01em;color:#fff;overflow-wrap:anywhere}' +
    '@supports ((-webkit-background-clip:text) or (background-clip:text)){.gr-title{background:linear-gradient(90deg,#fff 35%,rgb(var(--ar)));-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}}' +
    '.gr-sub{margin:.32rem 0 0;font-size:.84rem;line-height:1.4;color:rgba(226,232,240,.88);overflow-wrap:anywhere}' +
    '.gr-enter{animation:grIn .75s cubic-bezier(.2,.8,.2,1) both}' +
    '.gr-a-sunrise{--ar:251,191,36;--br:251,113,133}.gr-a-sky{--ar:56,189,248;--br:99,102,241}.gr-a-sunset{--ar:251,146,60;--br:225,29,72}' +
    '.gr-a-night{--ar:129,140,248;--br:14,165,233}.gr-a-emerald{--ar:52,211,153;--br:6,182,212}.gr-a-violet{--ar:167,139,250;--br:236,72,153}' +
    '.gr-a-night .gr-glow{background:radial-gradient(circle at 30% 40%,rgba(255,255,255,.55) 0 1.5px,transparent 2.5px),radial-gradient(circle at 70% 25%,rgba(255,255,255,.45) 0 1.5px,transparent 2.5px),radial-gradient(circle at 55% 70%,rgba(255,255,255,.4) 0 1px,transparent 2px),radial-gradient(circle,rgba(var(--br),.4),transparent 65%);animation:grTwinkle 3.5s ease-in-out infinite}' +
    '@keyframes grIn{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}' +
    '@keyframes grShine{0%,60%,100%{transform:translateX(-120%)}85%{transform:translateX(120%)}}' +
    '@keyframes grFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}' +
    '@keyframes grRing{0%{transform:scale(.92);opacity:.85}100%{transform:scale(1.28);opacity:0}}' +
    '@keyframes grTwinkle{0%,100%{opacity:.75}50%{opacity:1}}' +
    'body[data-anim="off"] .gr,body[data-anim="off"] .gr *,body[data-anim="off"] .gr::before,body[data-anim="off"] .gr-orb::after{animation:none!important}' +
    '@media (prefers-reduced-motion:reduce){.gr,.gr *,.gr::before,.gr-orb::after{animation:none!important}}' +
    '@media (max-width:380px){.gr{padding:.95rem}.gr-orb{width:3.2rem;height:3.2rem;font-size:1.65rem}.gr-title{font-size:1.4rem}}';

  function ensureCss() {
    if (typeof document === 'undefined' || document.getElementById('grStyles')) return;
    var s = document.createElement('style'); s.id = 'grStyles'; s.textContent = CSS; document.head.appendChild(s);
  }
  function node(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* box: container element. g: { enabled, showClock, periods:[{id,start,emoji,accent,title,subtitle}] }.
     opts: { now (ms), brand, support, force (period id, used by the admin preview) }.
     Rebuilds the card only when the period/wording changes; otherwise just ticks the clock, so animations never restart. */
  function render(box, g, opts) {
    opts = opts || {};
    if (!g || !g.enabled) { box.setAttribute('hidden', ''); box.replaceChildren ? box.replaceChildren() : (box.innerHTML = ''); box.removeAttribute('data-key'); return false; }
    ensureCss();
    var now = opts.now != null ? opts.now : Date.now(), p = eat(now), period = null, i;
    if (opts.force) for (i = 0; i < g.periods.length; i++) if (g.periods[i].id === opts.force) period = g.periods[i];
    if (!period) period = resolve(g.periods, p.hour);
    if (!period) return false;
    var vars = { brand: opts.brand || '', support: opts.support || '', day: p.weekday };
    var title = fill(period.title, vars), sub = fill(period.subtitle, vars), emoji = period.emoji || '', kicker = g.showClock !== false ? clockText(now) : '';
    var key = [period.id, period.accent, emoji, title, sub, g.showClock !== false].join('|');

    if (box.getAttribute('data-key') === key && box.firstChild) { var k = box.querySelector('.gr-kicker'); if (k) k.textContent = kicker; box.removeAttribute('hidden'); return true; }

    var entering = box.getAttribute('data-period') !== period.id || !box.firstChild;
    var card = node('div', 'gr gr-a-' + (period.accent || 'sky') + (entering ? ' gr-enter' : ''));
    card.setAttribute('role', 'group'); card.setAttribute('aria-label', 'Greeting');
    card.appendChild(node('div', 'gr-glow'));
    if (emoji) { var orb = node('div', 'gr-orb'); orb.setAttribute('aria-hidden', 'true'); orb.appendChild(node('span', null, emoji)); card.appendChild(orb); }
    var body = node('div', 'gr-body');
    if (kicker) body.appendChild(node('p', 'gr-kicker', kicker));
    body.appendChild(node('h2', 'gr-title', title));
    if (sub) body.appendChild(node('p', 'gr-sub', sub));
    card.appendChild(body);
    box.replaceChildren ? box.replaceChildren(card) : (box.innerHTML = '', box.appendChild(card));
    box.setAttribute('data-key', key); box.setAttribute('data-period', period.id); box.removeAttribute('hidden');
    return true;
  }

  var api = { eat: eat, clockText: clockText, resolve: resolve, fill: fill, render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Greeting = api;
})(typeof window !== 'undefined' ? window : this);
