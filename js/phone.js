/* Family Whodunit — phone client: a thin renderer for screens the TV sends. */
(function () {
  const FW = window.FW; const D = window.FW_DATA;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  const S = { pid: null, room: null, brokerIdx: 0, client: null, host: null, screen: null, joined: false, name: '', charId: '', junior: false, timer: null, seenV: 0, connected: false, hostSeen: 0 };
  try { S.pid = localStorage.getItem('fw_pid'); if (!S.pid) { S.pid = FW.randId(8); localStorage.setItem('fw_pid', S.pid); } S.name = localStorage.getItem('fw_name') || ''; S.charId = localStorage.getItem('fw_char') || ''; S.junior = localStorage.getItem('fw_junior') === '1'; } catch (e) { S.pid = FW.randId(8); }

  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const bParam = parseInt(params.get('b') || '0', 10) || 0;
  if (params.get('p')) S.pid = 'dev_' + params.get('p').replace(/[^a-z0-9]/gi, '').slice(0, 12); // testing: several phones in one browser

  function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
  function send(obj) { if (S.client && S.room) FW.pub(S.client, FW.topic(S.room, 'h'), Object.assign({ pid: S.pid }, obj)); }
  function act(a, extra) { send(Object.assign({ t: 'act', a }, extra || {})); vibrate(15); }
  function setConn(state, text) { const d = $('#conn'); d.className = 'conn ' + state; d.textContent = text || ''; }

  /* ---------------- landing / code entry ---------------- */
  function renderLanding(msg) {
    app.className = 'screen landing';
    app.innerHTML = '<div class="hero"><div class="logo">🔍</div><h1>Family Whodunit</h1><p>Scan the QR code on the TV, or type the 4-letter room code.</p></div>' +
      '<form id="codeForm" class="card"><input id="code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="big">Join</button>' + (msg ? '<div class="err">' + esc(msg) + '</div>' : '') + '</form>' +
      '<div class="tvlink"><a href="tv.html">📺 I\'m the TV — open the host screen</a></div>';
    $('#codeForm').onsubmit = (e) => { e.preventDefault(); const c = $('#code').value.toUpperCase().replace(/[^A-Z]/g, ''); if (c.length === 4) { location.search = '?r=' + c; } };
  }

  /* ---------------- connect ---------------- */
  async function connect(room, brokerIdx) {
    S.room = room;
    const order = [brokerIdx].concat(FW.BROKERS.map((_, i) => i).filter((i) => i !== brokerIdx));
    for (const i of order) {
      setConn('busy', 'Connecting…');
      try {
        const c = await FW.connect(i, { onMessage, onConnect: () => { setConn('ok', ''); S.connected = true; if (S.joined && S.client) send({ t: 'hello' }); }, onOffline: () => setConn('bad', 'Reconnecting…'), onReconnect: () => setConn('busy', 'Reconnecting…') }, 9000);
        S.client = c; S.brokerIdx = i;
        c.subscribe(FW.topic(room, 'host')); c.subscribe(FW.topic(room, 'p/' + S.pid));
        // wait briefly for the TV beacon; if none, try the next broker (manual-code case)
        const found = await new Promise((res) => { const t0 = Date.now(); const iv = setInterval(() => { if (S.host) { clearInterval(iv); res(true); } else if (Date.now() - t0 > (i === brokerIdx ? 5000 : 3500)) { clearInterval(iv); res(false); } }, 100); });
        if (found) return true;
        try { c.end(true); } catch (e) {} S.client = null;
      } catch (e) { /* next */ }
    }
    return false;
  }
  function onMessage(topic, m) {
    if (topic.endsWith('/host')) { if (m.closed) { S.host = null; if (S.joined) renderKicked('The TV closed this room. Scan the new code on the TV.'); return; } S.host = m; S.hostSeen = Date.now(); if (!S.joined) renderJoin(); return; }
    if (topic.endsWith('/p/' + S.pid)) { if (!m || !m.s) return; if (m.v && m.v < S.seenV) return; S.seenV = m.v || 0; S.joined = true; S.screen = m; render(m); }
  }

  /* ---------------- join form ---------------- */
  function renderJoin() {
    if (S.joined) return;
    const chars = (S.host && S.host.chars) || D.characters.map((c) => ({ id: c.id, emoji: c.emoji, name: c.name, locked: c.unlockAt > 0 }));
    const mine = S.host && S.host.players && S.host.players.find((p) => p.pid === S.pid);
    app.className = 'screen join';
    app.innerHTML = '<div class="hero small"><div class="logo">🔍</div><h1>Room ' + esc(S.room) + '</h1></div>' +
      '<form id="joinForm" class="card"><label>Your name<input id="name" maxlength="14" placeholder="Type your name" autocomplete="off" value="' + esc(S.name) + '"></label>' +
      '<label>Pick your suspect</label><div class="chars">' + chars.map((c) => { const taken = c.taken && !(mine && mine.char === c.id); return '<button type="button" class="ch' + (c.locked ? ' locked' : '') + (taken ? ' taken' : '') + (S.charId === c.id ? ' sel' : '') + '" data-id="' + c.id + '" ' + (c.locked || taken ? 'disabled' : '') + '><span class="e">' + c.emoji + '</span><span class="n">' + esc(c.name) + '</span>' + (c.locked ? '<span class="lk">🔒</span>' : taken ? '<span class="lk">taken</span>' : '') + '</button>'; }).join('') + '</div>' +
      '<label class="chk"><input type="checkbox" id="junior" ' + (S.junior ? 'checked' : '') + '> 🧒 Junior detective (bigger buttons, extra help)</label>' +
      '<button class="big" id="btnJoin">Join the game</button></form>';
    document.querySelectorAll('.ch').forEach((b) => b.onclick = () => { document.querySelectorAll('.ch').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); S.charId = b.dataset.id; vibrate(10); });
    $('#joinForm').onsubmit = (e) => {
      e.preventDefault(); const name = $('#name').value.trim(); if (!name) { $('#name').focus(); return; }
      if (!S.charId || !document.querySelector('.ch.sel')) { const free = document.querySelector('.ch:not([disabled])'); if (free) S.charId = free.dataset.id; }
      S.name = name; S.junior = $('#junior').checked;
      try { localStorage.setItem('fw_name', name); localStorage.setItem('fw_char', S.charId); localStorage.setItem('fw_junior', S.junior ? '1' : '0'); } catch (x) {}
      send({ t: 'join', name, char: S.charId, junior: S.junior }); vibrate(30);
      app.innerHTML = '<div class="center"><div class="spin">🔍</div><p>Joining…</p></div>';
      setTimeout(() => { if (!S.joined) renderJoin(); }, 5000);
    };
  }
  function renderKicked(text) { app.className = 'screen kicked'; app.innerHTML = '<div class="center"><div class="logo">🚪</div><p>' + esc(text) + '</p><button class="big" onclick="location.search=\'\'">Start over</button></div>'; }

  /* ---------------- generic bits ---------------- */
  function header(m) { const me = m.me || {}; return '<div class="hdr"><span class="hface">' + (me.char || '') + '</span><span class="hname">' + esc(me.name || S.name) + '</span>' + (m.chief ? '<span class="chief">⭐ Chief</span>' : '') + '<span id="pt" class="pt"></span></div>'; }
  function startTimer(secs) { stopTimer(); if (!secs) return; const end = Date.now() + secs * 1000; const tick = () => { const left = Math.max(0, Math.ceil((end - Date.now()) / 1000)); const el = $('#pt'); if (el) el.textContent = left ? '⏱ ' + left : ''; if (left <= 0) stopTimer(); }; tick(); S.timer = setInterval(tick, 500); }
  function stopTimer() { if (S.timer) clearInterval(S.timer); S.timer = null; }
  function alibiRow(a, label) { if (!a) return ''; return '<div class="alibi"><div class="al-l">' + (label || 'Your alibi') + '</div><div class="al-r">' + a.map((v) => '<div class="att"><div class="e">' + v.emoji + '</div><div class="l">' + esc(v.name) + '</div></div>').join('') + '</div></div>'; }
  function reactions(m) {
    return '<div class="reacts">' + D.reactions.map((e) => '<button class="rb" data-e="' + e + '">' + e + '</button>').join('') + '<button class="rb pt" id="btnPoint">👉</button></div>' +
      '<div id="pointGrid" class="pgrid" hidden>' + (m.players || []).map((p) => '<button class="pb" data-pid="' + p.pid + '">' + p.char + '<small>' + esc(p.name) + '</small></button>').join('') + '</div>';
  }
  function wireReactions() {
    document.querySelectorAll('.rb[data-e]').forEach((b) => b.onclick = () => { act('react', { e: b.dataset.e }); b.classList.add('sent'); setTimeout(() => b.classList.remove('sent'), 400); });
    const pg = $('#pointGrid'); const bp = $('#btnPoint'); if (bp) bp.onclick = () => { pg.hidden = !pg.hidden; };
    document.querySelectorAll('.pb').forEach((b) => b.onclick = () => { act('point', { target: b.dataset.pid }); pg.hidden = true; });
  }
  function chiefBar(m, label) { return m.chief ? '<button class="skip" id="btnSkip">⏭ ' + (label || 'Skip ahead') + '</button>' : ''; }
  function wireChief() { const b = $('#btnSkip'); if (b) b.onclick = () => { act('skip'); b.disabled = true; setTimeout(() => b.disabled = false, 2000); }; }
  const juniorDelay = () => (S.junior ? 7000 : null);

  /* ---------------- screen renderer ---------------- */
  function render(m) {
    stopTimer(); app.className = 'screen s-' + m.s + (m.role ? ' r-' + m.role : '');
    const body = { wait: rWait, role: rRole, discuss: rDiscuss, witness: rWitness, final: rFinal, vote: rVote, result: rResult, end: rEnd, kicked: (x) => renderKicked(x.text) }[m.s];
    if (body) body(m);
    if (m.secs) startTimer(m.secs);
  }
  function rWait(m) {
    app.innerHTML = header(m) + '<div class="center"><div class="bigface">' + (m.me ? m.me.char : '🔍') + '</div><h1>' + esc(m.title || '') + '</h1><p>' + esc(m.sub || '') + '</p>' +
      (m.rank ? '<div class="rank">' + m.rank.emoji + ' ' + esc(m.rank.name) + '</div>' : '') + (m.score != null ? '<div class="rank">' + m.score + ' pts</div>' : '') +
      (m.canStart ? '<button class="big" id="btnStart">▶ Start the game' + (m.count < 3 ? ' (need 3+)' : '') + '</button>' : '') + (m.canAgain ? '<button class="big" id="btnAgain">🔁 Play again</button>' : '') + '</div>' + (m.title === 'Scoreboard' ? chiefBar(m, 'Next case') : '');
    const bs = $('#btnStart'); if (bs) bs.onclick = () => act('start'); const ba = $('#btnAgain'); if (ba) ba.onclick = () => act('again'); wireChief();
  }
  function rRole(m) {
    if (m.role === 'culprit') {
      const pick = { place: null, color: null, snack: null };
      app.innerHTML = header(m) + '<div class="rolecard culprit"><div class="shh">🤫</div><h1>IT WAS YOU!</h1><p>You did it: <b>' + esc(m.crime.title) + '</b></p><p class="tiny">The truth: ' + m.truth.map((v) => v.emoji + ' ' + esc(v.name)).join(' · ') + '</p></div>' +
        '<h2>Make up your alibi</h2><p class="hint">⭐ = safe lie (doesn\'t match the evidence)</p>' +
        ['place', 'color', 'snack'].map((k) => '<div class="pickrow"><div class="pk-l">' + ({ place: '📍 Where were you?', color: '👕 Wearing?', snack: '🍽️ Snacking on?' }[k]) + '</div><div class="pk-r">' + m.options[k].map((o) => '<button class="opt" data-k="' + k + '" data-id="' + o.id + '"><span class="e">' + o.emoji + '</span><span class="n">' + esc(o.name) + '</span>' + (o.safe ? '<span class="star">⭐</span>' : '') + '</button>').join('') + '</div></div>').join('') +
        '<button class="big" id="btnAlibi" disabled>Lock in my story</button>';
      const upd = () => { $('#btnAlibi').disabled = !(pick.place && pick.color && pick.snack); };
      document.querySelectorAll('.opt').forEach((b) => b.onclick = () => { pick[b.dataset.k] = b.dataset.id; document.querySelectorAll('.opt[data-k="' + b.dataset.k + '"]').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); vibrate(10); upd(); });
      const lock = () => { ['place', 'color', 'snack'].forEach((k) => { if (!pick[k]) { const safe = m.options[k].filter((o) => o.safe); pick[k] = (safe.length ? safe : m.options[k])[Math.floor(Math.random() * (safe.length || m.options[k].length))].id; } }); act('alibi', { alibi: pick }); app.innerHTML = header(m) + '<div class="center"><div class="bigface">🤫</div><h1>Story locked in.</h1><p>Act natural. Look at the TV.</p></div>'; };
      $('#btnAlibi').onclick = lock;
      if (S.junior) setTimeout(() => { if (S.screen === m && $('#btnAlibi')) lock(); }, 12000);
    } else if (m.role === 'accomplice') {
      app.innerHTML = header(m) + '<div class="rolecard accomplice"><div class="shh">🤝</div><h1>You\'re the ACCOMPLICE</h1><p>Your partner in crime is <b>' + m.culprit.char + ' ' + esc(m.culprit.name) + '</b>. Help them get away with it!</p><p class="tiny">The real truth: ' + m.truth.map((v) => v.emoji + ' ' + esc(v.name)).join(' · ') + '</p></div>' + alibiRow(m.alibi, 'Your own alibi (true)') + '<button class="big" id="btnReady">Got it 🤫</button>';
      $('#btnReady').onclick = () => { act('ready'); $('#btnReady').disabled = true; $('#btnReady').textContent = 'Look at the TV'; };
    } else {
      const chief = m.role === 'chief';
      app.innerHTML = header(m) + '<div class="rolecard innocent"><div class="shh">' + (chief ? '🎖️' : '😇') + '</div><h1>' + (chief ? 'DETECTIVE IN CHIEF' : 'You\'re INNOCENT') + '</h1><p>' + (chief ? 'You get two witness peeks and break tied votes.' : 'Act natural. Or don\'t.') + '</p></div>' + alibiRow(m.alibi, 'Your alibi (it\'s true!)') + '<p class="hint">Remember it. The clues will point at somebody.</p><button class="big" id="btnReady">Got it 👍</button>';
      $('#btnReady').onclick = () => { act('ready'); $('#btnReady').disabled = true; $('#btnReady').textContent = 'Look at the TV'; };
      if (S.junior) setTimeout(() => { const b = $('#btnReady'); if (S.screen === m && b && !b.disabled) b.click(); }, juniorDelay());
    }
  }
  function rDiscuss(m) {
    app.innerHTML = header(m) + '<div class="dtitle"><h1>' + esc(m.title || '') + '</h1><p>' + esc(m.sub || '') + '</p></div>' + (m.clues && m.clues.length ? '<div class="clues">Clues so far: ' + m.clues.join(' ') + '</div>' : '') + alibiRow(m.alibi) + reactions(m) + chiefBar(m);
    wireReactions(); wireChief();
  }
  function rWitness(m) {
    if (m.mode === 'innocent') {
      app.innerHTML = header(m) + '<h1>🔍 You peeked…</h1>' + m.peeks.map((k) => '<div class="peek"><div class="pk-t">' + k.target.char + ' <b>' + esc(k.target.name) + '</b></div><div class="pk-v"><span class="l">' + esc(k.label) + ':</span> <span class="e">' + k.value.emoji + '</span> <b>' + esc(k.value.name) + '</b></div><div class="tiny">This is the TRUTH about them.</div></div>').join('') +
        '<p class="hint">Does it match what they said in the lineup?</p><button class="big" id="btnTell">📣 Tell everyone</button>';
      $('#btnTell').onclick = () => { act('tell'); $('#btnTell').disabled = true; $('#btnTell').textContent = 'Posted to the witness board'; };
      if (S.junior) setTimeout(() => { const b = $('#btnTell'); if (S.screen === m && b && !b.disabled) b.click(); }, juniorDelay());
    } else {
      const st = { target: null, attr: null, value: null };
      app.innerHTML = header(m) + '<div class="rolecard ' + m.role + ' compact"><h1>' + (m.role === 'culprit' ? '🤫 Time to lie' : '🤝 Back up your partner') + '</h1><p>' + (m.role === 'culprit' ? 'Make up a witness statement, or stay quiet. Framing someone is risky: they KNOW you\'re lying.' : 'Your partner ' + (m.culprit ? m.culprit.char + ' ' + esc(m.culprit.name) : '') + ' claimed: ' + (m.culpritAlibi || []).map((v) => v.emoji + ' ' + esc(v.name)).join(' · ') + '. Confirm their story, or frame someone.') + '</p></div>' +
        '<div class="pickrow"><div class="pk-l">"I saw…"</div><div class="pk-r">' + m.players.map((p) => '<button class="opt" data-k="target" data-id="' + p.pid + '"><span class="e">' + p.char + '</span><span class="n">' + esc(p.name) + '</span></button>').join('') + '</div></div>' +
        '<div class="pickrow"><div class="pk-l">"…and they were…"</div><div class="pk-r" id="valGrid">' + ['place', 'color', 'snack'].map((k) => m.attrs[k].map((o) => '<button class="opt" data-k="value" data-attr="' + k + '" data-id="' + o.id + '"><span class="e">' + o.emoji + '</span><span class="n">' + esc(o.name) + '</span></button>').join('')).join('') + '</div></div>' +
        '<button class="big" id="btnSay" disabled>📣 Say it</button><button class="big ghost" id="btnQuiet">🤐 Stay quiet</button>';
      document.querySelectorAll('.opt').forEach((b) => b.onclick = () => { if (b.dataset.k === 'target') st.target = b.dataset.id; else { st.attr = b.dataset.attr; st.value = b.dataset.id; } document.querySelectorAll('.opt[data-k="' + b.dataset.k + '"]').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); $('#btnSay').disabled = !(st.target && st.value); vibrate(10); });
      const done = (t) => { app.innerHTML = header(m) + '<div class="center"><div class="bigface">🤫</div><h1>' + t + '</h1><p>Look at the TV.</p></div>'; };
      $('#btnSay').onclick = () => { act('statement', { target: st.target, attr: st.attr, value: st.value }); done('Statement posted.'); };
      $('#btnQuiet').onclick = () => { act('silent'); done('You said nothing.'); };
      if (S.junior) setTimeout(() => { if (S.screen === m && $('#btnQuiet')) $('#btnQuiet').click(); }, 12000);
    }
  }
  function rFinal(m) {
    app.innerHTML = header(m) + '<h1>🎤 Final words</h1><p class="hint">Pick your defense. The Inspector will read it out loud.</p><div class="fwopts">' + m.options.map((o) => '<button class="fwo" data-t="' + esc(o) + '">' + esc(o) + '</button>').join('') + '</div>';
    document.querySelectorAll('.fwo').forEach((b) => b.onclick = () => { act('final', { text: b.dataset.t }); app.innerHTML = header(m) + '<div class="center"><div class="bigface">🎤</div><h1>Nice one.</h1><p>"' + esc(b.dataset.t) + '"</p></div>'; });
    if (S.junior) setTimeout(() => { const b = document.querySelector('.fwo'); if (S.screen === m && b) b.click(); }, 10000);
  }
  function rVote(m) {
    app.innerHTML = header(m) + '<h1>🗳️ Who did it?</h1><div class="vgrid">' + m.players.map((p) => '<button class="vb" data-pid="' + p.pid + '"><span class="e">' + p.char + '</span><span class="n">' + esc(p.name) + '</span></button>').join('') + '</div>';
    document.querySelectorAll('.vb').forEach((b) => b.onclick = () => { act('vote', { target: b.dataset.pid }); vibrate(40); app.innerHTML = header(m) + '<div class="center"><div class="bigface">' + b.querySelector('.e').textContent + '</div><h1>You voted for ' + esc(b.querySelector('.n').textContent) + '</h1><p>Watch the TV…</p></div>'; });
  }
  function rResult(m) {
    app.innerHTML = header(m) + '<div class="center"><div class="bigface">' + (m.delta > 0 ? '🎉' : '😬') + '</div><h1>' + esc(m.text) + '</h1><div class="delta">' + (m.delta > 0 ? '+' + m.delta + ' points' : 'No points this time') + '</div><div class="rank">Total: ' + m.total + '</div>' + (m.stickers && m.stickers.length ? '<div class="stickers">' + m.stickers.map((s) => '<span>' + esc(s) + '</span>').join('') + '</div>' : '') + '</div>';
    vibrate(m.delta > 0 ? [40, 60, 40] : 80);
  }
  function rEnd(m) {
    app.innerHTML = header(m) + '<div class="center"><div class="bigface">' + (m.place === 1 ? '🏆' : m.place === 2 ? '🥈' : m.place === 3 ? '🥉' : '🕵️') + '</div><h1>' + (m.place === 1 ? 'Top Detective!' : 'You came ' + m.place + (m.place === 2 ? 'nd' : m.place === 3 ? 'rd' : 'th')) + '</h1><div class="rank">' + m.total + ' pts tonight</div><div class="rank">' + m.rank.emoji + ' ' + esc(m.rank.name) + ' · ' + m.lifetime + ' lifetime pts</div>' + (m.stickers && m.stickers.length ? '<div class="stickers">' + m.stickers.map((s) => '<span>' + esc(s) + '</span>').join('') + '</div>' : '') + (m.canAgain ? '<button class="big" id="btnAgain">🔁 Play again</button>' : '<p>Waiting for the Chief to start another…</p>') + '</div>';
    const ba = $('#btnAgain'); if (ba) ba.onclick = () => act('again');
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    if (!roomParam) return renderLanding();
    app.innerHTML = '<div class="center"><div class="spin">🔍</div><p>Looking for the TV…</p></div>';
    const ok = await connect(roomParam, bParam);
    if (!ok) { setConn('bad', ''); return renderLanding('Couldn\'t find a TV with code ' + roomParam + '. Check the code and try again.'); }
    if (!S.joined) renderJoin();
    // keep an eye on the TV beacon
    setInterval(() => { if (S.joined && S.hostSeen && Date.now() - S.hostSeen > 90000) setConn('bad', 'TV not responding…'); }, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.joined) send({ t: 'hello' }); });
  }
  boot();
})();
