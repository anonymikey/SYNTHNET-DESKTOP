/* Animated M-Pesa payment popup for the captive portal.
   States: sending -> prompt (waiting for the PIN) -> success | failed.   Pure CSS/SVG, no libraries, ES5-style for old
   captive-portal browsers. All text goes through textContent (never innerHTML). Respects "reduce motion" and the portal's
   animation switch (body[data-anim="off"]).

   API: PayPopup.open({ name, amount, masked })   PayPopup.prompt(totalSec)   PayPopup.activating()
        PayPopup.success({ name, expires })       PayPopup.fail(message, { onRetry, onManual })
        PayPopup.close()   PayPopup.onCancel = function () {}   PayPopup.isOpen()                                   */
(function (root) {
  var CSS = '' +
    '.pm{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:center;padding:0;font-family:inherit}' +
    '@media (min-width:480px){.pm{align-items:center;padding:1rem}}' +
    '.pm[hidden]{display:none}' +
    '.pm-bg{position:absolute;inset:0;background:rgba(2,6,23,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:pmFade .25s ease both}' +
    '.pm-card{position:relative;width:100%;max-width:26rem;border-radius:1.75rem 1.75rem 0 0;padding:1.6rem 1.35rem 1.4rem;text-align:center;color:#e2e8f0;overflow:hidden;' +
    'background:linear-gradient(160deg,#0f172a,#111c33 60%,#0b1220);border:1px solid rgba(52,211,153,.28);box-shadow:0 -10px 60px -10px rgba(16,185,129,.35);animation:pmUp .45s cubic-bezier(.2,.9,.25,1) both;padding-bottom:calc(1.4rem + env(safe-area-inset-bottom,0px))}' +
    '@media (min-width:480px){.pm-card{border-radius:1.75rem;box-shadow:0 30px 80px -20px rgba(16,185,129,.4)}}' +
    '.pm-card::before{content:"";position:absolute;width:16rem;height:16rem;left:50%;top:-9rem;margin-left:-8rem;border-radius:50%;background:radial-gradient(circle,rgba(52,211,153,.28),transparent 68%);pointer-events:none}' +
    '.pm-card.pm-bad::before{background:radial-gradient(circle,rgba(251,113,133,.28),transparent 68%)}' +
    '.pm-body{position:relative}' +
    '.pm-amount{font-size:.72rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7}' +
    '.pm-title{margin:.25rem 0 0;font-size:1.45rem;line-height:1.2;font-weight:800;color:#fff}' +
    '.pm-sub{margin:.45rem auto 0;max-width:21rem;font-size:.88rem;line-height:1.45;color:#94a3b8}' +
    '.pm-sub b{color:#e2e8f0}' +
    '.pm-art{position:relative;height:7.2rem;margin:.9rem auto .2rem;width:7.2rem;display:grid;place-items:center}' +
    /* ring countdown */
    '.pm-ring{position:absolute;inset:0;transform:rotate(-90deg)}' +
    '.pm-ring circle{fill:none;stroke-width:5;stroke-linecap:round}' +
    '.pm-ring .t{stroke:rgba(148,163,184,.18)}.pm-ring .p{stroke:#34d399;transition:stroke-dashoffset 1s linear}' +
    /* phone */
    '.pm-phone{position:relative;width:2.7rem;height:4.4rem;border-radius:.8rem;border:2px solid #cbd5e1;background:linear-gradient(180deg,#1e293b,#0f172a);transform-origin:50% 80%;animation:pmRing 2.4s ease-in-out infinite}' +
    '.pm-phone::before{content:"";position:absolute;left:50%;top:.25rem;width:.9rem;height:.2rem;margin-left:-.45rem;border-radius:.2rem;background:#475569}' +
    '.pm-phone i{position:absolute;left:.4rem;right:.4rem;top:.8rem;bottom:.8rem;border-radius:.4rem;background:linear-gradient(180deg,#34d399,#059669);opacity:.9;animation:pmGlow 1.2s ease-in-out infinite alternate}' +
    '.pm-phone i::after{content:"M-PESA";position:absolute;left:0;right:0;top:42%;font:800 .44rem/1 system-ui,sans-serif;letter-spacing:.06em;color:#022c22}' +
    '.pm-wave{position:absolute;inset:.9rem;border-radius:50%;border:2px solid rgba(52,211,153,.55);animation:pmWave 2.4s ease-out infinite}.pm-wave.w2{animation-delay:.8s}.pm-wave.w3{animation-delay:1.6s}' +
    /* spinner */
    '.pm-spin{width:3.2rem;height:3.2rem;border-radius:50%;border:4px solid rgba(148,163,184,.2);border-top-color:#34d399;animation:pmSpin .8s linear infinite}' +
    /* success check */
    '.pm-ok{width:5.2rem;height:5.2rem}.pm-ok .c{fill:rgba(16,185,129,.16);stroke:#34d399;stroke-width:3;stroke-dasharray:226;stroke-dashoffset:226;animation:pmDraw .6s .1s ease forwards}' +
    '.pm-ok .k{fill:none;stroke:#34d399;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:50;stroke-dashoffset:50;animation:pmDraw .45s .55s ease forwards}' +
    '.pm-no{width:5.2rem;height:5.2rem}.pm-no .c{fill:rgba(244,63,94,.14);stroke:#fb7185;stroke-width:3;stroke-dasharray:226;stroke-dashoffset:226;animation:pmDraw .6s .1s ease forwards}' +
    '.pm-no .k{fill:none;stroke:#fb7185;stroke-width:5;stroke-linecap:round;stroke-dasharray:40;stroke-dashoffset:40;animation:pmDraw .4s .55s ease forwards}' +
    '.pm-pop{animation:pmPop .5s cubic-bezier(.2,1.4,.4,1) both}' +
    /* steps */
    '.pm-steps{display:flex;justify-content:space-between;gap:.4rem;margin:1.1rem 0 .2rem;text-align:center}' +
    '.pm-step{flex:1;font-size:.68rem;line-height:1.25;color:#64748b}' +
    '.pm-dot{display:grid;place-items:center;width:1.55rem;height:1.55rem;margin:0 auto .3rem;border-radius:50%;border:2px solid #334155;font-size:.72rem;font-weight:800;color:#64748b;background:#0f172a;transition:all .3s}' +
    '.pm-step.done{color:#a7f3d0}.pm-step.done .pm-dot{border-color:#34d399;background:#34d399;color:#022c22}' +
    '.pm-step.now{color:#fff}.pm-step.now .pm-dot{border-color:#34d399;color:#6ee7b7;animation:pmBeat 1.3s ease-in-out infinite}' +
    '.pm-time{margin-top:.55rem;font-size:.78rem;color:#94a3b8;font-variant-numeric:tabular-nums}' +
    '.pm-time b{color:#e2e8f0}' +
    /* buttons */
    '.pm-btns{display:flex;flex-direction:column;gap:.55rem;margin-top:1.1rem}' +
    '.pm-btn{display:block;width:100%;border:0;border-radius:.9rem;padding:.8rem 1rem;font-size:.95rem;font-weight:800;cursor:pointer;color:#022c22;background:linear-gradient(135deg,#6ee7b7,#34d399);box-shadow:0 8px 24px -8px rgba(52,211,153,.6)}' +
    '.pm-btn:active{transform:scale(.98)}.pm-btn.alt{background:#1e293b;color:#e2e8f0;box-shadow:none;border:1px solid #334155}' +
    '.pm-link{background:none;border:0;color:#94a3b8;font-size:.8rem;text-decoration:underline;cursor:pointer;padding:.3rem}' +
    '.pm-detail{margin:.9rem 0 0;padding:.7rem .9rem;border-radius:.9rem;background:rgba(15,23,42,.8);border:1px solid #1e293b;font-size:.82rem;color:#cbd5e1;text-align:left}' +
    '.pm-detail div{display:flex;justify-content:space-between;gap:.8rem;padding:.12rem 0}.pm-detail span{color:#64748b}.pm-detail b{font-weight:700;color:#e2e8f0;text-align:right}' +
    /* confetti */
    '.pm-conf{position:absolute;left:50%;top:5.2rem;width:0;height:0;pointer-events:none}' +
    '.pm-conf i{position:absolute;width:.5rem;height:.8rem;border-radius:.12rem;opacity:0;animation:pmConf 1.5s ease-out forwards}' +
    '@keyframes pmFade{from{opacity:0}to{opacity:1}}@keyframes pmUp{from{opacity:0;transform:translateY(40px) scale(.97)}to{opacity:1;transform:none}}' +
    '@keyframes pmSpin{to{transform:rotate(360deg)}}@keyframes pmDraw{to{stroke-dashoffset:0}}@keyframes pmPop{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}' +
    '@keyframes pmRing{0%,60%,100%{transform:rotate(0)}6%{transform:rotate(-9deg)}12%{transform:rotate(9deg)}18%{transform:rotate(-8deg)}24%{transform:rotate(8deg)}30%{transform:rotate(-5deg)}36%{transform:rotate(4deg)}}' +
    '@keyframes pmWave{0%{transform:scale(.55);opacity:.9}100%{transform:scale(1.5);opacity:0}}@keyframes pmGlow{from{opacity:.65}to{opacity:1}}' +
    '@keyframes pmBeat{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}50%{box-shadow:0 0 0 7px rgba(52,211,153,0)}}' +
    '@keyframes pmConf{0%{opacity:1;transform:translate(0,0) rotate(0)}100%{opacity:0;transform:translate(var(--x),var(--y)) rotate(var(--r))}}' +
    'body[data-anim="off"] .pm *,body[data-anim="off"] .pm-card,body[data-anim="off"] .pm-bg{animation-duration:.001s!important;animation-iteration-count:1!important}' +
    '@media (prefers-reduced-motion:reduce){.pm *,.pm-card,.pm-bg{animation-duration:.001s!important;animation-iteration-count:1!important}.pm-conf{display:none}}';

  var COLORS = ['#34d399', '#6ee7b7', '#fbbf24', '#38bdf8', '#f472b6', '#a78bfa'];
  var root_el = null, body_el = null, state = null, ringTimer = null, endAt = 0, totalSec = 150, prevOverflow = '';
  var api = { onCancel: null };

  function n(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svg(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }   // static markup only, no user text
  function ensure() {
    if (root_el) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root_el = n('div', 'pm'); root_el.hidden = true; root_el.setAttribute('role', 'dialog'); root_el.setAttribute('aria-modal', 'true'); root_el.setAttribute('aria-live', 'polite');
    root_el.appendChild(n('div', 'pm-bg'));
    var card = n('div', 'pm-card'); body_el = n('div', 'pm-body'); card.appendChild(body_el); root_el.appendChild(card);
    document.body.appendChild(root_el);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state && (state === 'success' || state === 'failed')) api.close(); });
  }
  function card() { return root_el.querySelector('.pm-card'); }
  function reset(bad) { stopRing(); body_el.replaceChildren ? body_el.replaceChildren() : (body_el.innerHTML = ''); card().className = 'pm-card' + (bad ? ' pm-bad' : ''); }
  function stopRing() { if (ringTimer) { clearInterval(ringTimer); ringTimer = null; } }
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60); }

  function steps(active) {
    var wrap = n('div', 'pm-steps'), labels = ['Request sent', 'Enter your PIN', 'Getting you online'];
    for (var i = 0; i < 3; i++) {
      var s = n('div', 'pm-step ' + (i < active ? 'done' : i === active ? 'now' : '')); s.appendChild(n('div', 'pm-dot', i < active ? '\u2713' : String(i + 1))); s.appendChild(n('div', null, labels[i])); wrap.appendChild(s);
    }
    return wrap;
  }
  function head(kicker, title, sub) {
    var f = document.createDocumentFragment();
    if (kicker) f.appendChild(n('div', 'pm-amount', kicker));
    f.appendChild(n('h2', 'pm-title', title));
    if (sub) { var p = n('p', 'pm-sub'); if (typeof sub === 'string') p.textContent = sub; else p.appendChild(sub); f.appendChild(p); }
    return f;
  }
  function bold(before, strong, after) { var f = document.createDocumentFragment(); f.appendChild(document.createTextNode(before)); f.appendChild(n('b', null, strong)); f.appendChild(document.createTextNode(after || '')); return f; }
  function kick() { return 'KSh ' + (api._amount || '') + (api._name ? ' \u00b7 ' + api._name : ''); }

  api.isOpen = function () { return !!root_el && !root_el.hidden; };

  api.open = function (o) {
    ensure(); o = o || {};
    api._name = o.name || ''; api._amount = o.amount || ''; api._masked = o.masked || '';
    prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    root_el.hidden = false; state = 'sending'; reset(false);
    var art = n('div', 'pm-art'); art.appendChild(n('div', 'pm-spin')); body_el.appendChild(head(kick(), 'Sending request\u2026', api._masked ? bold('Contacting M-Pesa for ', api._masked) : 'Contacting M-Pesa'));
    body_el.insertBefore(art, body_el.children[1]);
    body_el.appendChild(steps(0));
  };

  api.prompt = function (secs) {
    ensure(); totalSec = secs || 150; endAt = Date.now() + totalSec * 1000; state = 'prompt'; reset(false); root_el.hidden = false;
    body_el.appendChild(head(kick(), 'Check your phone', bold('An M-Pesa prompt was sent to ', api._masked || 'your phone', '. Enter your PIN to pay.')));
    var art = n('div', 'pm-art');
    var ring = svg('<svg class="pm-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="t" cx="50" cy="50" r="46"/><circle class="p" cx="50" cy="50" r="46" stroke-dasharray="289" stroke-dashoffset="0"/></svg>');
    art.appendChild(ring); art.appendChild(n('div', 'pm-wave')); art.appendChild(n('div', 'pm-wave w2')); art.appendChild(n('div', 'pm-wave w3'));
    var ph = n('div', 'pm-phone'); ph.appendChild(document.createElement('i')); art.appendChild(ph);
    body_el.insertBefore(art, body_el.children[1]); body_el.appendChild(steps(1));
    var time = n('div', 'pm-time'); time.appendChild(document.createTextNode('Request expires in ')); var b = n('b', null, fmt(totalSec)); time.appendChild(b); body_el.appendChild(time);
    var btns = n('div', 'pm-btns'); var cancel = n('button', 'pm-link', 'Cancel'); cancel.type = 'button';
    cancel.onclick = function () { api.close(); if (api.onCancel) api.onCancel(); };
    btns.appendChild(cancel); body_el.appendChild(btns);
    body_el.appendChild(n('p', 'pm-sub', 'Closed this page by accident? If you already paid, you will be connected automatically.'));
    var p = ring.querySelector('.p');
    function frame() { var left = (endAt - Date.now()) / 1000; b.textContent = fmt(left); p.style.strokeDashoffset = String(289 * (1 - Math.max(0, left) / totalSec)); }
    frame(); ringTimer = setInterval(frame, 1000);
  };

  api.activating = function () {
    if (!api.isOpen() || state === 'success') return;
    state = 'activating'; reset(false);
    var art = n('div', 'pm-art'); art.appendChild(n('div', 'pm-spin'));
    body_el.appendChild(head(kick(), 'Payment received!', 'Switching your internet on\u2026')); body_el.insertBefore(art, body_el.children[1]); body_el.appendChild(steps(2));
  };

  function confetti(host) {
    var c = n('div', 'pm-conf'); host.appendChild(c);
    for (var i = 0; i < 26; i++) {
      var p = document.createElement('i'), ang = (Math.PI * 2 * i) / 26 + Math.random() * .4, d = 70 + Math.random() * 110;
      p.style.background = COLORS[i % COLORS.length]; p.style.setProperty('--x', Math.cos(ang) * d + 'px'); p.style.setProperty('--y', (Math.sin(ang) * d - 20 + Math.random() * 40) + 'px'); p.style.setProperty('--r', (Math.random() * 540 - 270) + 'deg');
      p.style.animationDelay = (Math.random() * .12) + 's'; c.appendChild(p);
    }
  }

  api.success = function (o) {
    ensure(); o = o || {}; state = 'success'; reset(false); root_el.hidden = false;
    var art = n('div', 'pm-art pm-pop'); art.appendChild(svg('<svg class="pm-ok" viewBox="0 0 80 80" aria-hidden="true"><circle class="c" cx="40" cy="40" r="36"/><path class="k" d="M24 41l11 11 21-23"/></svg>'));
    body_el.appendChild(head('Payment confirmed', "You're online!", 'Enjoy your internet. Your package timer has started.'));
    body_el.insertBefore(art, body_el.children[1]);
    var d = n('div', 'pm-detail'), rows = [['Package', o.name || api._name], ['Paid', api._amount ? 'KSh ' + api._amount : ''], ['Valid until', o.expires || ''], ['M-Pesa receipt', o.receipt || '']];
    for (var i = 0; i < rows.length; i++) if (rows[i][1]) { var r = document.createElement('div'); r.appendChild(n('span', null, rows[i][0])); r.appendChild(n('b', null, rows[i][1])); d.appendChild(r); }
    body_el.appendChild(d);
    var btns = n('div', 'pm-btns'), go = n('button', 'pm-btn', 'Start browsing'); go.type = 'button'; go.onclick = api.close; btns.appendChild(go); body_el.appendChild(btns);
    confetti(body_el);
    setTimeout(function () { try { go.focus(); } catch (e) {} }, 400);
  };

  api.fail = function (message, o) {
    ensure(); o = o || {}; state = 'failed'; reset(true); root_el.hidden = false;
    var art = n('div', 'pm-art pm-pop'); art.appendChild(svg('<svg class="pm-no" viewBox="0 0 80 80" aria-hidden="true"><circle class="c" cx="40" cy="40" r="36"/><path class="k" d="M28 28l24 24M52 28L28 52"/></svg>'));
    body_el.appendChild(head('Payment not completed', o.title || 'No payment made', message || 'The payment did not go through.'));
    body_el.insertBefore(art, body_el.children[1]);
    var btns = n('div', 'pm-btns');
    if (o.onRetry) { var again = n('button', 'pm-btn', 'Try again'); again.type = 'button'; again.onclick = function () { api.close(); o.onRetry(); }; btns.appendChild(again); }
    if (o.onManual) { var man = n('button', 'pm-btn alt', 'Pay manually instead'); man.type = 'button'; man.onclick = function () { api.close(); o.onManual(); }; btns.appendChild(man); }
    var close = n('button', 'pm-link', 'Close'); close.type = 'button'; close.onclick = api.close; btns.appendChild(close);
    body_el.appendChild(btns);
  };

  api.close = function () {
    if (!root_el) return;
    stopRing(); root_el.hidden = true; state = null; document.body.style.overflow = prevOverflow;
  };

  root.PayPopup = api;
})(window);
