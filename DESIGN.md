# Family Whodunit — Design Document

A Jackbox-style party game for one TV and 3–8 phones. A goofy household crime, a lineup of
suspect characters, one secretly guilty player, clues on the TV, secrets on the phones, a vote,
and a big reveal. Built for a 6-year-old and a 12-year-old to enjoy *the same round*.

## Design pillars

1. **The TV talks.** Inspector Marmalade (an orange cat detective) reads every line aloud in a
   recorded neural voice. The 6-year-old never has to read to follow the game. Phones show
   pictures and big buttons, never paragraphs.
2. **Everybody is suspicious.** Every player has an alibi made of three pictures (where they
   were, what they wore, what they were snacking on). When everyone is defending an alibi, one
   giggling kid is not a giveaway.
3. **Nobody is out, nobody is stuck.** Every phase is one or two taps. If a player does not tap
   before the timer, the game picks for them and moves on. Junior mode auto-picks even sooner.
4. **Real deduction for the big kid.** Clues reveal the culprit's true alibi one picture at a
   time. Witness peeks expose contradictions. The culprit and accomplice can lie on the witness
   board. The 12-year-old gets a genuine logic puzzle with bluffing on top.
5. **Little moments of drama.** Emoji reactions and "point at someone" fly onto the TV during
   discussion. Final Words one-liners before the vote. A spotlight sweep and drumroll at the
   reveal. The accomplice reveal after the culprit reveal.

## The information game (why it is solvable but not trivial)

Each case has a hidden **truth**: the culprit's real Where / Wearing / Snack, drawn from four
options of each type in play.

- Innocents are **dealt** a true alibi (random values, so some innocents happen to match clues:
  built-in red herrings).
- The culprit **chooses** a fake alibi. Their phone stars the options that do not match the
  evidence. A bold culprit can tell a partial truth.
- Three **clues** reveal the truth one attribute at a time. After each clue the TV highlights
  suspects whose alibi matches. Innocents get accused; the culprit is usually unmarked.
- **Witness peeks:** every innocent's phone shows one true attribute of one random other
  player. Statements post to the witness board; a statement that contradicts a declared alibi
  gets flagged. If a peek landed on the culprit, that innocent holds the key evidence.
- The culprit (and accomplice) can **craft** a witness statement: confirm the culprit's fake
  alibi, frame an innocent, or stay silent. A framed innocent knows the framer is lying, so
  framing is a gamble. Confirming is safer. Silence is safest but earns nothing.
- The result: the board usually shows one real contradiction and possibly one fake one. Who do
  you believe? That is the argument the family has before the vote.

## Case flow (about 4 minutes)

| # | Phase | TV | Phones | Timer |
|---|---|---|---|---|
| 1 | Crime | Case card, Inspector reads it | "Look at the TV" | 12s |
| 2 | Secrets | "Check your phone" | Role card; culprit picks 3 alibi pictures | 35s |
| 3 | Lineup | Every suspect's alibi, read aloud with jokes | Reactions + point | 25s |
| 4 | Clues ×3 | One clue, drumroll, matching suspects flash | Reactions | 14s each |
| 5 | Witnesses | Statements appear as speech bubbles, contradictions flagged | Innocents: TELL. Culprit: build a statement or stay quiet | 30s |
| 6 | Final Words | Each suspect's one-liner | Pick 1 of 4 lines | 20s |
| 7 | Vote | Countdown, live "voted" ticks | Tap a face | 20s |
| 8 | Reveal | Spotlight sweep, culprit revealed, verdict, accomplice reveal, stickers, scores | Your result | — |

The first-joined player is the **Chief** and gets a Skip button on their phone for discussion
phases, so the parent can pace the game from the couch.

## Roles

- **Culprit** (always). Wins by escaping the vote.
- **Accomplice** (from case 2 with 4+ players, always if the culprit is in Junior mode). Knows
  the culprit and their fake alibi. Scores with the culprit.
- **Detective-in-Chief** (twist). Gets two witness peeks and breaks tied votes.
- Everyone else: **Innocent**.

## Twists (from case 3 on, one per case, random)

- **Double Trouble** — accomplice in play.
- **Detective-in-Chief** — one innocent gets two peeks and the tiebreak.
- **Blackout** — each clue shows for only 5 seconds.
- **Speed Case** — every timer halved.
- **Truth Serum** — one innocent's witness statement is stamped VERIFIED by the Inspector.

## Difficulty ramp inside a session

Case 1: culprit only, no twist. Case 2: accomplice. Case 3+: a random twist each case.
Session lengths: Quick (3 cases, ~12 min), Standard (5), Marathon (7).

## Scoring (keeps everyone in it)

- Voted for the culprit: +2. Culprit caught by the group: +1 more for every correct voter.
- Culprit escapes: +4 to the culprit. Accomplice: +3 when the culprit escapes, +1 if caught.
- Key witness (your peek exposed the culprit and you told): +1.
- Ties go to the culprit unless a Detective-in-Chief breaks them.

Stickers each case (cosmetic, saved forever on this TV): 🎯 Sharp Eye (first correct vote),
🎭 Poker Face (culprit escaped), 🫣 Framed (innocent with most votes), 🗣️ Key Witness,
🤝 Partner in Crime, 🐢 Slowpoke (last to vote), 🎪 Drama Star (most reactions).

## Why they'll play again (retention)

- **Profiles & ranks.** The TV remembers each name: lifetime points, cases, escapes, stickers.
  Ranks: Rookie → Junior Sleuth → Gumshoe → Inspector → Super Sleuth → Legendary Detective.
  The lobby greets returning players by rank.
- **Unlockable suspects.** 8 characters at the start, 8 more unlocked as the household solves
  cases. The end screen announces unlocks.
- **The Case File.** 40 built-in cases; the TV tracks which ones the family has played.
  A progress bar and a "cases remaining" count invite completion.
- **Family Cases.** Parents can write custom cases with the kids' real names and inside jokes
  in Settings on the TV. They rotate in with a 🏠 badge. Custom lines are read by the browser
  voice when no recording exists.
- **The teaser.** Every end screen previews the next unplayed case: "Next time: The Case of
  the Toothbrush in the Toilet."
- **Twists and the truth engine** make the same case play differently every time.

## Characters

Suspects have names, an emoji, a catchphrase the Inspector uses, and a reaction when accused.
The Inspector always refers to players by their *character* name, which is what lets every
spoken line be pre-recorded.

## Technical plan

- Static site on GitHub Pages. No build step. `tv.html` hosts the game and owns all state.
  `index.html` is the phone (and a landing page with a code entry box).
- Realtime over a public MQTT broker with WebSockets (mqtt.js). The TV picks a broker and a
  4-letter room code; the QR encodes both. Phones publish actions to `fw/<room>/h`; the TV
  publishes a per-player retained screen descriptor to `fw/<room>/p/<id>`, so a phone that
  reloads or reconnects lands on the right screen instantly. Phones are thin renderers.
- Audio: pre-recorded Piper neural TTS clips (composable: templates + slot clips for character,
  place, colour, snack). Web Speech fallback for custom text. Sound effects synthesised with
  WebAudio, so there are no sample files.
- Persistence: TV `localStorage` for profiles, unlocks, case file, custom cases, settings.
