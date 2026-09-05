# 🔍 Family Whodunit

A Jackbox-style party game for the TV and everyone's phones. A silly household crime, a lineup of
goofy suspects, one secretly guilty player, clues on the TV, secrets on the phones, a vote, and a
big reveal. Built for ages 6 to 99 to play the *same* round.

**Play it:** https://mos-slizz.github.io/family-whodunit/

- TV screen: https://mos-slizz.github.io/family-whodunit/tv.html
- Phones: scan the QR code on the TV (or open the link above and type the 4-letter code)

No accounts, no app, no server to run. Phones and the TV talk through a public MQTT relay.
Read [DESIGN.md](DESIGN.md) for the full game design.

## Getting it on your Google TV

Google TV has no web browser built in, so the TV screen runs in a browser somewhere else and gets
cast to the TV. Pick one:

**Option A · Cast a Chrome tab from a laptop (recommended, best sound and animation)**

1. On the laptop, open Chrome and go to `https://mos-slizz.github.io/family-whodunit/tv.html`.
2. Click the three-dot menu (top right) → **Cast…** → pick your Google TV → in the *Sources*
   dropdown choose **Cast tab**.
3. Click the page once ("Tap anywhere to start the TV"). Audio goes to the TV with the tab.
4. Press `F11` (or `Ctrl`+`Cmd`+`F` on a Mac) for full screen.

**Option B · Cast from an Android phone or tablet**

1. Open Chrome on the phone, go to the TV link, tap the three-dot menu → **Cast…** → your TV.
2. Tap the page to start. Keep that phone as the TV; the players use other phones.

**Option C · Install a browser on the Google TV itself**

1. On the Google TV, open the Play Store and install **TV Bro** (free web browser).
2. Open TV Bro and enter `mos-slizz.github.io/family-whodunit/tv.html`.
3. Press select on the "Tap anywhere" screen. Use the remote's OK button as the Skip key.

Whichever way, the TV screen also has a **⏭ Skip** button (and the → key on a keyboard), and the
first player to join becomes the **Chief** with a Skip button on their phone, so you can pace the
game from the couch.

## Playtest script

Do these in order. Each one takes a few minutes and tells you the next thing is safe to try.

**Test 1 · Lobby (2 minutes, you alone)**
1. Open the TV link on the laptop, tap to start. You should hear Inspector Marmalade and see a
   WANTED poster with a QR code and a 4-letter code.
2. Scan the QR with your phone. Type a name, pick a suspect, tap **Join the game**.
   Your polaroid should pin itself to the TV board within a second or two.
3. Scan with a second phone. If both appear, the relay works on your network. ✅

**Test 2 · One quick case (10 minutes, 3+ players)**
1. Everyone joins. Tick **🧒 Junior detective** for the 6-year-old (bigger help, auto-picks).
2. Leave "3 · Quick" selected and start. Play one full case: crime → phones → lineup → three
   clues → witness peeks → final words → vote → reveal.
3. Watch for: does the little one know what to tap? Are the timers too short or too long?
   Does the 12-year-old figure out the witness-board contradictions?

**Test 3 · A full session (15 minutes, 4+ players)**
1. Play all 3 cases. Case 2 adds the secret accomplice, case 3 adds a random twist.
2. At the end, note the ranks and stickers. Tap **Play again** to see returning players greeted
   by rank, and check the case-file counter went up.

**Test 4 · Family cases**
1. On the TV, tap ⚙️ → **Family cases** → add a crime using real names
   ("the Missing Left Sock", "Someone hid Dad's keys in Leo's toy box…").
2. Family cases get a 🏠 badge and are picked first when they haven't been played.

## Under the hood

- `tv.html` + `js/tv.js` — the host. Owns all game state, renders the board, drives the phones.
- `index.html` + `js/phone.js` — the phone. Renders whatever screen the TV sends it.
- `js/net.js` — MQTT over WebSockets to a public broker (EMQX, HiveMQ, Mosquitto fallbacks).
- `js/audio.js` — synthesized sound effects and the recorded voice player.
- `js/data.js` — every character, case, clue, one-liner and host line.
- `audio/` — the Inspector's voice, pre-recorded with a neural TTS (Chatterbox). Run
  `tools/setup_voice.sh` once, then `tools/build_voice.py` to regenerate after editing text.
- Saved on the TV browser (localStorage): profiles, ranks, stickers, unlocked suspects,
  which cases have been played, family cases, settings.

## Known limits

- Public MQTT brokers are free and usually reliable, but they are shared. If phones can't find
  the TV, reload the TV page to get a fresh room on a different relay and rescan.
- Profiles live in the browser that runs the TV. Cast from the same laptop each time to keep
  ranks and unlocks.
- Up to 8 players.
