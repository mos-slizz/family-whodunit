/* Family Whodunit — TV host: owns all game state, renders the big screen, drives the phones. */
(function () {
  const FW = window.FW, D = window.FW_DATA, Voice = FW.Voice, SFX = FW.SFX;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byId = (list, id) => list.find((x) => x.id === id);
  const ATTRS = ['place', 'color', 'snack'];
  const POOL = { place: D.places, color: D.colors, snack: D.snacks };
  const ATTR_LABEL = { place: 'Where', color: 'Wearing', snack: 'Snack' };
  const line = (key) => rnd(D.lines[key]);

  /* ---------------- persistent storage ---------------- */
  const store = {
    get(k, def) { try { const v = localStorage.getItem('fw_' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('fw_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const G = {
    client: null, room: null, brokerIdx: 0, players: {}, order: [], phase: 'boot', phaseId: 0,
    caseNo: 0, casesTotal: 3, cur: null, timer: null, acted: new Set(),
    settings: Object.assign({ voice: true, sfx: true, cases: 3, browserVoice: '' }, store.get('settings', {})),
    house: Object.assign({ casesPlayed: 0, solved: 0, played: {} }, store.get('house', {})),
    profiles: store.get('profiles', {}), custom: store.get('custom', []), sessionCases: [], gamesPlayed: 0
  };
  const saveAll = () => { store.set('settings', G.settings); store.set('house', G.house); store.set('profiles', G.profiles); store.set('custom', G.custom); };
  const unlockedChars = () => D.characters.filter((c) => c.unlockAt <= G.house.casesPlayed);
  const rankFor = (pts) => { let r = D.ranks[0]; D.ranks.forEach((x) => { if (pts >= x.min) r = x; }); return r; };
  const profileOf = (name) => { const k = name.trim().toLowerCase(); if (!G.profiles[k]) G.profiles[k] = { name: name.trim(), points: 0, cases: 0, solved: 0, escaped: 0, games: 0, stickers: {} }; return G.profiles[k]; };

  /* ---------------- helpers over players ---------------- */
  const P = (pid) => G.players[pid];
  const active = () => G.order.map(P).filter((p) => p && !p.pending);
  const charOf = (p) => byId(D.characters, p.charId) || D.characters[0];
  const pub = (pid) => { const p = P(pid); return { pid, name: p.name, char: charOf(p).emoji, charName: charOf(p).name, junior: !!p.junior }; };
  const pubList = (except) => active().filter((p) => p.pid !== except).map((p) => pub(p.pid));
  const val = (attr, id) => byId(POOL[attr], id);
  const alibiView = (a) => ATTRS.map((k) => { const v = val(k, a[k]); return { attr: k, id: v.id, emoji: v.emoji, name: v.short, label: ATTR_LABEL[k] }; });
  const BGS = ['#9ec5ff', '#ffb3c6', '#b9f5c9', '#fff2a8', '#e0c3ff', '#ffd1a1', '#a7f0f4', '#f7c6a3', '#c9d6ff', '#ffc9f2', '#d4f7a1', '#ffe0b3', '#b3e5ff', '#f5b3b3', '#c8ffd9', '#e6e6e6'];
  const bgOf = (p) => BGS[Math.max(0, D.characters.findIndex((c) => c.id === p.charId)) % BGS.length];
  // polaroid mugshot card
  function mug(p, o) {
    o = o || {}; const c = charOf(p); const idx = G.order.indexOf(p.pid) + 1;
    return '<div class="mug' + (o.cls ? ' ' + o.cls : '') + '" id="' + (o.id || '') + '" data-pid="' + p.pid + '"><div class="pin ' + ['', 'b', 'g', 'y'][idx % 4] + '"></div>' +
      '<div class="photo" style="--bg:' + bgOf(p) + '"><span class="emo">' + c.emoji + '</span><span class="num">#' + String(idx).padStart(2, '0') + '</span></div>' +
      '<div class="nm">' + esc(p.name) + '</div><div class="cn">' + esc(c.name) + '</div>' + (o.extra || '') + '</div>';
  }

  /* ---------------- networking ---------------- */
  function publishBeacon() {
    FW.pub(G.client, FW.topic(G.room, 'host'), {
      t: 'host', ts: Date.now(), phase: G.phase, open: G.phase === 'lobby' || G.phase === 'end',
      players: G.order.map((pid) => ({ pid, name: P(pid).name, char: P(pid).charId })),
      chars: D.characters.map((c) => ({ id: c.id, emoji: c.emoji, name: c.name, locked: c.unlockAt > G.house.casesPlayed, taken: G.order.some((pid) => P(pid).charId === c.id) }))
    }, true);
  }
  function send(pid, screen) { const p = P(pid); if (!p) return; p.screen = Object.assign({ v: ++p.screenV, chief: !!p.chief }, screen); FW.pub(G.client, FW.topic(G.room, 'p/' + pid), p.screen, true); }
  function sendAll(fn) { active().forEach((p) => send(p.pid, fn(p))); }
  function secsLeft() { return G.timer ? Math.max(0, Math.ceil((G.timer.deadline - Date.now()) / 1000)) : 0; }

  async function connectAny() {
    for (let i = 0; i < FW.BROKERS.length; i++) {
      setStatus('Connecting to relay ' + (i + 1) + '/' + FW.BROKERS.length + ' (' + FW.BROKERS[i].name + ')…');
      try {
        const c = await FW.connect(i, { onMessage, onReconnect: () => setStatus('Reconnecting…'), onConnect: () => { setStatus(''); if (G.room && G.client) { G.client.subscribe(FW.topic(G.room, 'h')); publishBeacon(); } } }, 9000);
        G.client = c; G.brokerIdx = i; return c;
      } catch (e) { /* try next */ }
    }
    throw new Error('No relay reachable');
  }
  function setStatus(t) { $('#status').textContent = t; $('#status').hidden = !t; }

  function onMessage(topic, m) {
    if (!m || !m.pid) return;
    if (m.t === 'join') return onJoin(m);
    const p = P(m.pid); if (!p) { send(m.pid, { s: 'kicked', text: 'This game has already started. Ask the TV to start a new game, then scan again.' }); return; }
    p.connected = true; p.lastSeen = Date.now();
    if (m.t === 'hello') { if (p.screen) FW.pub(G.client, FW.topic(G.room, 'p/' + p.pid), p.screen, true); return; }
    if (m.t !== 'act') return;
    if (m.a === 'react') return showReaction(p, m.e);
    if (m.a === 'point') return showPoint(p, m.target);
    if (m.a === 'skip' && p.chief) return skipPhase();
    if (m.a === 'again' && p.chief && G.phase === 'end') return playAgain();
    if (m.a === 'start' && p.chief && G.phase === 'lobby') return startGame();
    handleAct(p, m);
  }
  function onJoin(m) {
    const name = String(m.name || '').trim().slice(0, 14) || 'Mystery Guest';
    let p = P(m.pid);
    const inLobby = G.phase === 'lobby' || G.phase === 'end';
    if (!p) {
      if (!unlockedChars().some((c) => c.id === m.char)) m.char = (unlockedChars().find((c) => !G.order.some((pid) => P(pid).charId === c.id)) || D.characters[0]).id;
      if (G.order.some((pid) => P(pid).charId === m.char)) { const free = unlockedChars().find((c) => !G.order.some((pid) => P(pid).charId === c.id)); if (free) m.char = free.id; }
      if (G.order.length >= 8) { send(m.pid, { s: 'kicked', text: 'The room is full (8 players).' }); return; }
      p = G.players[m.pid] = { pid: m.pid, name, charId: m.char, junior: !!m.junior, score: 0, stickers: {}, connected: true, screenV: 0, reactions: 0, streak: 0, pending: !inLobby, chief: G.order.length === 0 };
      G.order.push(m.pid);
      SFX.play('join');
      if (inLobby) { if (G.order.length <= 4) Voice.say(line('lobbyJoin')); }
      const prof = profileOf(name); prof.name = name;
    } else if (inLobby) {
      p.name = name; p.junior = !!m.junior; p.connected = true;
      if (m.char !== p.charId && !G.order.some((pid) => pid !== p.pid && P(pid).charId === m.char) && unlockedChars().some((c) => c.id === m.char)) p.charId = m.char;
    } else { p.connected = true; if (p.screen) { FW.pub(G.client, FW.topic(G.room, 'p/' + p.pid), p.screen, true); publishBeacon(); return; } }
    publishBeacon();
    if (p.pending) send(p.pid, { s: 'wait', title: 'Hang tight!', sub: 'You\'ll join the next game.', me: pub(p.pid) });
    else send(p.pid, { s: 'wait', title: p.chief ? 'You\'re the Chief!' : 'You\'re in!', sub: p.chief ? 'You can start the game from the TV or from here once 3 or more have joined.' : 'Look at the TV.', me: pub(p.pid), rank: rankFor(profileOf(p.name).points), canStart: p.chief && G.phase === 'lobby', count: active().length });
    if (G.phase === 'lobby') { renderLobby(); const ch = active().find((q) => q.chief); if (ch && ch.pid !== p.pid) send(ch.pid, { s: 'wait', title: 'You\'re the Chief!', sub: active().length >= 3 ? 'Everyone in? Start the game!' : 'Waiting for at least 3 players.', me: pub(ch.pid), rank: rankFor(profileOf(ch.name).points), canStart: true, count: active().length }); }
    if (G.phase === 'end') sendAll((q) => q.chief ? { s: 'wait', title: 'Ready for another?', sub: 'Tap Play Again on the TV or below.', me: pub(q.pid), canAgain: true } : { s: 'wait', title: 'Ready for another?', sub: 'Waiting for the Chief…', me: pub(q.pid) });
  }

  /* ---------------- timer ---------------- */
  function startTimer(secs, onDone) {
    clearTimer();
    if (G.cur && G.cur.twist === 'speed') secs = Math.max(6, Math.ceil(secs / 2));
    const id = G.phaseId;
    G.timer = { deadline: Date.now() + secs * 1000, total: secs, onDone, warned: false };
    G.timer.iv = setInterval(() => {
      if (G.phaseId !== id) return clearTimer();
      const left = secsLeft();
      drawTimer(left / secs, left);
      if (left <= 5 && left > 0) SFX.play('countdown');
      if (left <= 0) { const cb = G.timer.onDone; clearTimer(); SFX.play('timeup'); cb && cb(); }
    }, 250);
    drawTimer(1, secs);
  }
  function clearTimer() { if (G.timer) { clearInterval(G.timer.iv); G.timer = null; } drawTimer(0, 0); }
  function drawTimer(frac, left) {
    const el = $('#timer'); if (!left) { el.hidden = true; return; }
    el.hidden = false; el.querySelector('span').textContent = left;
    el.querySelector('circle.fg').style.strokeDashoffset = String(283 * (1 - frac));
    el.classList.toggle('urgent', left <= 5);
  }
  function guard() { const id = G.phaseId; return () => id === G.phaseId; }
  function setPhase(name) { G.phase = name; G.phaseId++; G.acted = new Set(); clearTimer(); document.body.dataset.phase = name; publishBeacon(); }
  function allActed() { return active().every((p) => G.acted.has(p.pid)); }
  let skipFn = null;
  function skipPhase() { if (skipFn) { const f = skipFn; skipFn = null; Voice.stop(); clearTimer(); f(); } }
  $('#btnSkip').addEventListener('click', skipPhase);

  /* ---------------- host bubble & strip ---------------- */
  Voice.onText = (t) => { const b = $('#bubble'); b.textContent = t; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); };
  function renderStrip(opts) {
    opts = opts || {};
    const list = active();
    $('#strip').innerHTML = list.map((p) => {
      const a = G.cur && G.cur.alibis && G.cur.alibis[p.pid] && opts.alibis;
      return mug(p, { id: 'sus-' + p.pid, extra: (a ? '<div class="al">' + alibiView(G.cur.alibis[p.pid]).map((v) => '<span title="' + v.name + '">' + v.emoji + '</span>').join('') + '</div>' : '') +
        '<div class="pts">' + p.score + '</div><div class="stk">' + Object.keys(p.stickers).map((k) => D.stickers[k].emoji).join('') + '</div><div class="rx"></div><div class="badge"></div>' });
    }).join('');
  }
  function showReaction(p, e) {
    if (!D.reactions.includes(e)) return; if (!['lineup', 'clue', 'board', 'final', 'vote', 'finalshow'].includes(G.phase)) return;
    if (p.lastReact && Date.now() - p.lastReact < 1500) return; p.lastReact = Date.now(); p.reactions++;
    const card = $('#sus-' + p.pid); if (!card) return; SFX.play('react');
    const el = document.createElement('div'); el.className = 'float'; el.textContent = e; el.style.left = (20 + Math.random() * 60) + '%';
    card.querySelector('.rx').appendChild(el); setTimeout(() => el.remove(), 2200);
  }
  function showPoint(p, target) {
    if (!P(target) || target === p.pid) return; if (!['lineup', 'clue', 'board', 'final', 'vote'].includes(G.phase)) return;
    if (p.lastPoint && Date.now() - p.lastPoint < 4000) return; p.lastPoint = Date.now(); p.reactions++;
    const t = P(target); SFX.play('whoosh');
    toast(charOf(p).emoji + ' ' + esc(p.name) + ' points at ' + charOf(t).emoji + ' ' + esc(t.name) + '!');
    const card = $('#sus-' + target); if (card) { card.classList.add('pointed'); setTimeout(() => card.classList.remove('pointed'), 2500); }
  }
  function toast(html) { const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html; $('#toasts').appendChild(t); setTimeout(() => t.classList.add('show'), 20); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000); }
  function stage(html, cls) { const s = $('#stage'); s.className = 'stage ' + (cls || ''); s.innerHTML = html; }
  function caseHeader() { return G.cur ? '<div class="casehdr">Case ' + G.caseNo + ' of ' + G.casesTotal + ' · ' + esc(G.cur.case.title) + (G.cur.twist ? ' · <b>' + byId(D.twists, G.cur.twist).emoji + ' ' + esc(byId(D.twists, G.cur.twist).name) + '</b>' : '') + '</div>' : ''; }

  /* ---------------- LOBBY ---------------- */
  async function enterLobby(keepPlayers) {
    setPhase('lobby'); G.cur = null; G.caseNo = 0;
    if (!keepPlayers) { G.players = {}; G.order = []; }
    else { active().forEach((p) => { p.score = 0; p.stickers = {}; p.streak = 0; p.pending = false; }); G.order.forEach((pid) => { P(pid).pending = false; }); }
    if (!G.room) {
      G.room = FW.makeRoomCode();
      try { await connectAny(); } catch (e) { setStatus('Could not reach any relay. Check the internet connection and reload.'); return; }
      G.client.subscribe(FW.topic(G.room, 'h'));
      setInterval(publishBeacon, 25000);
    }
    $('#roomtag').textContent = 'Room ' + G.room + ' · ' + joinUrl().replace(/^https?:\/\//, '').replace(/\?.*$/, '');
    publishBeacon(); renderLobby();
    Voice.say(line('lobby'));
  }
  function joinUrl() { const u = new URL(location.href); u.hash = ''; u.search = ''; u.pathname = u.pathname.replace(/tv\.html$/, ''); return u.toString() + '?r=' + G.room + '&b=' + G.brokerIdx; }
  function renderLobby() {
    const list = active();
    const url = joinUrl(); const shown = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
    stage('<div class="lobby"><div class="wanted"><div class="pin"></div><div class="wt">WANTED</div><div class="ws">DETECTIVES · SCAN TO JOIN</div><div id="qr"></div><div class="code">' + G.room + '</div><div class="url">or go to <b>' + esc(shown) + '</b><br>and enter the code</div></div>' +
      '<div class="lobbyright"><h1>Family Whodunit</h1><p class="tagline">One of you is guilty. Everyone is suspicious.</p>' +
      '<div class="joined">' + (list.length ? list.map((p) => { const r = rankFor(profileOf(p.name).points); return mug(p, { extra: '<div class="rk">' + r.emoji + ' ' + r.name + (p.chief ? ' · ⭐ Chief' : '') + (p.junior ? ' · 🧒' : '') + '</div>' }); }).join('') : '<div class="waiting">Waiting for detectives to join…</div>') + '</div>' +
      '<div class="lobbyctl"><label>Cases tonight <select id="selCases"><option value="3">3 · Quick (~12 min)</option><option value="5">5 · Standard</option><option value="7">7 · Marathon</option></select></label>' +
      '<button id="btnStart" class="big" ' + (list.length >= 3 ? '' : 'disabled') + '>' + (list.length >= 3 ? '▶ Start the game' : 'Need ' + (3 - list.length) + ' more player' + (3 - list.length > 1 ? 's' : '')) + '</button></div>' +
      '<div class="housestats">🗂️ Case file: ' + Object.keys(G.house.played).length + ' / ' + (D.cases.length + G.custom.length) + ' cases played · 🔓 ' + unlockedChars().length + ' / ' + D.characters.length + ' suspects unlocked</div></div></div>', 'lobbyStage');
    new QRCode($('#qr'), { text: url, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
    $('#voicetag').textContent = Object.keys(Voice.manifest).length ? '🎙️ recorded voice' : '🤖 browser voice (no recordings found)';
    $('#selCases').value = String(G.settings.cases); $('#selCases').onchange = (e) => { G.settings.cases = +e.target.value; saveAll(); };
    $('#btnStart').onclick = startGame;
    renderStrip();
  }

  /* ---------------- GAME START / CASE SETUP ---------------- */
  function startGame() {
    if (G.phase !== 'lobby' || active().length < 3) return;
    G.casesTotal = G.settings.cases; G.caseNo = 0; G.sessionCases = []; G.gamesPlayed++;
    active().forEach((p) => { p.score = 0; p.stickers = {}; p.streak = 0; profileOf(p.name).games++; });
    if (!active().some((p) => p.chief)) active()[0].chief = true;
    Voice.say(line('gameStart')).then(() => nextCase());
    stage('<div class="center"><h1>Let\'s begin…</h1></div>');
  }
  function pickCase() {
    const all = D.cases.concat(G.custom.map((c) => Object.assign({ custom: true }, c)));
    let pool = all.filter((c) => !G.sessionCases.includes(c.id));
    const fresh = pool.filter((c) => !G.house.played[c.id]);
    const customFresh = fresh.filter((c) => c.custom);
    if (customFresh.length && Math.random() < 0.6) return rnd(customFresh);
    return rnd(fresh.length ? fresh : pool);
  }
  function nextCase() {
    G.caseNo++;
    const list = active(); const n = list.length;
    const cs = pickCase(); G.sessionCases.push(cs.id);
    const pool = { place: shuffle(D.places).slice(0, 4).map((x) => x.id), color: shuffle(D.colors).slice(0, 4).map((x) => x.id), snack: shuffle(D.snacks).slice(0, 4).map((x) => x.id) };
    const truth = { place: rnd(pool.place), color: rnd(pool.color), snack: rnd(pool.snack) };
    // culprit: avoid repeating last case's culprit when possible
    let cands = list.filter((p) => p.pid !== G.lastCulprit); if (!cands.length) cands = list;
    const culprit = rnd(cands).pid; G.lastCulprit = culprit;
    // twist selection
    let twist = null;
    if (G.caseNo === 2 && n >= 4) twist = 'accomplice';
    else if (G.caseNo >= 3) { const opts = D.twists.filter((t) => t.minPlayers <= n && t.id !== G.lastTwist); twist = rnd(opts).id; }
    G.lastTwist = twist;
    let accomplice = null;
    if ((twist === 'accomplice' || P(culprit).junior) && n >= 4) accomplice = rnd(list.filter((p) => p.pid !== culprit)).pid;
    let chiefDet = null;
    if (twist === 'chief') chiefDet = rnd(list.filter((p) => p.pid !== culprit && p.pid !== accomplice)).pid;
    const alibis = {};
    list.forEach((p) => { if (p.pid !== culprit) alibis[p.pid] = { place: rnd(pool.place), color: rnd(pool.color), snack: rnd(pool.snack) }; });
    G.cur = { case: cs, pool, truth, culprit, accomplice, chiefDet, twist, alibis, clueOrder: shuffle(ATTRS), clueIdx: 0, statements: [], peeks: {}, finalWords: {}, votes: {}, voteOrder: [], culpritChosen: false };
    enterIntro();
  }

  /* ---------------- INTRO ---------------- */
  async function enterIntro() {
    setPhase('intro'); const ok = guard(); const c = G.cur.case;
    renderStrip();
    stage(caseHeader() + '<div class="casefile"><div class="polaroid"><div class="sc">' + c.emoji + '</div></div><div class="stamp">Confidential</div><h1>' + esc(c.title) + '</h1><p class="blurb">' + esc(c.blurb) + '</p>' + (G.cur.twist ? '<div class="twist">' + byId(D.twists, G.cur.twist).emoji + ' Twist: <b>' + esc(byId(D.twists, G.cur.twist).name) + '</b> · ' + esc(byId(D.twists, G.cur.twist).desc) + '</div>' : '') + '</div>');
    sendAll((p) => ({ s: 'wait', title: 'Case ' + G.caseNo, sub: '👀 Look at the TV', me: pub(p.pid) }));
    SFX.play('sting');
    skipFn = () => ok() && enterRoles();
    await Voice.say(line('caseIntro')); if (!ok()) return;
    await Voice.say([c.title, c.blurb], c.title + '. ' + c.blurb); if (!ok()) return;
    if (G.cur.twist) { SFX.play('clue'); await Voice.say([line('twist'), byId(D.twists, G.cur.twist).name + '. ' + byId(D.twists, G.cur.twist).desc]); if (!ok()) return; }
    else if (G.cur.accomplice) { await Voice.say(line('junior')); if (!ok()) return; }
    await sleep(800); if (ok()) enterRoles();
  }

  /* ---------------- ROLES ---------------- */
  function enterRoles() {
    setPhase('roles'); const ok = guard(); const cur = G.cur;
    stage(caseHeader() + '<div class="center"><div class="note"><div class="pin y"></div><h1>📱 Check your phone!</h1><p>Somebody in this room is guilty…</p></div><div id="ready" class="ready"></div></div>');
    Voice.say(line('roles'));
    const options = {}; ATTRS.forEach((k) => { options[k] = cur.pool[k].map((id) => { const v = val(k, id); return { id, emoji: v.emoji, name: v.short, safe: id !== cur.truth[k] }; }); });
    sendAll((p) => {
      const base = { s: 'role', me: pub(p.pid), secs: secsFor(35) };
      if (p.pid === cur.culprit) return Object.assign(base, { role: 'culprit', crime: { emoji: cur.case.emoji, title: cur.case.title }, truth: alibiView(cur.truth), options });
      if (p.pid === cur.accomplice) return Object.assign(base, { role: 'accomplice', alibi: alibiView(cur.alibis[p.pid]), culprit: pub(cur.culprit), truth: alibiView(cur.truth) });
      return Object.assign(base, { role: p.pid === cur.chiefDet ? 'chief' : 'innocent', alibi: alibiView(cur.alibis[p.pid]) });
    });
    renderReady();
    const done = () => { if (!ok()) return; if (!cur.culpritChosen) autoAlibi(); enterLineup(); };
    startTimer(35, done); skipFn = done;
  }
  function secsFor(s) { return G.cur && G.cur.twist === 'speed' ? Math.max(6, Math.ceil(s / 2)) : s; }
  function autoAlibi() { const cur = G.cur, a = {}; ATTRS.forEach((k) => { a[k] = rnd(cur.pool[k].filter((id) => id !== cur.truth[k])); }); cur.alibis[cur.culprit] = a; cur.culpritChosen = true; }
  function renderReady() { const el = $('#ready'); if (!el) return; el.innerHTML = active().map((p) => mug(p, { cls: G.acted.has(p.pid) ? 'ok' : '' })).join(''); }
  function markActed(p) { G.acted.add(p.pid); renderReady(); const card = $('#sus-' + p.pid); if (card) card.querySelector('.badge').textContent = '✓'; }

  /* ---------------- LINEUP ---------------- */
  async function enterLineup() {
    setPhase('lineup'); const ok = guard(); const cur = G.cur;
    const list = active();
    if (cur.accomplice) send(cur.accomplice, { s: 'discuss', me: pub(cur.accomplice), title: '🤝 Accomplice', sub: 'Your partner ' + charOf(P(cur.culprit)).emoji + ' ' + P(cur.culprit).name + ' claims: ' + alibiView(cur.alibis[cur.culprit]).map((v) => v.emoji).join(' ') + '. Back them up!', alibi: alibiView(cur.alibis[cur.accomplice]), players: pubList(cur.accomplice), secs: secsFor(25) });
    list.forEach((p) => { if (p.pid === cur.accomplice) return; send(p.pid, { s: 'discuss', me: pub(p.pid), title: p.pid === cur.culprit ? '🤫 Keep a straight face' : '🔍 Study the lineup', sub: p.pid === cur.culprit ? 'Your story: stick to it!' : 'Who looks shifty?', alibi: alibiView(cur.alibis[p.pid]), players: pubList(p.pid), secs: secsFor(25) }); });
    renderStrip({ alibis: true });
    stage(caseHeader() + '<h2 class="ph">The Lineup</h2><div class="lineup">' + list.map((p) => mug(p, { id: 'lc-' + p.pid, extra: '<div class="row">' + alibiView(cur.alibis[p.pid]).map((v) => '<div class="att"><div class="e">' + v.emoji + '</div><div class="l">' + v.name + '</div></div>').join('') + '</div>' })).join('') + '</div>');
    skipFn = () => ok() && enterClue(0);
    await Voice.say(line('lineup')); if (!ok()) return;
    for (const p of list) {
      if (!ok()) return; const a = cur.alibis[p.pid]; const c = charOf(p);
      const el = $('#lc-' + p.pid); if (el) { el.classList.add('lit'); SFX.play('pop'); }
      await Voice.say([c.name, 'was in', val('place', a.place).name, 'wearing', val('color', a.color).name, 'and eating', val('snack', a.snack).name], c.name + ' was in ' + val('place', a.place).name + ', wearing ' + val('color', a.color).name + ', and eating ' + val('snack', a.snack).name + '.');
      if (el) el.classList.remove('lit');
    }
    if (!ok()) return;
    await Voice.say(line('lineupAfter')); if (!ok()) return;
    startTimer(20, () => ok() && enterClue(0));
  }

  /* ---------------- CLUES ---------------- */
  async function enterClue(i) {
    setPhase('clue'); const ok = guard(); const cur = G.cur; cur.clueIdx = i;
    const attr = cur.clueOrder[i]; const v = val(attr, cur.truth[attr]); const text = rnd(v.clues);
    cur.cluesShown = cur.cluesShown || []; cur.cluesShown.push({ attr, text, emoji: v.emoji });
    sendAll((p) => ({ s: 'discuss', me: pub(p.pid), title: 'Clue ' + (i + 1) + ' of 3', sub: '👀 Watch the TV', alibi: alibiView(cur.alibis[p.pid]), players: pubList(p.pid), secs: secsFor(14) + 4, clues: cur.cluesShown.map((c) => c.emoji) }));
    renderStrip({ alibis: true });
    stage(caseHeader() + '<h2 class="ph">Clue ' + (i + 1) + ' of 3</h2><div class="cluewrap">' + cur.cluesShown.slice(0, -1).map((c, n) => '<div class="tag old"><div class="lab">EVIDENCE #' + (n + 1) + '</div><span>' + c.emoji + '</span>' + esc(c.text) + '</div>').join('') + '<div class="tag new" id="clueNew"><div class="lab">EVIDENCE #' + (i + 1) + '</div><div class="magnify">🔍</div></div></div>');
    skipFn = () => ok() && (i < 2 ? enterClue(i + 1) : enterWitness());
    await Voice.say(line(i === 0 ? 'clue1' : i === 1 ? 'clue2' : 'clue3')); if (!ok()) return;
    SFX.play('drumroll'); await sleep(1600); if (!ok()) return;
    SFX.play('clue');
    const el = $('#clueNew'); el.innerHTML = '<div class="lab">EVIDENCE #' + (i + 1) + '</div><span>' + v.emoji + '</span>' + esc(text); el.classList.add('reveal');
    await Voice.say(text); if (!ok()) return;
    const matches = active().filter((p) => cur.alibis[p.pid][attr] === cur.truth[attr]);
    matches.forEach((p) => { const c = $('#sus-' + p.pid); if (c) c.classList.add('match'); });
    if (cur.twist === 'blackout') setTimeout(() => { if (ok()) { el.innerHTML = '<div class="lab">EVIDENCE #' + (i + 1) + '</div><span>🔦</span>Blackout! Remember it?'; el.classList.add('dark'); } }, 5000);
    await Voice.say(matches.length ? line('clueMatch') : line('clueNoMatch')); if (!ok()) return;
    startTimer(14, () => { if (!ok()) return; if (i < 2) enterClue(i + 1); else enterWitness(); });
  }

  /* ---------------- WITNESS PEEKS ---------------- */
  function enterWitness() {
    setPhase('witness'); const ok = guard(); const cur = G.cur; const list = active();
    stage(caseHeader() + '<div class="center"><div class="note blue"><div class="pin"></div><h1>🗣️ Witnesses, check your phones!</h1><p>Everybody peeked at something. Tell the group what you saw…</p></div><div id="ready" class="ready"></div></div>');
    Voice.say(line('witness'));
    const truthOf = (pid) => pid === cur.culprit ? cur.truth : cur.alibis[pid];
    const attrOpts = {}; ATTRS.forEach((k) => { attrOpts[k] = cur.pool[k].map((id) => { const v = val(k, id); return { id, emoji: v.emoji, name: v.short }; }); });
    list.forEach((p) => {
      const isLiar = p.pid === cur.culprit || p.pid === cur.accomplice;
      if (isLiar) {
        send(p.pid, { s: 'witness', me: pub(p.pid), mode: 'liar', role: p.pid === cur.culprit ? 'culprit' : 'accomplice', players: pubList(p.pid), attrs: attrOpts, culpritAlibi: p.pid === cur.accomplice ? alibiView(cur.alibis[cur.culprit]) : null, culprit: p.pid === cur.accomplice ? pub(cur.culprit) : null, secs: secsFor(30) });
      } else {
        const n = p.pid === cur.chiefDet ? 2 : 1;
        const targets = shuffle(list.filter((q) => q.pid !== p.pid)).slice(0, n);
        const peeks = targets.map((t) => { const attr = rnd(ATTRS); const tv = truthOf(t.pid)[attr]; return { target: t.pid, attr, value: tv }; });
        cur.peeks[p.pid] = peeks;
        send(p.pid, { s: 'witness', me: pub(p.pid), mode: 'innocent', chief: p.pid === cur.chiefDet, peeks: peeks.map((k) => ({ target: pub(k.target), attr: k.attr, label: ATTR_LABEL[k.attr], value: { emoji: val(k.attr, k.value).emoji, name: val(k.attr, k.value).short } })), secs: secsFor(30) });
      }
    });
    renderReady();
    const done = () => {
      if (!ok()) return;
      // innocents who never tapped: auto-tell (nobody gets stuck)
      list.forEach((p) => { if (!G.acted.has(p.pid) && cur.peeks[p.pid]) cur.peeks[p.pid].forEach((k) => addStatement(p.pid, k.target, k.attr, k.value, true)); });
      enterBoard();
    };
    startTimer(30, done); skipFn = done;
  }
  function addStatement(from, target, attr, value, honest) {
    const cur = G.cur; if (!P(target) || !val(attr, value)) return;
    if (cur.statements.some((s) => s.from === from && s.target === target && s.attr === attr)) return;
    const declared = cur.alibis[target][attr];
    cur.statements.push({ from, target, attr, value, honest: !!honest, contradiction: declared !== value, exposes: honest && target === cur.culprit && declared !== value });
  }

  /* ---------------- WITNESS BOARD ---------------- */
  async function enterBoard() {
    setPhase('board'); const ok = guard(); const cur = G.cur;
    const sts = shuffle(cur.statements);
    if (cur.twist === 'serum') { const hon = sts.filter((s) => s.honest); if (hon.length) rnd(hon).verified = true; }
    sendAll((p) => ({ s: 'discuss', me: pub(p.pid), title: '🗣️ The witness board', sub: 'Who do you believe?', alibi: alibiView(cur.alibis[p.pid]), players: pubList(p.pid), secs: secsFor(22) + sts.length * 3, clues: (cur.cluesShown || []).map((c) => c.emoji) }));
    renderStrip({ alibis: true });
    stage(caseHeader() + '<h2 class="ph">The Witness Board</h2><div class="board" id="board">' + (sts.length ? '' : '<div class="nost">Nobody said a word. Suspicious.</div>') + '</div>');
    skipFn = () => ok() && enterFinal();
    await Voice.say(line('witnessBoard')); if (!ok()) return;
    let anyContra = false;
    for (const s of sts) {
      if (!ok()) return;
      const f = P(s.from), t = P(s.target); const v = val(s.attr, s.value);
      const el = document.createElement('div'); el.className = 'stmt' + (s.contradiction ? ' contra' : '') + (s.verified ? ' verified' : '');
      el.innerHTML = '<div class="who">' + charOf(f).emoji + ' <b>' + esc(f.name) + '</b> says:</div><div class="what">"I saw ' + charOf(t).emoji + ' <b>' + esc(t.name) + '</b> ' + (s.attr === 'place' ? 'in ' : s.attr === 'color' ? 'wearing ' : 'eating ') + v.emoji + ' <b>' + esc(v.short) + '</b>"</div>' + (s.contradiction ? '<div class="st">❗ Not what ' + esc(t.name) + ' said!</div>' : '<div class="st ok">✓ Matches their story</div>') + (s.verified ? '<div class="st ver">🧪 VERIFIED</div>' : '');
      $('#board').appendChild(el); SFX.play('pop');
      await sleep(2200);
      if (s.contradiction && !anyContra) { anyContra = true; SFX.play('buzz'); await Voice.say(line('contradiction')); }
    }
    if (!ok()) return;
    startTimer(22, () => ok() && enterFinal());
  }

  /* ---------------- FINAL WORDS ---------------- */
  function enterFinal() {
    setPhase('final'); const ok = guard(); const cur = G.cur;
    stage(caseHeader() + '<div class="center"><div class="note pink"><div class="pin g"></div><h1>🎤 Any final words?</h1><p>Pick your best defense on your phone.</p></div><div id="ready" class="ready"></div></div>');
    Voice.say(line('finalWords'));
    const used = new Set(); sendAll((p) => { const opts = shuffle(D.finalWords.filter((w) => !used.has(w))).slice(0, 4); opts.forEach((w) => used.add(w)); if (used.size > 16) used.clear(); return { s: 'final', me: pub(p.pid), options: opts, secs: secsFor(20) }; });
    renderReady();
    const done = () => { if (!ok()) return; active().forEach((p) => { if (!cur.finalWords[p.pid]) cur.finalWords[p.pid] = rnd(D.finalWords); }); enterFinalShow(); };
    startTimer(20, done); skipFn = done;
  }
  async function enterFinalShow() {
    setPhase('finalshow'); const ok = guard(); const cur = G.cur; const list = active();
    sendAll((p) => ({ s: 'discuss', me: pub(p.pid), title: '🎤 Final words', sub: '👀 Watch the TV', alibi: alibiView(cur.alibis[p.pid]), players: pubList(p.pid), secs: list.length * 4 }));
    renderStrip({ alibis: true });
    stage(caseHeader() + '<h2 class="ph">Final Words</h2><div class="fwgrid" id="fw"></div>');
    skipFn = () => ok() && enterVote();
    for (const p of list) {
      if (!ok()) return; const el = document.createElement('div'); el.className = 'fwcard'; el.innerHTML = mug(p) + '<div class="q">"' + esc(cur.finalWords[p.pid]) + '"</div>';
      $('#fw').appendChild(el); SFX.play('pop');
      await Voice.say(cur.finalWords[p.pid]); await sleep(300);
    }
    if (ok()) enterVote();
  }

  /* ---------------- VOTE ---------------- */
  function enterVote() {
    setPhase('vote'); const ok = guard(); const cur = G.cur;
    renderStrip({ alibis: true });
    stage(caseHeader() + '<div class="center"><div class="note"><div class="pin b"></div><h1>🗳️ Who did it?</h1><p>Vote on your phone!</p></div><div id="ready" class="ready"></div>' + (cur.cluesShown ? '<div class="recap">' + cur.cluesShown.map((c) => '<span>' + c.emoji + ' ' + esc(c.text) + '</span>').join('') + '</div>' : '') + '</div>');
    Voice.say(line('vote'));
    sendAll((p) => ({ s: 'vote', me: pub(p.pid), players: pubList(p.pid), secs: secsFor(20) }));
    renderReady();
    const done = () => ok() && enterReveal();
    startTimer(20, done); skipFn = done;
    setTimeout(() => { if (ok() && G.phase === 'vote' && !allActed()) Voice.say(line('voteHurry')); }, secsFor(20) * 1000 - 10000);
  }

  /* ---------------- REVEAL ---------------- */
  function resolveVotes() {
    const cur = G.cur; const list = active(); const tally = {}; list.forEach((p) => tally[p.pid] = 0);
    Object.values(cur.votes).forEach((t) => { if (tally[t] != null) tally[t]++; });
    const max = Math.max(0, ...Object.values(tally)); const top = list.filter((p) => tally[p.pid] === max && max > 0).map((p) => p.pid);
    let accused = null, tie = false, chiefBroke = false;
    if (top.length === 1) accused = top[0];
    else if (top.length > 1) { tie = true; if (cur.chiefDet && top.includes(cur.votes[cur.chiefDet])) { accused = cur.votes[cur.chiefDet]; chiefBroke = true; } }
    const caught = accused === cur.culprit;
    // scoring
    const delta = {}; list.forEach((p) => delta[p.pid] = 0);
    const stick = {}; const give = (pid, k) => { (stick[pid] = stick[pid] || []).push(k); };
    list.forEach((p) => {
      const isLiar = p.pid === cur.culprit || p.pid === cur.accomplice;
      if (!isLiar && cur.votes[p.pid] === cur.culprit) { delta[p.pid] += 2 + (caught ? 1 : 0); p.streak++; if (p.streak >= 3) give(p.pid, 'nose'); } else if (!isLiar) p.streak = 0;
    });
    if (caught) { delta[cur.culprit] += 0; if (cur.accomplice) delta[cur.accomplice] += 1; }
    else { delta[cur.culprit] += 4; give(cur.culprit, 'poker'); if (cur.accomplice) { delta[cur.accomplice] += 3; give(cur.accomplice, 'partner'); } }
    cur.statements.forEach((s) => { if (s.exposes) { delta[s.from] += 1; give(s.from, 'witness'); } });
    if (!caught && cur.statements.some((s) => s.from === cur.culprit && !s.honest && s.contradiction)) give(cur.culprit, 'liar');
    const firstRight = cur.voteOrder.find((pid) => cur.votes[pid] === cur.culprit && pid !== cur.culprit && pid !== cur.accomplice); if (firstRight) give(firstRight, 'sharp');
    if (cur.voteOrder.length >= 3) give(cur.voteOrder[cur.voteOrder.length - 1], 'slow');
    const innocentTop = list.filter((p) => p.pid !== cur.culprit && tally[p.pid] > 0).sort((a, b) => tally[b.pid] - tally[a.pid])[0]; if (innocentTop && tally[innocentTop.pid] >= 2) give(innocentTop.pid, 'framed');
    const drama = list.filter((p) => p.reactions > 0).sort((a, b) => b.reactions - a.reactions)[0]; if (drama && drama.reactions >= 3) give(drama.pid, 'drama');
    return { tally, accused, tie, chiefBroke, caught, delta, stick };
  }
  async function enterReveal() {
    setPhase('reveal'); const ok = guard(); const cur = G.cur; const list = active();
    const R = cur.results = resolveVotes();
    sendAll((p) => ({ s: 'wait', title: 'The votes are in…', sub: '👀 Watch the TV!', me: pub(p.pid) }));
    renderStrip({ alibis: true });
    stage(caseHeader() + '<h2 class="ph">The Votes</h2><div class="tally" id="tally">' + list.map((p) => '<div class="tr"><div class="face">' + charOf(p).emoji + '</div><div class="nm">' + esc(p.name) + '</div><div class="bar"><div class="fill" style="width:0%" data-w="' + (R.tally[p.pid] / Math.max(1, list.length - 1) * 100) + '"></div></div><div class="cnt">' + R.tally[p.pid] + '</div></div>').join('') + '</div><div class="verdict" id="verdict"></div>');
    skipFn = null;
    await Voice.say(line('votesIn')); if (!ok()) return;
    document.querySelectorAll('#tally .fill').forEach((f) => { f.style.width = f.dataset.w + '%'; }); SFX.play('whoosh');
    await sleep(1800); if (!ok()) return;
    if (R.tie) { await Voice.say(line(R.chiefBroke ? 'chiefTie' : 'tie')); if (!ok()) return; }
    SFX.play('suspense'); await Voice.say(line('reveal')); if (!ok()) return;
    // spotlight sweep across the strip
    SFX.play('drumroll');
    const cards = list.map((p) => $('#sus-' + p.pid)); let idx = 0; const culIdx = list.findIndex((p) => p.pid === cur.culprit);
    const steps = 18 + ((culIdx - (18 % list.length)) + list.length) % list.length;
    for (let s = 0; s < steps; s++) { cards.forEach((c) => c && c.classList.remove('lit')); const c = cards[s % list.length]; if (c) c.classList.add('lit'); SFX.play('spot'); await sleep(90 + s * 12); if (!ok()) return; }
    const cul = P(cur.culprit);
    cards.forEach((c) => c && c.classList.remove('lit')); const cc = $('#sus-' + cur.culprit); if (cc) cc.classList.add('guilty');
    const vd = $('#verdict');
    vd.innerHTML = '<div class="culprit"><div class="photo" style="--bg:' + bgOf(cul) + '">' + charOf(cul).emoji + '</div><div><div class="itwas">It was…</div><div class="nm">' + esc(cul.name) + '!</div><div class="truth">' + alibiView(cur.truth).map((v) => v.emoji + ' ' + v.name).join(' · ') + '</div></div></div>';
    await Voice.say([line('itWas'), charOf(cul).name], line('itWas') + ' ' + charOf(cul).name + '!'); if (!ok()) return;
    await sleep(400);
    if (R.caught) { SFX.play('tada'); confetti(); vd.innerHTML += '<div class="outcome stamp big green slam">Caught!</div>'; await Voice.say(line('caught')); }
    else { SFX.play('boo'); vd.innerHTML += '<div class="outcome stamp big slam">Got away!</div>'; if (cc) cc.classList.add('escape'); await Voice.say(line('escaped')); }
    if (!ok()) return;
    if (cur.accomplice) { const ac = P(cur.accomplice); await Voice.say(line('accompliceReveal')); if (!ok()) return; SFX.play('sting'); vd.innerHTML += '<div class="acc">🤝 Accomplice: ' + charOf(ac).emoji + ' <b>' + esc(ac.name) + '</b></div>'; await Voice.say(charOf(ac).name); if (!ok()) return; }
    // apply scores + stickers + profiles
    list.forEach((p) => {
      p.score += R.delta[p.pid]; (R.stick[p.pid] || []).forEach((k) => { p.stickers[k] = (p.stickers[k] || 0) + 1; });
      const pr = profileOf(p.name); pr.points += R.delta[p.pid]; pr.cases++; if (cur.votes[p.pid] === cur.culprit && p.pid !== cur.culprit) pr.solved++; if (p.pid === cur.culprit && !R.caught) pr.escaped++;
      (R.stick[p.pid] || []).forEach((k) => { pr.stickers[k] = (pr.stickers[k] || 0) + 1; });
    });
    const unlockedBefore = unlockedChars().length;
    G.house.casesPlayed++; if (R.caught) G.house.solved++; G.house.played[cur.case.id] = true; saveAll();
    cur.newUnlocks = unlockedChars().slice(unlockedBefore);
    sendAll((p) => {
      const isC = p.pid === cur.culprit, isA = p.pid === cur.accomplice, right = cur.votes[p.pid] === cur.culprit;
      const text = isC ? (R.caught ? 'Busted! They got you.' : 'You got away with it!') : isA ? (R.caught ? 'Your partner got caught.' : 'Clean getaway, partner!') : right ? 'You nailed it!' : 'Wrong suspect! It was ' + cul.name + '.';
      return { s: 'result', me: pub(p.pid), text, delta: R.delta[p.pid], total: p.score, stickers: (R.stick[p.pid] || []).map((k) => D.stickers[k].emoji + ' ' + D.stickers[k].name), culprit: pub(cur.culprit) };
    });
    renderStrip({ alibis: true });
    await sleep(3500); if (ok()) enterScores();
  }
  function confetti() {
    const cv = $('#confetti'); const ctx = cv.getContext('2d'); cv.width = innerWidth; cv.height = innerHeight; cv.hidden = false;
    const ps = Array.from({ length: 180 }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, c: rnd(['#ffd60a', '#e63946', '#3a86ff', '#2dc653', '#9d4edd', '#fb8500']), r: Math.random() * Math.PI, s: 6 + Math.random() * 8 }));
    const t0 = Date.now();
    (function frame() { ctx.clearRect(0, 0, cv.width, cv.height); ps.forEach((p) => { p.x += p.vx; p.y += p.vy; p.r += 0.1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }); if (Date.now() - t0 < 4500) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; } })();
  }

  /* ---------------- SCORES ---------------- */
  async function enterScores() {
    setPhase('scores'); const ok = guard(); const cur = G.cur;
    const list = active().slice().sort((a, b) => b.score - a.score);
    stage(caseHeader() + '<h2 class="ph">Scoreboard</h2><div class="scores">' + list.map((p, i) => '<div class="srow"><div class="pos">' + (i + 1) + '</div><div class="face">' + charOf(p).emoji + '</div><div class="nm">' + esc(p.name) + '<div class="stk">' + Object.keys(p.stickers).map((k) => '<span title="' + D.stickers[k].name + '">' + D.stickers[k].emoji + '</span>').join('') + '</div></div><div class="pts">' + p.score + '</div><div class="dl">' + (cur.results.delta[p.pid] > 0 ? '+' + cur.results.delta[p.pid] : '') + '</div></div>').join('') + '</div>' +
      (Object.keys(cur.results.stick).length ? '<div class="stickers">' + Object.entries(cur.results.stick).map(([pid, ks]) => ks.map((k) => '<span class="stkr">' + D.stickers[k].emoji + ' <b>' + esc(P(pid).name) + '</b> · ' + D.stickers[k].name + '</span>').join('')).join('') + '</div>' : '') +
      (cur.newUnlocks && cur.newUnlocks.length ? '<div class="unlock">🔓 New suspect unlocked: ' + cur.newUnlocks.map((c) => c.emoji + ' ' + esc(c.name)).join(', ') + '</div>' : ''));
    renderStrip({ alibis: true });
    const more = G.caseNo < G.casesTotal;
    sendAll((p) => ({ s: 'wait', title: 'Scoreboard', sub: p.chief && more ? 'Tap ⏭ when everyone is ready for the next case.' : (more ? 'Next case coming up…' : 'Final results coming…'), me: pub(p.pid), score: p.score }));
    const next = () => { if (!ok()) return; if (more) nextCase(); else enterEnd(); };
    skipFn = next;
    await Voice.say(line('scores')); if (!ok()) return;
    if (cur.newUnlocks && cur.newUnlocks.length) { SFX.play('unlock'); await Voice.say(line('unlock')); if (!ok()) return; }
    if (more) await Voice.say(line('nextCase')); if (!ok()) return;
    startTimer(more ? 12 : 6, next);
  }

  /* ---------------- END ---------------- */
  async function enterEnd() {
    setPhase('end'); const ok = guard();
    const list = active().slice().sort((a, b) => b.score - a.score);
    const winner = list[0]; const cul = list.slice().sort((a, b) => (b.stickers.poker || 0) - (a.stickers.poker || 0))[0];
    const all = D.cases.concat(G.custom); const unplayed = all.filter((c) => !G.house.played[c.id]); const teaser = unplayed.length ? rnd(unplayed) : rnd(all);
    stage('<div class="endwrap"><h1>Case Closed!</h1><div class="podium">' + list.slice(0, 3).map((p, i) => '<div class="pod p' + i + '"><div class="medal">' + ['🏆', '🥈', '🥉'][i] + '</div>' + mug(p, { extra: '<div class="pts">' + p.score + '</div><div class="rk">' + rankFor(profileOf(p.name).points).emoji + ' ' + rankFor(profileOf(p.name).points).name + '</div>' }) + '</div>').join('') + '</div>' +
      '<div class="awards"><div>🏅 Top Detective: <b>' + esc(winner.name) + '</b></div>' + (cul && cul.stickers.poker ? '<div>🎭 Escape Artist: <b>' + esc(cul.name) + '</b></div>' : '') + '<div>' + list.slice(3).map((p) => charOf(p).emoji + ' ' + esc(p.name) + ' · ' + p.score).join(' &nbsp; ') + '</div></div>' +
      '<div class="teaser">📺 Next time on Family Whodunit…<br><b>' + teaser.emoji + ' ' + esc(teaser.title) + '</b></div>' +
      '<button id="btnAgain" class="big">🔁 Play again</button></div>');
    $('#btnAgain').onclick = playAgain;
    renderStrip({ alibis: false });
    active().forEach((p) => profileOf(p.name)); saveAll();
    sendAll((p) => ({ s: 'end', me: pub(p.pid), total: p.score, place: list.findIndex((q) => q.pid === p.pid) + 1, rank: rankFor(profileOf(p.name).points), lifetime: profileOf(p.name).points, stickers: Object.keys(p.stickers).map((k) => D.stickers[k].emoji + ' ' + D.stickers[k].name), canAgain: !!p.chief }));
    SFX.play('tada'); confetti();
    await Voice.say(line('gameEnd')); if (!ok()) return;
    await sleep(1500); if (!ok()) return;
    await Voice.say([line('teaser'), teaser.title], line('teaser') + ' ' + teaser.title);
  }
  function playAgain() { if (G.phase !== 'end') return; enterLobby(true); }

  /* ---------------- phone actions ---------------- */
  function handleAct(p, m) {
    const cur = G.cur; if (!cur) return;
    if (G.phase === 'roles' && m.a === 'alibi' && p.pid === cur.culprit && !cur.culpritChosen) {
      const a = {}; for (const k of ATTRS) { if (!cur.pool[k].includes(m.alibi && m.alibi[k])) return; a[k] = m.alibi[k]; }
      cur.alibis[cur.culprit] = a; cur.culpritChosen = true; markActed(p); if (allActed()) setTimeout(() => G.phase === 'roles' && skipPhase(), 600);
    } else if (G.phase === 'roles' && m.a === 'ready') { markActed(p); if (allActed()) setTimeout(() => G.phase === 'roles' && skipPhase(), 600); }
    else if (G.phase === 'witness') {
      if (m.a === 'tell' && cur.peeks[p.pid]) { cur.peeks[p.pid].forEach((k) => addStatement(p.pid, k.target, k.attr, k.value, true)); markActed(p); }
      else if (m.a === 'statement' && (p.pid === cur.culprit || p.pid === cur.accomplice)) { if (m.target !== p.pid) addStatement(p.pid, m.target, m.attr, m.value, false); markActed(p); }
      else if (m.a === 'silent') markActed(p);
      if (allActed()) setTimeout(() => G.phase === 'witness' && skipPhase(), 600);
    } else if (G.phase === 'final' && m.a === 'final') { if (D.finalWords.includes(m.text)) { cur.finalWords[p.pid] = m.text; markActed(p); if (allActed()) setTimeout(() => G.phase === 'final' && skipPhase(), 400); } }
    else if (G.phase === 'vote' && m.a === 'vote') { if (P(m.target) && m.target !== p.pid && !cur.votes[p.pid]) { cur.votes[p.pid] = m.target; cur.voteOrder.push(p.pid); SFX.play('vote'); markActed(p); if (allActed()) setTimeout(() => G.phase === 'vote' && skipPhase(), 800); } }
  }

  /* ---------------- settings modal ---------------- */
  function openSettings() {
    const m = $('#settings'); m.hidden = false;
    $('#setVoice').checked = G.settings.voice; $('#setSfx').checked = G.settings.sfx;
    const sel = $('#setBrowserVoice'); sel.innerHTML = '<option value="">Automatic</option>' + (('speechSynthesis' in window) ? speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)).map((v) => '<option value="' + esc(v.name) + '"' + (v.name === G.settings.browserVoice ? ' selected' : '') + '>' + esc(v.name) + '</option>').join('') : '');
    renderCustom();
  }
  function renderCustom() {
    $('#customList').innerHTML = G.custom.length ? G.custom.map((c, i) => '<div class="cc"><span>' + esc(c.emoji) + ' <b>' + esc(c.title) + '</b> — ' + esc(c.blurb) + '</span><button data-i="' + i + '" class="del">✕</button></div>').join('') : '<div class="muted">No family cases yet. Add one with the kids\' names in it!</div>';
    document.querySelectorAll('#customList .del').forEach((b) => b.onclick = () => { G.custom.splice(+b.dataset.i, 1); saveAll(); renderCustom(); });
  }
  $('#btnSettings').onclick = openSettings;
  $('#btnCloseSettings').onclick = () => { $('#settings').hidden = true; if (G.phase === 'lobby') renderLobby(); };
  $('#setVoice').onchange = (e) => { G.settings.voice = e.target.checked; Voice.enabled = G.settings.voice; if (!Voice.enabled) Voice.stop(); saveAll(); };
  $('#setSfx').onchange = (e) => { G.settings.sfx = e.target.checked; SFX.enabled = G.settings.sfx; saveAll(); };
  $('#setBrowserVoice').onchange = (e) => { G.settings.browserVoice = e.target.value; Voice.voiceName = e.target.value; saveAll(); };
  $('#btnTestVoice').onclick = () => Voice.say('Hello, detectives. Somebody in this room is guilty.');
  $('#btnAddCustom').onclick = () => {
    const t = $('#ccTitle').value.trim(), b = $('#ccBlurb').value.trim(), e = $('#ccEmoji').value.trim() || '🏠';
    if (!t || !b) return; G.custom.push({ id: 'custom_' + FW.randId(6), emoji: e, title: t.startsWith('The Case') ? t : 'The Case of ' + t, blurb: b }); saveAll(); renderCustom(); $('#ccTitle').value = ''; $('#ccBlurb').value = '';
  };
  $('#btnResetProfiles').onclick = () => { if (confirm('Erase all saved detective profiles, ranks, stickers and unlocks on this TV?')) { G.profiles = {}; G.house = { casesPlayed: 0, solved: 0, played: {} }; saveAll(); renderCustom(); alert('Cleared.'); } };
  $('#btnMute').onclick = () => { G.settings.voice = !G.settings.voice; Voice.enabled = G.settings.voice; if (!Voice.enabled) Voice.stop(); $('#btnMute').textContent = Voice.enabled ? '🔊' : '🔇'; saveAll(); };
  $('#btnNewGame').onclick = () => { if (G.phase === 'lobby' || confirm('Abandon this game and go back to the lobby?')) { Voice.stop(); enterLobby(true); } };
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === ' ') skipPhase(); });

  /* ---------------- boot ---------------- */
  async function boot() {
    Voice.enabled = G.settings.voice; SFX.enabled = G.settings.sfx; Voice.voiceName = G.settings.browserVoice;
    $('#btnMute').textContent = Voice.enabled ? '🔊' : '🔇';
    await Voice.load();
    $('#gate').addEventListener('click', async () => {
      SFX.init(); SFX.resume(); $('#gate').hidden = true;
      if ('speechSynthesis' in window) speechSynthesis.getVoices();
      // warm the most common clips
      Voice.preload([].concat(...Object.values(D.lines)).concat(D.characters.map((c) => c.name)));
      enterLobby(false);
    }, { once: true });
    window.addEventListener('beforeunload', () => { if (G.client && G.room) { FW.pub(G.client, FW.topic(G.room, 'host'), { t: 'host', open: false, closed: true, ts: Date.now(), players: [] }, true); } });
  }
  boot();
})();
