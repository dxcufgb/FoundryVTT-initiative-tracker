import { test } from "node:test";
import assert from "node:assert/strict";
import { windowTurns, arcLayout, orderNumbers, healthFraction, clampAnchor, nextShown, isRevealed } from "../scripts/order.js";

const turns = ["a", "b", "c", "d", "e"].map(id => ({ id }));
const ids = list => list.map(e => (e.divider ? "|" : e.id)).join("");
const win = (current, placement, max = 0) => windowTurns(turns, current, { placement, max });

test("start: current first, wrapping into the next round", () => {
  assert.equal(ids(win("c", "start").entries), "cde|ab");
  assert.equal(ids(win("a", "start").entries), "abcde");
  assert.equal(ids(win("e", "start").entries), "e|abcd");
});

test("end: current last, the next one right before it", () => {
  assert.equal(ids(win("c", "end").entries), "ba|edc");
});

test("center: current in the middle", () => {
  assert.equal(ids(win("c", "center").entries), "abcde");
  assert.equal(ids(win("a", "center").entries), "de|abc");
  assert.equal(ids(win("c", "center", 3).entries), "bcd");
  assert.equal(win("c", "center", 3).more, 2);
  const offsets = win("a", "center").entries.filter(e => !e.divider).map(e => e.offset);
  assert.deepEqual(offsets, [-2, -1, 0, 1, 2]);
});

test("fixed: initiative order, a limited window keeps the current turn in view", () => {
  assert.equal(ids(win("c", "fixed").entries), "abcde");
  assert.equal(ids(win("e", "fixed", 2).entries), "de");
  assert.equal(ids(win("a", "fixed", 2).entries), "ab");
  assert.equal(ids(win("c", "fixed", 3).entries), "bcd");
});

test("limits: dividers don't count", () => {
  const out = win("c", "start", 4);
  assert.equal(ids(out.entries), "cde|a");
  assert.equal(out.more, 1);
  assert.equal(ids(win("c", "start", 2).entries), "cd");
  assert.equal(win("c", "start", 2).more, 3);
});

test("no current turn (combat not started) is initiative order", () => {
  assert.equal(ids(win(null, "start").entries), "abcde");
  assert.equal(ids(win(null, "center", 2).entries), "ab");
});

test("empty lists", () => {
  assert.deepEqual(windowTurns([], "a"), { entries: [], more: 0 });
  assert.deepEqual(windowTurns(undefined, "a"), { entries: [], more: 0 });
});

test("arcLayout: horizontal arc hangs down with the current turn lowest and in the middle", () => {
  const { width, height, items } = arcLayout([-2, -1, 0, 1, 2], { size: 40, reach: 2 });
  const byOffset = Object.fromEntries(items.map(i => [i.offset, i]));
  const centre = i => ({ x: i.x + i.d / 2, y: i.y + i.d / 2 });
  assert.ok(Math.abs(centre(byOffset[0]).x - width / 2) < 0.5, "current is centred");
  assert.ok(centre(byOffset[0]).y > centre(byOffset[1]).y, "current lower than its neighbour");
  assert.ok(centre(byOffset[1]).y > centre(byOffset[2]).y, "fades up towards the ends");
  assert.ok(centre(byOffset[-1]).x < centre(byOffset[0]).x, "earlier turns on the left");
  assert.ok(byOffset[0].d > byOffset[1].d && byOffset[1].d > byOffset[2].d, "smaller towards the ends");
  assert.ok(byOffset[0].opacity > byOffset[2].opacity, "fades towards the ends");
  for (const i of items) {
    assert.ok(i.x >= 0 && i.y >= 0 && i.x + i.d <= width + 0.2 && i.y + i.d <= height + 0.2, "inside the box");
  }
});

test("arcLayout: flipped and vertical", () => {
  const flipped = arcLayout([-1, 0, 1], { size: 40, reach: 1, flip: true });
  const f = Object.fromEntries(flipped.items.map(i => [i.offset, i]));
  assert.ok(f[0].y < f[1].y, "flipped: current highest");
  const vertical = arcLayout([-1, 0, 1], { size: 40, reach: 1, vertical: true });
  const v = Object.fromEntries(vertical.items.map(i => [i.offset, i]));
  assert.ok(v[0].x > v[1].x, "vertical: current furthest right");
  assert.ok(v[-1].y < v[1].y, "vertical: earlier turns above");
});

test("arcLayout: neighbours don't overlap", () => {
  for (const reach of [1, 2, 3]) {
    const offsets = Array.from({ length: reach * 2 + 1 }, (_, i) => i - reach);
    const items = arcLayout(offsets, { size: 36, reach, taper: true }).items;
    const flat = arcLayout(offsets, { size: 36, reach, taper: false }).items;
    for (let i = 1; i < flat.length; i++) {
      const a = flat[i - 1], b = flat[i];
      assert.ok(Math.hypot(a.x + a.d / 2 - b.x - b.d / 2, a.y + a.d / 2 - b.y - b.d / 2) >= (a.d + b.d) / 2);
    }
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i];
      const dist = Math.hypot(a.x + a.d / 2 - b.x - b.d / 2, a.y + a.d / 2 - b.y - b.d / 2);
      assert.ok(dist >= (a.d + b.d) / 2, `reach ${reach}: ${a.offset} and ${b.offset} overlap`);
    }
  }
  assert.deepEqual(arcLayout([], { size: 36, reach: 1 }), { width: 0, height: 0, items: [] });
});

test("orderNumbers numbers visible turns from 1", () => {
  const numbers = orderNumbers([{ id: "x" }, { id: "y" }]);
  assert.equal(numbers.get("x"), 1);
  assert.equal(numbers.get("y"), 2);
  assert.equal(orderNumbers(null).size, 0);
});

test("healthFraction", () => {
  assert.equal(healthFraction({ value: 5, max: 10 }), 0.5);
  assert.equal(healthFraction({ value: 15, max: 10 }), 1);
  assert.equal(healthFraction({ value: -3, max: 10 }), 0);
  assert.equal(healthFraction({ value: 5 }), null);
  assert.equal(healthFraction({ value: 5, max: 0 }), null);
  assert.equal(healthFraction(null), null);
});

test("clampAnchor keeps the grip on screen", () => {
  const vp = { width: 1000, height: 600 };
  assert.deepEqual(clampAnchor({ x: -50, y: 900 }, vp), { x: 0, y: 576 });
  assert.deepEqual(clampAnchor({ x: 2000, y: 10 }, vp), { x: 976, y: 10 });
  assert.deepEqual(clampAnchor(null, vp), { x: 0, y: 0 });
});

test("sizeFactor: current a quarter bigger, others equal or tapering", async () => {
  const { sizeFactor } = await import("../scripts/order.js");
  assert.equal(sizeFactor(0, false), 1.25);
  assert.equal(sizeFactor(3, false), 1);
  assert.equal(sizeFactor(null, true), 1);
  assert.ok(sizeFactor(1, true) > sizeFactor(2, true));
  assert.equal(sizeFactor(-20, true), 0.5);
  const equal = arcLayout([-1, 0, 1], { size: 40, reach: 1, taper: false }).items;
  assert.equal(equal[0].d, equal[2].d);
  assert.equal(equal[0].d, 40);
});

test("arcSideCount: tapering semicircles fit more turns in the same span", async () => {
  const { arcSideCount } = await import("../scripts/order.js");
  for (const reach of [1, 2, 3]) {
    assert.equal(arcSideCount({ size: 36, reach }), reach);
    const sides = arcSideCount({ size: 36, reach, taper: true });
    assert.ok(sides >= reach, `reach ${reach}: ${sides}`);
    const offsets = n => Array.from({ length: n * 2 + 1 }, (_, i) => i - n);
    const equal = arcLayout(offsets(reach), { size: 36, reach, taper: false });
    const tapered = arcLayout(offsets(sides), { size: 36, reach, taper: true });
    assert.ok(tapered.width <= equal.width + 2, `reach ${reach}: ${tapered.width} vs ${equal.width}`);
  }
  assert.ok(arcSideCount({ size: 36, reach: 2, taper: true }) > 2);
});

test("a wider (elliptic) semicircle keeps its depth and shows more turns", async () => {
  const { arcSideCount } = await import("../scripts/order.js");
  const offsets = n => Array.from({ length: n * 2 + 1 }, (_, i) => i - n);
  for (const taper of [false, true]) {
    for (const reach of [1, 2, 3]) {
      const round = arcSideCount({ size: 36, reach, taper, stretch: 1 });
      const base = arcLayout(offsets(round), { size: 36, reach, taper });
      let last = round;
      for (const stretch of [1.5, 2, 2.5]) {
        const sides = arcSideCount({ size: 36, reach, taper, stretch });
        assert.ok(sides >= last, `more or as many turns as it widens (${reach}, ${stretch})`);
        last = sides;
        const wide = arcLayout(offsets(sides), { size: 36, reach, taper, stretch });
        assert.ok(wide.height <= base.height + 1, `depth kept: ${wide.height} vs ${base.height}`);
        assert.ok(wide.width >= base.width, "wider");
        for (let i = 1; i < wide.items.length; i++) {
          const a = wide.items[i - 1], b = wide.items[i];
          assert.ok(Math.hypot(a.x + a.d / 2 - b.x - b.d / 2, a.y + a.d / 2 - b.y - b.d / 2) >= (a.d + b.d) / 2 - 0.2, "no overlap");
        }
      }
    }
  }
  assert.ok(arcSideCount({ size: 36, reach: 2, stretch: 2.5 }) > 2);
  assert.equal(arcSideCount({ size: 36, reach: 2, stretch: 1 }), 2);
});

test("snapToCentre snaps near the centre lines only", async () => {
  const { snapToCentre } = await import("../scripts/order.js");
  const vp = { width: 1000, height: 600 };
  assert.deepEqual(snapToCentre({ x: 395, y: 40, width: 200, height: 50 }, vp), { x: 400, y: 40, centerX: true, centerY: false });
  assert.deepEqual(snapToCentre({ x: 20, y: 268, width: 60, height: 50 }, vp), { x: 20, y: 275, centerX: false, centerY: true });
  assert.deepEqual(snapToCentre({ x: 100, y: 100, width: 60, height: 50 }, vp), { x: 100, y: 100, centerX: false, centerY: false });
  const both = snapToCentre({ x: 470, y: 270, width: 60, height: 60 }, vp);
  assert.equal(both.centerX && both.centerY, true);
});

test("shouldAskToEnd: only when the last standing hostile falls", async () => {
  const { shouldAskToEnd } = await import("../scripts/order.js");
  assert.equal(shouldAskToEnd(1, 0, 3), true);
  assert.equal(shouldAskToEnd(0, 0, 3), false, "already none: asked before");
  assert.equal(shouldAskToEnd(undefined, 0, 3), false, "just started watching");
  assert.equal(shouldAskToEnd(2, 1, 3), false);
  assert.equal(shouldAskToEnd(1, 0, 0), false, "no hostiles in the fight");
});

test("arcLayout keeps the full semicircle's box with few turns, and places slots past the ends outside it", () => {
  const full = [-2, -1, 0, 1, 2];
  const all = arcLayout(full, { size: 36, reach: 2, sides: 2, boxOffsets: full });
  const few = arcLayout([-1, 0, 1], { size: 36, reach: 2, sides: 2, boxOffsets: full });
  assert.equal(few.width, all.width);
  assert.equal(few.height, all.height);
  const same = (a, b) => assert.ok(Math.abs(a.x - b.x) < 0.2 && Math.abs(a.y - b.y) < 0.2);
  same(few.items.find(i => i.offset === 0), all.items.find(i => i.offset === 0));
  same(few.items.find(i => i.offset === -1), all.items.find(i => i.offset === -1));
});

test("arcExits: one step past each end, outside the box", async () => {
  const { arcExits } = await import("../scripts/order.js");
  for (const reach of [1, 2, 3]) {
    const full = Array.from({ length: reach * 2 + 1 }, (_, i) => i - reach);
    const { width, items } = arcLayout(full, { size: 36, reach, sides: reach, boxOffsets: full });
    const { before, after } = arcExits(items);
    assert.ok(before.x + before.d / 2 < items.find(i => i.offset === -reach).x + 18, `reach ${reach}: before is left of the end`);
    assert.ok(after.x + after.d / 2 > width - 18, `reach ${reach}: after is right of the end`);
  }
});

test("movedBackwards", async () => {
  const { movedBackwards } = await import("../scripts/order.js");
  assert.equal(movedBackwards({ round: 2, turn: 3 }, { round: 2, turn: 2 }), true, "previous turn");
  assert.equal(movedBackwards({ round: 2, turn: 0 }, { round: 1, turn: 5 }), true, "previous round");
  assert.equal(movedBackwards({ round: 2, turn: 5 }, { round: 3, turn: 0 }), false, "next round");
  assert.equal(movedBackwards({ round: 2, turn: 1 }, { round: 2, turn: 2 }), false, "next turn");
  assert.equal(movedBackwards(undefined, { round: 2, turn: 2 }), false, "nothing known");
  assert.equal(movedBackwards({ round: 2, turn: 1 }, { round: 2, turn: 4 }, -1), true, "core says previous");
});

test("afterHidden: the next shown turn takes the hidden current turn's place, one step on", () => {
  const out = windowTurns(turns, "c", { placement: "start", afterHidden: true });
  assert.equal(ids(out.entries), "cde|ab");
  assert.deepEqual(out.entries.filter(e => !e.divider).map(e => e.offset), [1, 2, 3, 4, 5]);
});

test("nextShown: the next visible turn after a hidden current one, wrapping", () => {
  const all = ["a", "b", "c", "d"];
  assert.equal(nextShown(all, new Set(["a", "d"]), "b"), "d");
  assert.equal(nextShown(all, new Set(["a"]), "c"), "a");
  assert.equal(nextShown(all, new Set(), "c"), null);
  assert.equal(nextShown(all, new Set(["a"]), "x"), null);
});

test("isRevealed: round 1 shows allies, others once their turn has come", () => {
  // pc, enemy, pc, enemy, pc, enemy; turn 0 = first pc.
  const order = [true, false, true, false, true, false];
  const seen = state => order.map((known, index) => (isRevealed({ index, known }, state) ? index : null))
    .filter(i => i !== null);
  assert.deepEqual(seen({ started: true, round: 1, turn: 0 }), [0, 2, 4]);
  assert.deepEqual(seen({ started: true, round: 1, turn: 1 }), [0, 1, 2, 4]);
  assert.deepEqual(seen({ started: true, round: 1, turn: 3 }), [0, 1, 2, 3, 4]);
  assert.deepEqual(seen({ started: true, round: 2, turn: 0 }), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(seen({ started: false, round: 0, turn: null }), [0, 2, 4]);
});

test("snapToCentre puts the pivot (the middle token) on the line", async () => {
  const { snapToCentre } = await import("../scripts/order.js");
  const vp = { width: 1000, height: 600 };
  assert.deepEqual(snapToCentre({ x: 430, y: 40, width: 200, height: 50, pivotX: 80, pivotY: 25 }, vp),
    { x: 420, y: 40, centerX: true, centerY: false });
});
