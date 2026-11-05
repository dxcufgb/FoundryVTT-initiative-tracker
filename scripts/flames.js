/**
 * A short burst of flames rising off a tracker chip when its combatant dies. Drawn on a small canvas in the
 * tracker's own effects layer (re-attached after every render, so a render in the middle doesn't cut it off), which
 * follows the chip while it slides. Only for chips that are in the tracker when the death happens.
 */

const DURATION = 1700;   // whole effect, ms
const EMIT = 1000;       // how long new flames keep coming, ms
const PALETTE = [[255, 214, 110], [255, 150, 40], [235, 80, 20], [170, 30, 20]];

let layer = null;
const bursts = new Set();
let frame = null;

/** The effects layer inside the tracker element (created once, re-attached after renders). */
export function attachFlameLayer(element) {
  if (!element) return;
  layer ??= Object.assign(document.createElement("div"), { className: "dxit-fx" });
  if (layer.parentElement !== element) element.append(layer);
}

/** How many flame bursts are playing (for the Debug Recorder snapshot). */
export function activeFlames() {
  return bursts.size;
}

function lerpColor(t) {
  const x = Math.min(PALETTE.length - 1.001, Math.max(0, t * (PALETTE.length - 1)));
  const i = Math.floor(x);
  const f = x - i;
  return PALETTE[i].map((c, k) => Math.round(c + (PALETTE[i + 1][k] - c) * f));
}

/**
 * Starts flames on the chip of `combatantId` in `element`. Does nothing if that chip isn't shown or the player
 * prefers reduced motion. Returns whether flames started.
 */
export function spawnFlames(element, combatantId) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  const find = () => element?.querySelector(`.dxit-chip[data-combatant-id="${CSS.escape(combatantId)}"]`);
  if (!find()) return false;
  attachFlameLayer(element);
  const canvas = document.createElement("canvas");
  canvas.className = "dxit-flames";
  layer.append(canvas);
  bursts.add({ canvas, find, start: performance.now(), last: performance.now(), particles: [], size: 0 });
  frame ??= requestAnimationFrame(step);
  return true;
}

function step(now) {
  frame = null;
  for (const burst of bursts) {
    const done = draw(burst, now);
    if (done) {
      burst.canvas.remove();
      bursts.delete(burst);
    }
  }
  if (bursts.size) frame = requestAnimationFrame(step);
}

/** Moves the canvas over the chip (CSS pixels of the tracker element) and draws one frame. Returns true when finished. */
function draw(burst, now) {
  const age = now - burst.start;
  const chip = burst.find();
  const host = layer?.parentElement;
  if (!chip || !host || age > DURATION) return true;

  // Where the chip is now, in the tracker's CSS pixels (the tracker may be zoomed with the interface).
  const hostRect = host.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  const scale = hostRect.width / (host.offsetWidth || hostRect.width) || 1;
  const d = chipRect.width / scale;
  const cx = (chipRect.left - hostRect.left) / scale + d / 2;
  const bottom = (chipRect.top - hostRect.top) / scale + d;
  const width = d * 1.8;
  const height = d * 2.4;
  const canvas = burst.canvas;
  canvas.style.left = `${cx - width / 2}px`;
  canvas.style.top = `${bottom - height + d * 0.1}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (burst.size !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    burst.size = canvas.width;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // New flames along the bottom half of the token, fewer as the burst ends.
  const dt = Math.min(50, now - burst.last);
  burst.last = now;
  if (age < EMIT) {
    const count = Math.round((dt / 16) * 2.4 * (1 - (age / EMIT) * 0.5));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI;
      const r = (d / 2) * (0.4 + Math.random() * 0.6);
      burst.particles.push({
        x: width / 2 + Math.cos(a) * r * (Math.random() < 0.5 ? -1 : 1),
        y: height - d * 0.1 - d / 2 + Math.sin(a) * r * 0.6,
        vx: (Math.random() - 0.5) * d * 0.4,
        vy: -(d * (1.1 + Math.random() * 1.1)),
        life: 0,
        max: 420 + Math.random() * 380,
        size: d * (0.14 + Math.random() * 0.14),
        wobble: Math.random() * Math.PI * 2
      });
    }
  }

  // Smoke first (normal blending), then fire on top (additive).
  const s = dt / 1000;
  const alive = [];
  for (const p of burst.particles) {
    p.life += dt;
    if (p.life >= p.max) continue;
    p.x += (p.vx + Math.sin(p.wobble + p.life / 90) * d * 0.25) * s;
    p.y += p.vy * s;
    alive.push(p);
  }
  burst.particles = alive;

  ctx.globalCompositeOperation = "source-over";
  for (const p of alive) {
    const t = p.life / p.max;
    if (t < 0.55) continue;
    const r = p.size * (1 + t);
    ctx.fillStyle = `rgba(50, 46, 44, ${(1 - t) * 0.35})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "lighter";
  for (const p of alive) {
    const t = p.life / p.max;
    if (t >= 0.8) continue;
    const [r, g, b] = lerpColor(t / 0.8);
    const radius = p.size * (1 - t * 0.6);
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.5 * (1 - t)})`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${0.22 * (1 - t)})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  return false;
}
