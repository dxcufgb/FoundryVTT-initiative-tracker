# Changelog

## Unreleased

- Optional support for Dxcufgb's Debug Recorder: while a GM records, the tracker adds its state (counts and
  settings only, no names) and the main steps it takes to the bug report file. Nothing changes without the recorder.

## 0.1.1

Fixes for players, and a few layout fixes.

- Players see every combatant in the tracker again: it no longer showed only their own token on their turn and
  nothing otherwise. A token hidden on the map still shows (faded); a combatant the GM hides in the combat tracker
  (eye icon) doesn't.
- Round 1: players see their own and allied combatants from the start; hostile and neutral ones appear, and get their
  turn-order number on the map, when their turn comes up, sliding into the current slot as they fade in. Once
  revealed they stay, also after a step back or a reload.
- The hostile counter and initiative numbers are for the GM only (their settings are hidden from players).
- Now / next: End turn sits centred under the current token.
- The centre line snaps on the middle token (the semicircle: its centre slot) instead of the middle of the tracker.
- A limited ribbon and Now / next keep their full size with fewer turns, like the semicircle.
- The semicircle's empty room lets clicks through to the map.

## 0.1.0

First version.

- A compact initiative tracker over the map with every visible combatant's token: a horizontal or vertical row, a
  now / next pill, or a semicircle with the current combatant in the centre.
- Semicircle: turns on each side, width (an ellipse that fits more turns without getting deeper), fade and flip.
  It keeps its full size with few combatants, and tokens slide in and out along the arc.
- Row and pill: whether the current combatant sits at the start, in the centre, at the end, or in initiative order,
  and how many tokens to show at most (+N for the rest).
- Tokens all the same size or smaller the further they are from the current turn (the semicircle then fits more).
- Tokens slide and resize when the turn changes, the round line moves with them, and a combatant that is down (0 HP,
  unconscious or dead) fades to grey and dims, with a grey ring, even while it slides; a dead one (defeated, Dead, or an NPC at 0)
  also gets a skull. Hidden and invisible tokens are faded; tokens the GM hid on the map are left out for players.
- A burst of flames on a combatant's token in the tracker when it dies.
- Turn-order numbers on the tokens on the map.
- Off until each player turns it on. Every look setting is the player's own and previews live in the settings
  window, which only shows the settings for the chosen layout.
- Moved by dragging its grip, which it stays anchored on; the position is saved. Snaps to the middle of the screen
  with guide lines, optionally centred on the map area left of the sidebar and following it as it opens and closes.
- A Roll NPCs button for the GM while any NPC in the combat hasn't rolled initiative: one click rolls them all.
- A red End turn button for whoever's turn it is (players and GM), plus previous / next turn and the full combat
  tracker for the GM; all can be hidden.
- Dead combatants' turns are skipped, several in a row too (a GM setting); not when the GM steps back onto one, and
  never player characters at 0 HP.
- Right-clicking a token in the tracker opens a context menu; the GM's Go to Turn makes it that combatant's turn.
- A counter of the hostiles still standing (only the ones the player can see), and a question to the GM to end the
  encounter when the last one falls.
- A world setting for whose health bars players see.
- API (`refresh`, `toggle`, `getOrder`, `resetLook`, `LOOK_DEFAULTS`) and the `dxcufgbsInitiativeTrackerRender` hook.
