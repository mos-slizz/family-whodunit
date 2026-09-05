/* Family Whodunit — audio: synthesized sound effects + recorded/spoken host voice */
(function () {
  const FW = window.FW || (window.FW = {});

  // FNV-1a 32-bit hash of UTF-8 text → 8 hex chars. Mirrored in tools/build_voice.py.
  FW.hashText = function (text) {
    const bytes = new TextEncoder().encode(text.trim());
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  };

  /* ---------------- Sound effects (WebAudio, no files) ---------------- */
  const SFX = { ctx: null, enabled: true, master: null };
  SFX.init = function () {
    if (SFX.ctx) return SFX.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    SFX.ctx = new AC();
    SFX.master = SFX.ctx.createGain();
    SFX.master.gain.value = 0.5;
    SFX.master.connect(SFX.ctx.destination);
    return SFX.ctx;
  };
  SFX.resume = function () { if (SFX.ctx && SFX.ctx.state === 'suspended') SFX.ctx.resume(); };
  function tone(freq, t0, dur, type, vol, slideTo) {
    const c = SFX.ctx; if (!c || !SFX.enabled) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(SFX.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, vol, filterFreq) {
    const c = SFX.ctx; if (!c || !SFX.enabled) return;
    const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = c.createGain(); g.gain.setValueAtTime(vol || 0.3, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(SFX.master); s.start(t0); s.stop(t0 + dur);
  }
  const now = () => (SFX.ctx ? SFX.ctx.currentTime : 0);
  SFX.play = function (name) {
    if (!SFX.ctx || !SFX.enabled) return;
    SFX.resume();
    const t = now();
    switch (name) {
      case 'pop': tone(600, t, 0.08, 'sine', 0.3, 900); break;
      case 'tick': tone(1200, t, 0.03, 'square', 0.08); break;
      case 'ding': tone(880, t, 0.5, 'sine', 0.3); tone(1320, t + 0.02, 0.5, 'sine', 0.15); break;
      case 'join': tone(523, t, 0.12, 'triangle', 0.3); tone(659, t + 0.1, 0.12, 'triangle', 0.3); tone(784, t + 0.2, 0.25, 'triangle', 0.3); break;
      case 'whoosh': noise(t, 0.35, 0.25, 3000); break;
      case 'sting': tone(220, t, 0.5, 'sawtooth', 0.25, 110); tone(233, t, 0.5, 'sawtooth', 0.2, 117); noise(t, 0.2, 0.2, 800); break;
      case 'clue': tone(392, t, 0.15, 'square', 0.15); tone(523, t + 0.15, 0.15, 'square', 0.15); tone(659, t + 0.3, 0.3, 'square', 0.15); break;
      case 'drumroll': for (let i = 0; i < 40; i++) noise(t + i * 0.075, 0.06, 0.25 + (i / 40) * 0.3, 900); break;
      case 'tada': [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.09, 0.6, 'triangle', 0.3)); tone(1319, t + 0.4, 0.9, 'triangle', 0.25); break;
      case 'boo': tone(300, t, 0.9, 'sawtooth', 0.25, 120); tone(302, t + 0.05, 0.9, 'sawtooth', 0.2, 121); break;
      case 'buzz': tone(140, t, 0.4, 'square', 0.25); tone(90, t, 0.4, 'square', 0.15); break;
      case 'vote': tone(700, t, 0.06, 'sine', 0.25); tone(1000, t + 0.07, 0.1, 'sine', 0.25); break;
      case 'suspense': tone(110, t, 2.5, 'sine', 0.25, 98); tone(165, t, 2.5, 'triangle', 0.1, 150); break;
      case 'react': tone(900, t, 0.05, 'sine', 0.15, 1400); break;
      case 'countdown': tone(660, t, 0.08, 'square', 0.12); break;
      case 'timeup': tone(440, t, 0.15, 'square', 0.2); tone(330, t + 0.18, 0.3, 'square', 0.2); break;
      case 'unlock': [659, 784, 988, 1319, 1568].forEach((f, i) => tone(f, t + i * 0.08, 0.5, 'sine', 0.25)); break;
      case 'spot': tone(1500, t, 0.05, 'sine', 0.1, 2000); break;
    }
  };
  FW.SFX = SFX;

  /* ---------------- Host voice: recorded clips with browser-speech fallback ---------------- */
  const Voice = { enabled: true, manifest: {}, base: 'audio/', queue: Promise.resolve(), current: null, onText: null, cache: {}, voiceName: null, rate: 1.0 };

  Voice.load = async function () {
    try {
      const r = await fetch(Voice.base + 'manifest.json', { cache: 'no-cache' });
      if (r.ok) { const m = await r.json(); (m.clips || []).forEach(h => Voice.manifest[h] = true); Voice.ext = m.ext || 'mp3'; }
    } catch (e) { /* no recorded clips available; browser speech only */ }
  };

  function playClip(hash) {
    return new Promise((resolve) => {
      let a = Voice.cache[hash];
      if (!a) { a = new Audio(Voice.base + hash + '.' + (Voice.ext || 'mp3')); a.preload = 'auto'; Voice.cache[hash] = a; }
      try { a.currentTime = 0; } catch (e) {}
      let done = false; const finish = () => { if (!done) { done = true; Voice.current = null; resolve(); } };
      a.onended = finish; a.onerror = finish;
      Voice.current = a;
      const p = a.play();
      if (p && p.catch) p.catch(() => finish());
      setTimeout(finish, 20000);
    });
  }
  function speakFallback(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = Voice.rate; u.pitch = 1.0;
      const vs = speechSynthesis.getVoices();
      const pick = vs.find(v => Voice.voiceName && v.name === Voice.voiceName)
        || vs.find(v => /Google UK English Male/i.test(v.name)) || vs.find(v => /Google US English/i.test(v.name))
        || vs.find(v => /Daniel/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang));
      if (pick) u.voice = pick;
      u.onend = resolve; u.onerror = resolve;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      setTimeout(resolve, 15000);
    });
  }
  Voice.preload = function (texts) { texts.forEach(t => { const h = FW.hashText(t); if (Voice.manifest[h] && !Voice.cache[h]) { const a = new Audio(Voice.base + h + '.' + (Voice.ext || 'mp3')); a.preload = 'auto'; Voice.cache[h] = a; } }); };

  // say(parts): parts is a string or array of strings. Each part is a separately recorded clip.
  // Returns a promise that resolves when the whole line has been spoken. Lines are queued.
  Voice.say = function (parts, display) {
    const list = (Array.isArray(parts) ? parts : [parts]).filter(Boolean);
    if (Voice.onText) Voice.onText(display || list.join('  '));
    if (!Voice.enabled || !list.length) return Promise.resolve();
    const job = async () => {
      for (const p of list) {
        if (!Voice.enabled) break;
        const h = FW.hashText(p);
        if (Voice.manifest[h]) await playClip(h); else await speakFallback(p);
      }
    };
    Voice.queue = Voice.queue.then(job, job);
    return Voice.queue;
  };
  Voice.stop = function () {
    if (Voice.current) { try { Voice.current.pause(); } catch (e) {} Voice.current = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    Voice.queue = Promise.resolve();
  };
  FW.Voice = Voice;
})();
