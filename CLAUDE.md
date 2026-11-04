# Dxcufgb's Initiative Tracker

FoundryVTT v13 module (id `dxcufgbs-initiative-tracker`, the install folder must have the same name), system-agnostic.
A compact initiative order over the map instead of the big combat tracker: a horizontal or vertical ribbon with every
visible combatant's token, a now / next pill, or a semicircle around the current turn, plus optional turn-order
numbers on the tokens. Off until each player turns it on. Look and feel are client
settings, so every player sets it up their own way. No build step, no npm dependencies, no module dependencies.

## Layout
- `scripts/main.js` – entry point: settings and keybinding registration (`init`), `api` (documented in the header
  comment), and the hooks that refresh the tracker and badges (combat, combatant, token, actor, user, canvas).
- `scripts/settings.js` – every setting. `LOOK_DEFAULTS` holds the client look settings and their defaults (the test
  checks each one is registered); `position` (hidden client) is the screen point of the grip where the player last
  dropped the tracker (null = default spot); `playerHealth` (world) decides whose health bars players see.
  `resetLook()` puts the client settings back. While the settings window is open, field changes go into
  `util.preview` and the tracker re-renders with them before Save; closing the window clears the preview.
- `scripts/tracker.js` – the tracker element: one fixed `<section id="dxit-tracker">` on `document.body`, anchored on
  its grip: `moveTo` measures where it landed and corrects, so it is right under page zoom or UI scaling. Default spot
  near the top of `#ui-middle` (horizontal) or its left edge (vertical). Not an Application. Debounced `refresh()`;
  each render slides chips from their old to new place and size (FLIP with the Web Animations API) and marks
  combatants defeated since the last render `dxit-chip--dying` (grey fade, then skull). Chip clicks (pan, control if
  owned), double-click (sheet), hover (token hover), right-click (Foundry ContextMenu on `.dxit-chip`, created once:
  GM 'Go to Turn'), buttons, grip drag (saved on drop).
- `scripts/flames.js` – death flames: a canvas burst in `.dxit-fx` (re-attached to the tracker after every render),
  following the chip while it slides; started from `markNewDefeats` for combatants that just became `isDead`, only if
  their chip is shown. Client setting `deathFlames`.
- `scripts/encounter.js` – hostiles: `countHostiles` (Hostile disposition; standing = not defeated and token bar1 not at
  0), the tracker's counter (only combatants the user can see), and the responsible GM's "end the encounter?" dialog
  when the last standing hostile falls (`checkEncounter`, debounced; asks once per fall, `askEndEncounter` world
  setting; ending deletes the combat like core's End Combat). `skipDeadTurn`: the responsible GM moves past dead
  combatants' turns (`isDead`; never a player character at 0), one `nextTurn` at a time; not on a step back
  (`movedBackwards`) or Go to Turn from the tracker's context menu (update option `{[MODULE_ID]: {jumpToTurn: true}}`). World setting `skipDead`.
- `scripts/badges.js` – the numbers on tokens: a PIXI container per token, child of the Token object, re-attached from
  `drawToken` because a token redraw destroys its children.
- `scripts/order.js` – pure helpers: `windowTurns` (current turn at the start / centre / end or fixed order, round
  dividers, limit with +N, each turn's offset from the current one), `arcLayout` (semicircle geometry), `sizeFactor`
  (equal or tapering sizes), `orderNumbers`, `healthFraction`, `clampAnchor`. Tested in Node.
- `templates/tracker.hbs`, `styles/initiative-tracker.css` – everything sized from `--dxit-size`, coloured from
  `--dxit-accent`, `--dxit-bg-alpha` and per chip `--dxit-ring`.
- `tests/*.test.mjs` – node:test checks run by CI through `.github/foundry-module.json` (`lint`). Not shipped.
- `.github/workflows/ci.yml` / `release.yml` – thin callers of `dxcufgb/foundry-module-ci`; identical in every
  module, do not edit here.

## Invariants
- The tracker follows `game.combat` (the combat the core tracker shows). GMs see every `combatant.visible` turn.
  Players see their own combatants and every combatant whose token isn't hidden on the map (`visibleCombatants`),
  but in round 1 only allies (player-owned or Friendly) from the start: hostile and neutral ones are revealed when
  their turn comes up (`isRevealed`: index <= combat.turn), so the order isn't given away. The numbers on tokens use
  the same list (no gaps that give a hidden or unrevealed combatant away). A revealed current turn slides into the
  current slot from beside the track while fading in (`animateChips`).
- When the current turn is hidden from a player, the tracker centres on the next turn they see (`nextShown`,
  `windowTurns` `afterHidden`: offsets start at 1), so the tokens never all drop out.
- The hostile counter (`showHostiles`) and initiative numbers (`showInitiative`, tooltip, `getOrder().initiative`)
  are GM only; the settings window hides those two from players (`GM_ONLY`).
- Players see the tracker only once the combat has started; GMs also before, with a Begin combat button.
- Health comes from the token's `bar1` (`TokenDocument#getBarAttribute`), never system data, and players see it only
  for combatants they own unless the `playerHealth` world setting allows more.
- Scope: the module only makes the tracker and the turn-order numbers on map tokens; it doesn't otherwise change
  how tokens on the map look.
- The module writes nothing to documents: only this user's client settings. Turn buttons call core
  `Combat#nextTurn` / `previousTurn` / `startCombat`, which do their own permission checks.
- Snapping uses `centreLines()`: left-to-right the middle of the area left of the visible sidebar (`#sidebar-tabs` / `#sidebar-content`;
  `#ui-right` also holds the chat-notification column, so it is not used) (setting
  `centreFollowsSidebar`, default on) or of the screen; a tracker saved with centerX/centerY is re-centred by `place()`,
  which a ResizeObserver on `#ui-right` calls while the sidebar opens or closes.
- The grip's corner is always kept on screen (`clampAnchor`), so the tracker can always be moved back.
- Players get only the End turn button (on a turn of a combatant they own); GMs get it too, plus their turn buttons.
  The client setting `showControls` hides all buttons. Horizontal: buttons in a row under the tokens; vertical: icon
  buttons in a row with End turn under them (also on a vertical semicircle); horizontal semicircle: End turn inside
  the arc, moved from the current turn towards the circle's centre until it clears every token (`fitArcEndTurn`),
  icon buttons in a column beside it.
- The settings window shows only the settings for the picked layout (`ARC_ONLY` / `LINEAR_ONLY` in settings.js).
- The semicircle always has the full semicircle's size (`boxOffsets`); with few turns the ends stay empty. Tokens
  that join or leave slide in / out along the arc through `arcExits` (one step past each end); leaving ones are
  temporary copies (`dxit-chip--leaving`) removed when their animation ends.
- A tapering or widened (`arcWidth`, an ellipse) semicircle shows as many turns as fit without getting deeper than
  the round one with the same sizes (`arcSideCount`).
- The element lets clicks through (`pointer-events: none`) except on its frame; it must never block the canvas
  around it.
- Invisible tokens (hidden on the map, or the Invisible status) are faded in the tracker (`dxit-chip--invisible`).
- Foundry styles every button with `transition: all 0.5s`; the tracker's buttons override it (colours only), or
  placing them after a render would animate them from the corner. All movement is the tracker's own FLIP.
- The round line has an identity (`round:<before>|<after>`) so it slides and turns with the tokens.
- Tooltip text is HTML: names are passed through `escapeHTML` before they go into it.
- Stable names (used by other modules and macros): API members, the hook `dxcufgbsInitiativeTrackerRender`, setting
  ids, the element id `dxit-tracker` and its `dxit-*` classes.

## Conventions
- `MODULE_ID` must equal `id` in `module.json`; every visible setting needs a Name and Hint in `lang/en.json`, and
  every choice a label (the test checks them). UI strings are under `DXIT.*`.
- User-facing documentation lives in the GitHub wiki; the README only has the badges, the Workshop banner, a short
  install guide and links to the wiki.
