/* "You are connected" sound for the captive portal. Shared by the portal and the admin preview.
   - Ten built-in sounds, generated with the Web Audio API (no files to download, works offline), plus an optional uploaded sound.
   - HARD LIMIT: nothing ever plays longer than 2 seconds. Every note is clipped to fit and the whole output is faded out and
     stopped at 2.0 s, even for an uploaded file that is longer.
   - Phone browsers only allow sound after the person has touched the page, so the audio engine is unlocked on the first
     tap/keypress. If a browser still refuses, the sound is silently skipped (the portal itself is never affected).
   Plain ES5-style code: captive-portal mini browsers can be old.

   API: ConnectSound.PRESETS  ConnectSound.plan(id)  ConnectSound.play({ preset, volume, customUrl })
        ConnectSound.preload(url)  ConnectSound.load(url)  ConnectSound.unlock()  ConnectSound.MAX_SECONDS                                     */
(function (root) {
  var MAX = 2.0;            // seconds, absolute ceiling
  var FADE = 0.12;          // the last 0.12 s fade out so a cut-off never clicks

  var PRESETS = [
    { id: 'beep', name: 'Little beep', hint: 'One short, clean beep' },
    { id: 'double', name: 'Double beep', hint: 'Two quick beeps' },
    { id: 'chime', name: 'Soft chime', hint: 'Rising four-note chime' },
    { id: 'success', name: 'Success', hint: 'Cheerful rising arpeggio' },
    { id: 'bell', name: 'Bell', hint: 'A single ringing bell' },
    { id: 'sparkle', name: 'Sparkle', hint: 'Quick glittering run' },
    { id: 'droplet', name: 'Droplet', hint: 'Two soft water pops' },
    { id: 'powerup', name: 'Power-up', hint: 'Rising sweep, game style' },
    { id: 'welcome', name: 'Welcome', hint: 'Warm, gentle chord' },
    { id: 'fanfare', name: 'Fanfare', hint: 'Short triumphant call' }
  ];

  // A voice: { type, f (Hz), f2 (optional end Hz for a sweep), s (start s), d (length s), g (gain), a (attack s), decay (true = ring out), lp (optional low-pass Hz) }
  function v(type, f, s, d, g, extra) { var o = { type: type, f: f, s: s, d: d, g: g, a: 0.008, decay: false }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
  function sequence(type, freqs, gap, d, g, extra) { var out = []; for (var i = 0; i < freqs.length; i++) out.push(v(type, freqs[i], i * gap, d, g, extra)); return out; }
  function bellPartials(f, d) { return [v('sine', f, 0, d, 0.55, { decay: true }), v('sine', f * 2.01, 0, d * 0.8, 0.28, { decay: true }), v('sine', f * 2.76, 0, d * 0.55, 0.18, { decay: true }), v('sine', f * 5.4, 0, d * 0.3, 0.08, { decay: true })]; }

  var BUILD = {
    beep: function () { return [v('sine', 1046, 0, 0.22, 0.9, { a: 0.006 })]; },
    double: function () { return [v('sine', 988, 0, 0.14, 0.9), v('sine', 988, 0.24, 0.14, 0.9)]; },
    chime: function () { return sequence('sine', [523.25, 659.25, 783.99, 1046.5], 0.17, 0.9, 0.5, { decay: true }).concat(sequence('sine', [1046.5, 1318.5, 1568, 2093], 0.17, 0.6, 0.12, { decay: true })); },
    success: function () { var f = [392, 523.25, 659.25, 784]; return sequence('triangle', f, 0.1, 0.16, 0.7).slice(0, 3).concat([v('triangle', f[3], 0.3, 0.5, 0.75, { decay: true })]); },
    bell: function () { return bellPartials(660, 1.7); },
    sparkle: function () { return sequence('sine', [1319, 1568, 1760, 2093, 2349, 2637, 3136, 3520, 3136, 2637], 0.075, 0.3, 0.35, { decay: true }); },
    droplet: function () { return [v('sine', 1200, 0, 0.18, 0.8, { f2: 420, a: 0.004 }), v('sine', 900, 0.26, 0.2, 0.6, { f2: 340, a: 0.004 })]; },
    powerup: function () { return [v('triangle', 280, 0, 0.55, 0.7, { f2: 1400, a: 0.02 }), v('sine', 1400, 0.55, 0.5, 0.55, { decay: true }), v('sine', 2100, 0.55, 0.35, 0.18, { decay: true })]; },
    welcome: function () { return [v('sine', 261.63, 0, 1.6, 0.38, { a: 0.18, release: 0.7 }), v('sine', 329.63, 0.1, 1.5, 0.34, { a: 0.18, release: 0.7 }), v('sine', 392, 0.2, 1.4, 0.34, { a: 0.18, release: 0.7 }), v('sine', 523.25, 0.5, 1.1, 0.22, { a: 0.2, release: 0.6 })]; },
    fanfare: function () { return [v('sawtooth', 523.25, 0, 0.15, 0.45, { lp: 2200 }), v('sawtooth', 523.25, 0.18, 0.15, 0.45, { lp: 2200 }), v('sawtooth', 523.25, 0.36, 0.15, 0.45, { lp: 2200 }), v('sawtooth', 659.25, 0.54, 0.7, 0.4, { lp: 2400, release: 0.3 }), v('sawtooth', 783.99, 0.54, 0.7, 0.35, { lp: 2400, release: 0.3 })]; }
  };

  // The schedule for a built-in sound, clipped so it can never exceed MAX seconds. Pure function (also used by the tests).
  // Clips every voice so the whole sound fits inside MAX seconds (a voice starting too late is dropped, a long one is shortened).
  function fit(voices) {
    var end = 0, out = [];
    for (var i = 0; i < voices.length; i++) {
      var o = voices[i]; if (o.s >= MAX - 0.02) continue;
      if (o.s + o.d > MAX) o.d = Math.max(0.02, MAX - o.s);
      out.push(o); if (o.s + o.d > end) end = o.s + o.d;
    }
    return { voices: out, duration: Math.min(MAX, end) };
  }
  function plan(id) {
    var p = fit((BUILD[id] || BUILD.beep)());
    return { id: BUILD[id] ? id : 'beep', voices: p.voices, duration: p.duration };
  }

  var ctx = null, unlocked = false, buffers = {}, loading = {};
  function getCtx() {
    if (ctx) return ctx;
    var C = root.AudioContext || root.webkitAudioContext; if (!C) return null;
    try { ctx = new C(); } catch (e) { ctx = null; }
    return ctx;
  }
  // Called on the first tap/keypress: resumes the engine and plays one silent sample (needed on iPhones).
  function unlock() {
    var c = getCtx(); if (!c) return;
    try {
      if (c.state === 'suspended') c.resume();
      if (!unlocked) { var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); unlocked = true; }
    } catch (e) { /* best effort */ }
  }
  if (typeof document !== 'undefined') ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (ev) { document.addEventListener(ev, unlock, { passive: true }); });

  // Fetches and decodes an uploaded sound. Returns a promise that resolves with the decoded audio, or null if it could not be used.
  function load(url) {
    if (!url) return Promise.resolve(null);
    if (buffers[url]) return Promise.resolve(buffers[url]);
    if (loading[url]) return loading[url];
    var c = getCtx(); if (!c || !root.fetch) return Promise.resolve(null);
    loading[url] = root.fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (ab) { return new Promise(function (ok, bad) { c.decodeAudioData(ab, ok, bad); }); })
      .then(function (buf) { buffers[url] = buf; loading[url] = null; return buf; }, function () { loading[url] = null; return null; });
    return loading[url];
  }
  function preload(url) { load(url); }

  function master(c, volume, t0) {
    var vol = Math.max(0.05, Math.min(1, (Number(volume) || 70) / 100)), m = c.createGain();
    m.gain.setValueAtTime(Math.pow(vol, 1.4) * 0.85, t0);
    m.gain.setValueAtTime(Math.pow(vol, 1.4) * 0.85, t0 + MAX - FADE); m.gain.linearRampToValueAtTime(0.0001, t0 + MAX);   // the 2-second ceiling
    m.connect(c.destination); return m;
  }

  function playBuiltIn(c, id, volume) {
    var t0 = c.currentTime + 0.02, m = master(c, volume, t0), p = plan(id);
    p.voices.forEach(function (o) {
      var osc = c.createOscillator(), g = c.createGain(), start = t0 + o.s, end = start + o.d;
      osc.type = o.type; osc.frequency.setValueAtTime(o.f, start);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, end);
      g.gain.setValueAtTime(0.0001, start); g.gain.linearRampToValueAtTime(o.g, start + o.a);
      if (o.decay) g.gain.exponentialRampToValueAtTime(0.0001, end);
      else { var rel = Math.min(o.release || 0.06, o.d * 0.6); g.gain.setValueAtTime(o.g, Math.max(start + o.a, end - rel)); g.gain.linearRampToValueAtTime(0.0001, end); }
      var node = osc;
      if (o.lp) { var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
      node.connect(g); g.connect(m);
      osc.start(start); osc.stop(end + 0.03);
    });
    return true;
  }

  function playBuffer(c, buf, volume) {
    var t0 = c.currentTime + 0.02, m = master(c, volume, t0), src = c.createBufferSource();
    src.buffer = buf; src.connect(m); src.start(t0); src.stop(t0 + MAX);                  // an uploaded file is cut at 2 s no matter how long it is
    return true;
  }

  // opts: { preset, volume 5-100, customUrl }. Returns true if it started, false if it could not (silently), or null if it is waiting for the browser to allow audio.
  function play(opts) {
    opts = opts || {}; var c = getCtx(); if (!c) return false;
    var go = function () {
      try {
        if (opts.preset === 'custom' && opts.customUrl) {
          var buf = buffers[opts.customUrl];
          if (buf) return playBuffer(c, buf, opts.volume);
          preload(opts.customUrl);                                                         // not decoded yet: use the beep this time
          return playBuiltIn(c, 'beep', opts.volume);
        }
        return playBuiltIn(c, opts.preset, opts.volume);
      } catch (e) { return false; }
    };
    if (c.state === 'running') return go();
    try { var r = c.resume(); if (r && r.then) { r.then(function () { if (c.state === 'running') go(); }, function () {}); return null; } } catch (e) { /* ignore */ }
    return false;
  }

  var api = { PRESETS: PRESETS, MAX_SECONDS: MAX, plan: plan, fit: fit, play: play, preload: preload, load: load, unlock: unlock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ConnectSound = api;
})(typeof window !== 'undefined' ? window : this);
