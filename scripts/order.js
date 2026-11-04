/**
 * Pure turn-order and layout helpers (no Foundry globals), tested in Node.
 *
 * A "turn" here is a plain object with at least {id}. `currentId` is the combatant whose turn it is (or null before
 * the combat starts). The helpers only pick, order and place turns; what each turn looks like is up to the caller.
 */

/** Where the current turn sits in the tracker. */
export const PLACEMENTS = ["start", "center", "end", "fixed"];

/**
 * The turns the tracker shows, in display order.
 * - "start":  the current turn first, then the ones after it (wrapping into the next round).
 * - "end":    the same, reversed: the current turn last, the next one right before it.
 * - "center": the current turn in the middle, earlier turns before it, later turns after it.
 * - "fixed":  the combat's own initiative order; with a limit, a window that keeps the current turn in view.
 * A {divider: true} entry marks where the order wraps into another round (not in "fixed").
 * Every turn entry gets `offset`: its distance from the current turn in initiative order (negative = earlier).
 * @param {object[]} turns         visible turns in initiative order
 * @param {string|null} currentId  id of the current turn
 * With `afterHidden`, the real current turn is one the user can't see and `currentId` is the next one they can: it
 * sits where the current turn would, but its offset is 1 (the hidden turn is offset 0), and so on for the others.
 * @param {{placement?: string, max?: number, afterHidden?: boolean}} options  max 0 or less = everyone
 * @returns {{entries: object[], more: number}}  `more` = turns left out
 */
export function windowTurns(turns, currentId, { placement = "start", max = 0, afterHidden = false } = {}) {
  const out = placeTurns(turns, currentId, placement, max);
  if (afterHidden) for (const entry of out.entries) if (Number.isFinite(entry.offset)) entry.offset += 1;
  return out;
}

function placeTurns(turns, currentId, placement, max) {
  const list = Array.isArray(turns) ? turns : [];
  const n = list.length;
  if (!n) return { entries: [], more: 0 };
  const idx = list.findIndex(turn => turn.id === currentId);
  const m = max > 0 ? Math.min(n, Math.floor(max)) : n;
  const more = n - m;

  if (placement === "fixed" || idx < 0) {
    let start = 0;
    if (idx >= 0 && m < n) start = Math.min(Math.max(0, idx - Math.floor((m - 1) / 2)), n - m);
    const entries = list.slice(start, start + m).map((turn, i) => ({ ...turn, offset: idx < 0 ? null : start + i - idx }));
    return { entries, more };
  }

  const before = placement === "center" ? Math.floor((m - 1) / 2) : 0;
  const entries = [];
  for (let k = -before; k < m - before; k++) {
    const i = (((idx + k) % n) + n) % n;
    if (entries.length && i === 0) entries.push({ divider: true });
    entries.push({ ...list[i], offset: k });
  }
  if (placement === "end") entries.reverse();
  return { entries, more };
}

/**
 * The turn to centre the tracker on when the current one is hidden from the user: the next shown turn after it in
 * initiative order (wrapping round), or null.
 * @param {string[]} allIds    every turn in initiative order
 * @param {Set<string>} shown  the ids the user sees
 * @param {string|null} currentId
 */
export function nextShown(allIds, shown, currentId) {
  const start = allIds.indexOf(currentId);
  if (start < 0) return null;
  for (let k = 1; k <= allIds.length; k++) {
    const id = allIds[(start + k) % allIds.length];
    if (shown.has(id)) return id;
  }
  return null;
}

/**
 * Round 1 reveal, for players: allies are known from the start; everyone else only once their turn has come up in
 * the first round (their index in the order is at or before the current turn). From round 2 on, everyone. Before the
 * combat starts only allies (the order isn't settled yet).
 * @param {{index: number, known: boolean}} turn
 * @param {{started: boolean, round: number, turn: number|null}} combat
 */
export function isRevealed({ index, known }, { started, round, turn }) {
  if (known) return true;
  if (!started) return false;
  if (round > 1) return true;
  return Number.isInteger(turn) && index <= turn;
}

/**
 * Keeps a limited ribbon or Now / next at its full size with fewer turns than the limit, like the semicircle: the
 * missing turns become empty slots ({slot: true, offset}) where more turns would go, so the current turn stays in
 * its place. "start" / "fixed": after the turns; "end": before them; "center": on both sides, so the current turn
 * stays in the middle slot. A round line's room is kept too ({slot: true, divider: true}) when there is none (not
 * in "fixed", which has no round lines).
 * @param {object[]} entries  from windowTurns
 * @param {{placement?: string, max?: number}} options  max 0 or less = no limit (nothing added)
 */
export function padWindow(entries, { placement = "start", max = 0 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const limit = Math.floor(Number(max) || 0);
  if (limit <= 0) return list;
  const turns = list.filter(e => !e.divider);
  const missing = Math.max(0, limit - turns.length);
  const step = (offset, by) => (Number.isFinite(offset) ? offset + by : null);
  const first = turns[0]?.offset ?? null;
  const last = turns.at(-1)?.offset ?? null;
  let left = 0;
  if (placement === "end") left = missing;
  else if (placement === "center") left = Math.min(missing, Math.max(0, Math.floor((limit - 1) / 2) - Math.floor((turns.length - 1) / 2)));
  const right = missing - left;
  // "end" lists turns reversed (later turns on the left), so its empty slots continue after the last turn shown.
  const before = Array.from({ length: left }, (_, i) => ({
    slot: true, offset: placement === "end" ? step(first, left - i) : step(first, i - left)
  }));
  const after = Array.from({ length: right }, (_, i) => ({ slot: true, offset: step(last, i + 1) }));
  const out = [...before, ...list, ...after];
  if (placement !== "fixed" && !list.some(e => e.divider)) {
    if (placement === "end") out.unshift({ slot: true, divider: true });
    else out.push({ slot: true, divider: true });
  }
  return out;
}

/** Most turns a semicircle shows on each side of the current one. */
const ARC_MAX_SIDE = 12;

/** Radius and angular span of a semicircle that holds `reach` equal-size turns on each side. */
function arcFrame(size, reach) {
  const r = Math.max(1, Math.round(reach) || 1);
  const step = (Math.min(40, 75 / r) * Math.PI) / 180;
  return { r, radius: (size * 1.2) / (2 * Math.sin(step / 2)) };
}

/**
 * Angles (radians from the current turn) of the turns 1..sides on one side, each placed so that it keeps the same
 * gap to its neighbour whatever its size. With `stretch` > 1 the arc is an ellipse, `stretch` times wider along the
 * tracker than across it, and the angles are found so the straight-line gaps stay the same.
 */
function sideAngles(sides, size, radius, taper, stretch = 1) {
  const point = a => [stretch * radius * Math.sin(a), radius * Math.cos(a)];
  const angles = [0];
  for (let k = 1; k <= sides; k++) {
    const chord = (size * (arcFactor(k - 1, taper) + arcFactor(k, taper))) / 2 + size * 0.2;
    const from = angles[k - 1];
    const [x0, y0] = point(from);
    const distance = a => { const [x, y] = point(a); return Math.hypot(x - x0, y - y0); };
    let lo = from;
    let hi = Math.PI;
    if (distance(hi) < chord) { angles.push(hi); continue; }
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (distance(mid) < chord) lo = mid; else hi = mid;
    }
    angles.push(hi);
  }
  return angles;
}

/**
 * How many turns the semicircle shows on each side of the current one.
 * Equal sizes on a round arc: `reach`. Tapering sizes or a wider (elliptic) arc: as many as fit without the arc
 * getting any deeper than the round, equal-size one, and without getting wider than that one times `stretch`.
 * @param {{size: number, reach: number, taper?: boolean, stretch?: number}} options
 */
export function arcSideCount({ size, reach, taper = false, stretch = 1 }) {
  const { r, radius } = arcFrame(size, reach);
  const w = Math.max(1, Number(stretch) || 1);
  if (!taper && w === 1) return r;
  // How deep (across) and how far (along) the outer edge of turn k reaches from the current turn's centre.
  const reachOf = (angles, k, factor, wide) => ({
    depth: radius * (1 - Math.cos(angles[k])) + (size * factor) / 2,
    along: wide * radius * Math.sin(angles[k]) + (size * factor) / 2
  });
  const count = (wide, limit) => {
    let sides = 0;
    while (sides < ARC_MAX_SIDE) {
      const next = sides + 1;
      const angles = sideAngles(next, size, radius, taper, wide);
      if (angles[next] >= Math.PI / 2) break;
      const edge = reachOf(angles, next, arcFactor(next, taper), wide);
      if (edge.depth > limit.depth + 0.5 || edge.along > limit.along * wide + 0.5) break;
      sides = next;
    }
    return Math.max(1, sides);
  };
  // The round arc: `reach` equal turns, or as many tapering ones as fit in the same space.
  const roundSides = taper ? count(1, reachOf(sideAngles(r, size, radius, false), r, 1, 1)) : r;
  if (w === 1) return roundSides;
  // Wider: as many as fit without getting deeper than the round arc with the same sizes.
  const limit = reachOf(sideAngles(roundSides, size, radius, taper), roundSides, arcFactor(roundSides, taper), 1);
  return Math.max(roundSides, count(w, limit));
}

/**
 * Places turns on a semicircle around the current one (offset 0), which sits at the outermost point of the arc.
 * Horizontal: earlier turns to the left, later to the right; the arc hangs down (current lowest) unless flipped.
 * Vertical: earlier turns above, later below; the arc bulges right (current furthest right) unless flipped.
 * With `taper`, turns further from the current one are smaller; with `stretch` > 1 the arc is an ellipse that many
 * times wider along the tracker (its depth stays the same). Both make room for more turns (see arcSideCount).
 * Turns fade by `fade` percent towards the ends.
 * @param {number[]} offsets  offsets of the turns to place (from windowTurns)
 * @param {{size: number, reach: number, fade?: number, flip?: boolean, vertical?: boolean, taper?: boolean, stretch?: number,
 *   sides?: number, boxOffsets?: number[]}} options  `sides`: turns per side of the full semicircle (for the fade);
 *   `boxOffsets`: the offsets the box is sized around (the full semicircle)
 * @returns {{width: number, height: number, items: Array<{offset: number, x: number, y: number, d: number, opacity: number}>}}
 *   x/y = top-left of each token inside a width × height box, d = its diameter
 */
export function arcLayout(offsets, { size, reach, fade = 60, flip = false, vertical = false, taper = true, stretch = 1,
  sides: fullSides, boxOffsets } = {}) {
  const { radius } = arcFrame(size, reach);
  const w = Math.max(1, Number(stretch) || 1);
  const list = Array.isArray(offsets) ? offsets : [];
  const farthest = Math.max(1, ...list.map(o => Math.abs(o)), ...(boxOffsets ?? []).map(o => Math.abs(o)));
  // Fade over the full semicircle (not just the turns present), so a short fight looks the same as a long one.
  const sides = Math.max(1, Number(fullSides) || farthest);
  const angles = sideAngles(Math.max(sides, farthest), size, radius, taper, w);
  const fadeShare = Math.min(100, Math.max(0, fade)) / 100;
  const placed = list.map(offset => {
    const far = Math.abs(offset);
    const angle = Math.sign(offset) * angles[far];
    const along = w * radius * Math.sin(angle);
    const across = radius * Math.cos(angle) * (flip ? -1 : 1);
    const d = size * arcFactor(offset, taper);
    const opacity = offset === 0 ? 1 : Math.max(0, Math.min(1, 1 - fadeShare * (far / sides)));
    return { offset, cx: vertical ? across : along, cy: vertical ? along : across, d, opacity };
  });
  if (!placed.length) return { width: 0, height: 0, items: [] };
  // The box: around `boxOffsets` when given (the full semicircle, so it keeps its size with few turns; turns outside
  // it, like the slots just past the ends, may lie outside the box), otherwise around the turns placed.
  const point = offset => {
    const angle = Math.sign(offset) * angles[Math.abs(offset)];
    const along = w * radius * Math.sin(angle);
    const across = radius * Math.cos(angle) * (flip ? -1 : 1);
    const d = size * arcFactor(offset, taper);
    return { cx: vertical ? across : along, cy: vertical ? along : across, d };
  };
  const frame = Array.isArray(boxOffsets) && boxOffsets.length ? boxOffsets.map(point) : placed;
  const minX = Math.min(...frame.map(p => p.cx - p.d / 2));
  const minY = Math.min(...frame.map(p => p.cy - p.d / 2));
  const maxX = Math.max(...frame.map(p => p.cx + p.d / 2));
  const maxY = Math.max(...frame.map(p => p.cy + p.d / 2));
  const round = v => Math.round(v * 10) / 10;
  return {
    width: round(maxX - minX),
    height: round(maxY - minY),
    items: placed.map(p => ({
      offset: p.offset,
      x: round(p.cx - p.d / 2 - minX),
      y: round(p.cy - p.d / 2 - minY),
      d: round(p.d),
      opacity: round(p.opacity)
    }))
  };
}

/**
 * How big a token is relative to the normal size: the current turn (offset 0) a quarter bigger; the others either
 * all the same size, or ("taper") smaller the further their turn is from the current one, down to half size.
 * @param {number|null} offset  distance from the current turn (null before the combat starts)
 * @param {boolean} taper
 */
export function sizeFactor(offset, taper, rate = 0.12, min = 0.5) {
  if (offset === 0) return 1.25;
  if (!taper || offset === null || offset === undefined) return 1;
  return Math.max(min, 1 - rate * Math.abs(offset));
}

/** The semicircle tapers faster than the ribbon, so the room it frees holds more turns. */
const arcFactor = (offset, taper) => sizeFactor(offset, taper, 0.2, 0.4);

/**
 * The 1-based position of each visible turn in initiative order, for the numbers on the tokens.
 * Hidden turns are not in `turns`, so players never see a gap that gives a hidden combatant away.
 * @param {object[]} turns
 * @returns {Map<string, number>}
 */
export function orderNumbers(turns) {
  const map = new Map();
  (Array.isArray(turns) ? turns : []).forEach((turn, i) => map.set(turn.id, i + 1));
  return map;
}

/**
 * A health fraction 0..1 from {value, max}, or null when there is nothing sensible to show.
 * @param {{value?: number, max?: number}|null|undefined} bar
 */
export function healthFraction(bar) {
  const value = Number(bar?.value);
  const max = Number(bar?.max);
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  return Math.min(1, Math.max(0, value / max));
}

/**
 * Keeps an anchor point (the drag grip's top-left corner) on screen, so the grip can always be grabbed.
 * @returns {{x: number, y: number}}
 */
export function clampAnchor(point, viewport, grip = 24) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  return {
    x: Math.round(Math.min(Math.max(0, Number.isFinite(x) ? x : 0), Math.max(0, viewport.width - grip))),
    y: Math.round(Math.min(Math.max(0, Number.isFinite(y) ? y : 0), Math.max(0, viewport.height - grip)))
  };
}

/**
 * Snaps a dragged tracker to the middle of the screen: when its centre comes within `threshold` pixels of the
 * screen's vertical centre line, it is centred left to right; likewise top to bottom for the horizontal centre line.
 * The point that goes on the line is `pivotX` / `pivotY` from the box's corner (default: the box's middle; the tracker
 * passes the middle of its tokens, so the middle token is split by the line).
 * @param {{x: number, y: number, width: number, height: number, pivotX?: number, pivotY?: number}} box
 *   the tracker's top-left corner and size
 * @param {{width: number, height: number}} viewport
 * @param {number} threshold
 * @param {{x?: number, y?: number}} centre  the centre lines (default: the middle of the viewport)
 * @returns {{x: number, y: number, centerX: boolean, centerY: boolean}}
 */
export function snapToCentre(box, viewport, threshold = 16, centre = {}) {
  const midX = Number.isFinite(centre.x) ? centre.x : viewport.width / 2;
  const midY = Number.isFinite(centre.y) ? centre.y : viewport.height / 2;
  const px = Number.isFinite(box.pivotX) ? box.pivotX : box.width / 2;
  const py = Number.isFinite(box.pivotY) ? box.pivotY : box.height / 2;
  const centerX = Math.abs(box.x + px - midX) <= threshold;
  const centerY = Math.abs(box.y + py - midY) <= threshold;
  return {
    x: centerX ? Math.round(midX - px) : box.x,
    y: centerY ? Math.round(midY - py) : box.y,
    centerX,
    centerY
  };
}

/**
 * Should the GM be asked to end the encounter? Only when hostiles were standing at the last look (`before` > 0) and
 * none are now, in a combat that has hostiles at all. Unknown `before` (just started watching) never asks.
 * @param {number|undefined} before  standing hostiles at the last look
 * @param {number} now               standing hostiles now
 * @param {number} total             hostiles in the combat, standing or not
 */
export function shouldAskToEnd(before, now, total) {
  return total > 0 && now === 0 && Number.isFinite(before) && before > 0;
}

/**
 * Where tokens enter and leave the semicircle: one step past each end, continuing the arc's last step in a straight
 * line (a slot further round the circle could curl back inwards). Same size as the end token.
 * @param {Array<{offset: number, x: number, y: number, d: number}>} items  arcLayout items of the full semicircle
 * @returns {{before: {x: number, y: number, d: number}|null, after: {x: number, y: number, d: number}|null}}
 */
export function arcExits(items) {
  const at = offset => items.find(i => i.offset === offset);
  const sides = Math.max(0, ...items.map(i => Math.abs(i.offset)));
  const past = (end, inner) => {
    if (!end || !inner) return null;
    const cx = (end.x + end.d / 2) * 2 - (inner.x + inner.d / 2);
    const cy = (end.y + end.d / 2) * 2 - (inner.y + inner.d / 2);
    const round = v => Math.round(v * 10) / 10;
    return { x: round(cx - end.d / 2), y: round(cy - end.d / 2), d: end.d };
  };
  return { before: past(at(-sides), at(-sides + 1)), after: past(at(sides), at(sides - 1)) };
}

/**
 * Did the combat move backwards (the GM stepped back a turn or a round)? Uses the update's own direction when core
 * gives one (-1 previous, 1 next), otherwise compares the position before and after.
 * @param {{round: number, turn: number}|undefined} before
 * @param {{round: number, turn: number}} after
 * @param {number} [direction]
 */
export function movedBackwards(before, after, direction) {
  if (direction === -1) return true;
  if (direction === 1 || !before) return false;
  return after.round < before.round || (after.round === before.round && after.turn < before.turn);
}
