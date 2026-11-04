/**
 * The compact tracker: one fixed element over the canvas with the visible combatants' tokens. It is not an
 * Application window: it has no frame, takes no focus and lets clicks through everywhere except on its own frame.
 *
 * The tracker is anchored on its drag grip: the grip's top-left corner sits at the saved position (kept on screen),
 * and the tracker grows away from it, so the grip can always be grabbed however big the tracker gets. Without a
 * saved position it sits centred under the scene navigation (horizontal) or at the left edge of the map (vertical).
 *
 * The element is created once; a render replaces its inner HTML and re-binds the chip listeners. Renders are
 * debounced, so many hook calls in a row cost one render.
 */
import { MODULE_ID, TEMPLATE_PATH, escapeHTML, setting, clamp, t } from "./util.js";
import { countHostiles, isDown, isDead, JUMP_OPTION } from "./encounter.js";
import { spawnFlames, attachFlameLayer } from "./flames.js";
import { windowTurns, arcLayout, arcSideCount, arcExits, healthFraction, clampAnchor, sizeFactor, snapToCentre } from "./order.js";

const ELEMENT_ID = "dxit-tracker";
const GRIP = 24;

let element = null;
let expanded = false;
let renderId = 0;
/** Combatants that were defeated at the last render, so a new defeat can be animated once. */
let lastDefeated = null;
/** Combatants that were dead at the last render, so flames only play when one dies. */
let lastDead = null;
/** True while the player drags the tracker: renders then leave its position alone. */
let dragging = false;
const thumbnails = new Map();
const MOVE_MS = 380;

/* -------------------------------------------- */
/*  Data                                        */
/* -------------------------------------------- */

/** The combat the tracker follows: the one the core tracker shows. */
export function trackedCombat() {
  return game.combat ?? null;
}

/**
 * Combatants this user may see, in initiative order: the core tracker's rule (not hidden in the combat), and for
 * players also not a token the GM has hidden on the map, unless it is their own.
 */
export function visibleCombatants(combat) {
  return (combat?.turns ?? []).filter(c => c.visible && (game.user.isGM || c.isOwner || !c.token?.hidden));
}

/** Is the combatant's token invisible: hidden on the map by the GM, or carrying the Invisible status? */
function isInvisible(combatant) {
  const token = combatant.token;
  if (!token) return false;
  if (token.hidden) return true;
  const id = CONFIG.specialStatusEffects?.INVISIBLE ?? "invisible";
  return !!(token.hasStatusEffect?.(id) ?? combatant.actor?.statuses?.has?.(id));
}

/** May this user see the combatant's health? GMs and owners always; others by the world setting. */
export function canSeeHealth(combatant) {
  if (game.user.isGM || combatant.isOwner) return true;
  const rule = game.settings.get(MODULE_ID, "playerHealth");
  if (rule === "all") return true;
  if (rule === "friendly") return combatant.token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  return false;
}

/** The ring colour of a chip as a CSS colour, or "" for none. */
function ringColor(combatant) {
  const mode = setting("ringColor");
  if (mode === "none") return "";
  const actor = combatant.actor;
  if (mode === "player" && actor) {
    const user = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
    if (user?.color) return Color.from(user.color).css;
  }
  const colors = CONFIG.Canvas?.dispositionColors ?? {};
  const D = CONST.TOKEN_DISPOSITIONS;
  const disposition = combatant.token?.disposition ?? D.NEUTRAL;
  let value;
  if (disposition === D.SECRET) value = colors.SECRET;
  else if (disposition === D.FRIENDLY) value = actor?.hasPlayerOwner ? (colors.PARTY ?? colors.FRIENDLY) : colors.FRIENDLY;
  else if (disposition === D.HOSTILE) value = colors.HOSTILE;
  else value = colors.NEUTRAL;
  return value === undefined ? "" : Color.from(value).css;
}

/** The image of a combatant; video tokens get a still thumbnail (cached). */
async function combatantImage(combatant) {
  const src = combatant.img || combatant.token?.texture?.src || combatant.actor?.img || CONST.DEFAULT_TOKEN;
  const VideoHelper = foundry.helpers?.media?.VideoHelper ?? globalThis.VideoHelper;
  if (!VideoHelper?.hasVideoExtension?.(src)) return src;
  if (thumbnails.has(src)) return thumbnails.get(src);
  try {
    const thumb = await game.video.createThumbnail(src, { width: 100, height: 100 });
    thumbnails.set(src, thumb);
    return thumb;
  } catch {
    return combatant.actor?.img || CONST.DEFAULT_TOKEN;
  }
}

function formatInitiative(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "–";
  const n = Number(value);
  return String(Number.isInteger(n) ? n : Math.floor(n));
}

async function turnData(c, currentId) {
  const bar = setting("showHealth") && canSeeHealth(c) ? c.token?.getBarAttribute?.("bar1") : null;
  const hp = healthFraction(bar);
  const name = escapeHTML(c.name);
  const init = formatInitiative(c.initiative);
  const lines = [`<strong>${name}</strong>`, `${escapeHTML(t("Tooltip.Initiative"))}: ${init}`];
  if (hp !== null) lines.push(`${escapeHTML(t("Tooltip.Health"))}: ${Math.round(bar.value)} / ${Math.round(bar.max)}`);
  const down = isDown(c);
  if (c.isDefeated) lines.push(escapeHTML(t("Tooltip.Defeated")));
  else if (down) lines.push(escapeHTML(t("Tooltip.Down")));
  if (c.hidden) lines.push(escapeHTML(t("Tooltip.Hidden")));
  if (game.user.isGM && currentId && c.id !== currentId) lines.push(`<em>${escapeHTML(t("Tooltip.Menu"))}</em>`);
  const invisible = isInvisible(c);
  if (invisible) lines.push(escapeHTML(t("Tooltip.Invisible")));
  return {
    id: c.id,
    name,
    img: await combatantImage(c),
    initiative: init,
    active: c.id === currentId,
    owner: c.isOwner,
    hidden: c.hidden,
    invisible,
    defeated: c.isDefeated,
    down,
    // The skull is for the dead only (defeated, Dead, an NPC at 0); a player character at 0 is just down.
    dead: isDead(c),
    // A fallen combatant's ring is grey, whatever its disposition or player colour.
    ring: c.isDefeated || down ? "#7a7a7a" : ringColor(c),
    hp: hp === null ? null : { pct: Math.round(hp * 100), low: hp <= 0.25 },
    tooltip: lines.join("<br>")
  };
}

/** combat id -> standing hostiles at the last render, so a drop can be animated. */
const lastHostiles = new Map();

/** The hostile counter: hostiles still standing among the combatants this user can see. */
function hostileContext(combat) {
  const { standing, total } = countHostiles(visibleCombatants(combat));
  if (!total) return null;
  const before = lastHostiles.get(combat.id);
  lastHostiles.set(combat.id, standing);
  return { standing, total, dropped: Number.isFinite(before) && standing < before, cleared: standing === 0 };
}

/** Everything the template needs. */
async function prepareContext(combat) {
  const layout = setting("layout");
  const vertical = setting("orientation") === "vertical";
  const size = clamp(setting("size"), 24, 96, 36);
  const currentId = combat.started ? combat.combatant?.id ?? null : null;
  const turns = await Promise.all(visibleCombatants(combat).map(c => turnData(c, currentId)));

  let entries;
  let more = 0;
  let arc = null;
  const taper = setting("sizing") === "taper";
  const limit = clamp(setting("maxVisible"), 0, 30, 0);

  if (layout === "arc") {
    const reach = clamp(setting("arcReach"), 1, 3, 2);
    const stretch = clamp(setting("arcWidth"), 100, 250, 100) / 100;
    const sides = arcSideCount({ size, reach, taper, stretch });
    const windowed = windowTurns(turns, currentId, { placement: "center", max: sides * 2 + 1 });
    const chips = windowed.entries.filter(e => !e.divider && e.offset !== null);
    const flip = !!setting("arcFlip");
    // Always the full semicircle's size: with few turns the ends stay empty and the turns sit next to the current one.
    const full = Array.from({ length: sides * 2 + 1 }, (_, i) => i - sides);
    const options = { size, reach, vertical, taper, stretch, fade: clamp(setting("arcFade"), 0, 90, 60), flip, sides, boxOffsets: full };
    const placed = arcLayout(chips.map(c => c.offset), options);
    const exits = arcExits(arcLayout(full, options).items);
    entries = [];
    let index = -1;
    for (const entry of windowed.entries) {
      if (!entry.divider) {
        if (entry.offset === null) continue;
        index++;
        const p = placed.items[index];
        // A fallen token stays dimmed on top of the arc's own fade (the inline opacity would override the CSS).
        const fallen = entry.defeated || entry.down ? (entry.active ? 0.6 : 0.35) : 1;
        const opacity = Math.round(p.opacity * fallen * 100) / 100;
        entries.push({ ...entry, side: Math.sign(entry.offset), geometry: `left: ${p.x}px; top: ${p.y}px; width: ${p.d}px; height: ${p.d}px; opacity: ${opacity};` });
        continue;
      }
      // The round line: halfway between the two turns where the round wraps, crossing the arc there.
      const a = placed.items[index];
      const b = placed.items[index + 1];
      if (!a || !b) continue;
      const ax = a.x + a.d / 2, ay = a.y + a.d / 2, bx = b.x + b.d / 2, by = b.y + b.d / 2;
      const length = Math.round(size * 0.8);
      const angle = Math.round((Math.atan2(by - ay, bx - ax) * 180) / Math.PI);
      // Centred in the gap between the two tokens (not between their centres: the current one is bigger).
      const dist = Math.hypot(bx - ax, by - ay) || 1;
      const along = a.d / 2 + Math.max(0, dist - a.d / 2 - b.d / 2) / 2;
      const mx = ax + ((bx - ax) / dist) * along;
      const my = ay + ((by - ay) / dist) * along;
      const left = Math.round((mx - 1) * 10) / 10;
      const top = Math.round((my - length / 2) * 10) / 10;
      entries.push({ divider: true, rotate: angle, style: `left: ${left}px; top: ${top}px; height: ${length}px; transform: rotate(${angle}deg);` });
    }
    const centre = placed.items.find(p => p.offset === 0);
    arc = {
      width: placed.width,
      height: placed.height,
      // Where tokens slide in from and out to: just past each end ("x,y,d").
      exitBefore: exits.before ? `${exits.before.x},${exits.before.y},${exits.before.d}` : "",
      exitAfter: exits.after ? `${exits.after.x},${exits.after.y},${exits.after.d}` : "",
      // End turn goes inside the semicircle, moved from the current turn towards the circle's centre.
      inward: vertical ? (flip ? "1,0" : "-1,0") : (flip ? "0,1" : "0,-1")
    };
  } else {
    const pill = layout === "pill";
    let placement = setting("placement");
    if (pill && placement === "fixed") placement = "start";
    const max = expanded ? 0 : (pill ? (placement === "center" ? 3 : 2) : limit);
    ({ entries, more } = windowTurns(turns, currentId, { placement, max }));
  }

  // The round line keeps its identity (the two turns it sits between), so it can slide with the tokens.
  entries.forEach((entry, i) => {
    if (!entry.divider) return;
    const before = entries.slice(0, i).reverse().find(e => !e.divider);
    const after = entries.slice(i + 1).find(e => !e.divider);
    entry.flip = `round:${before?.id ?? ""}|${after?.id ?? ""}`;
  });
  for (const entry of entries) {
    if (entry.divider) continue;
    const scale = entry.geometry ? "" : `--dxit-scale: ${entry.active ? 1.25 : sizeFactor(entry.offset, taper)};`;
    entry.style = [entry.ring ? `--dxit-ring: ${entry.ring};` : "", scale, entry.geometry ?? ""].join(" ").trim();
  }

  const current = combat.combatant;
  const isGM = game.user.isGM;
  const hostiles = setting("showHostiles") && combat.started ? hostileContext(combat) : null;
  const showButtons = !!setting("showControls");
  const gmControls = showButtons && isGM;
  // NPCs (no player owner) in the combat that haven't rolled initiative yet: the GM gets a "Roll NPCs" button.
  const unrolledNPCs = gmControls ? combat.combatants.filter(c => c.isNPC && c.initiative === null).length : 0;
  const canEndTurn = showButtons && combat.started && !!current?.isOwner;
  // Where End turn goes: inside a horizontal semicircle; otherwise with the other buttons (under them when vertical).
  const arcEndTurn = !!arc && !vertical && canEndTurn;
  return {
    entries,
    more,
    arc,
    canCollapse: !arc && expanded && (layout === "pill" || limit > 0),
    vertical,
    tooltipDirection: vertical ? "RIGHT" : "DOWN",
    started: combat.started,
    round: combat.round,
    showRound: setting("showRound"),
    hostiles,
    showStatus: !!setting("showRound") || !!hostiles,
    showInitiative: setting("showInitiative"),
    gmControls,
    unrolledNPCs,
    canEndTurn,
    arcEndTurn,
    actionsEndTurn: canEndTurn && !arcEndTurn,
    hasActions: gmControls || (canEndTurn && !arcEndTurn)
  };
}

/* -------------------------------------------- */
/*  Element and placement                       */
/* -------------------------------------------- */

function ensureElement() {
  if (element?.isConnected) return element;
  element = document.createElement("section");
  element.id = ELEMENT_ID;
  element.className = "dxit";
  element.setAttribute("aria-label", t("Title"));
  document.body.append(element);
  element.addEventListener("click", onClick);
  element.addEventListener("dblclick", onDoubleClick);
  element.addEventListener("contextmenu", event => {
    // Never the browser's own menu on the tracker; tokens get Foundry's context menu below.
    if (event.target.closest?.(".dxit-frame")) event.preventDefault();
    if (event.target.closest?.(".dxit-chip")) liftContextMenu();
  });
  createContextMenu(element);
  element.addEventListener("pointerdown", onGripDown);
  return element;
}

function viewport() {
  return { width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight };
}

/**
 * The centre lines the tracker snaps to, in screen pixels: the middle of the screen top to bottom, and left to right
 * either the middle of the screen or (setting "Centre line follows the sidebar") the middle of the area left of the
 * sidebar, which moves as the sidebar opens and closes.
 */
export function centreLines() {
  const vp = viewport();
  let right = vp.width;
  if (setting("centreFollowsSidebar")) {
    // The visible part of the sidebar: its tab strip, plus its content when that has slid in (v13 slides the content
    // in from off-screen with a margin; #ui-right also holds the chat-notification column, so it isn't used).
    for (const id of ["sidebar-tabs", "sidebar-content", "sidebar"]) {
      const rect = document.getElementById(id)?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.left < vp.width - 1 && rect.left > vp.width / 3) right = Math.min(right, rect.left);
    }
  }
  return { x: right / 2, y: vp.height / 2 };
}

/**
 * Moves the tracker so its top-left corner lands on `target` in screen pixels. The position is measured after
 * setting it and corrected, so it also lands right when the page is zoomed or Foundry scales its interface.
 */
function moveTo(target) {
  let left = target.x;
  let top = target.y;
  for (let i = 0; i < 4; i++) {
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    const rect = element.getBoundingClientRect();
    const dx = target.x - rect.left;
    const dy = target.y - rect.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
    left += dx;
    top += dy;
  }
}

/**
 * The default spot when the player hasn't moved the tracker: horizontal centred near the top of the map,
 * vertical at the left edge of the map, centred top to bottom. In screen pixels.
 */
function defaultAnchor() {
  const vp = viewport();
  const area = document.getElementById("ui-middle")?.getBoundingClientRect();
  const usable = area && area.width > 100 && area.height > 100
    ? area : { left: 0, top: 0, width: vp.width, height: vp.height };
  const rect = element.getBoundingClientRect();
  if (setting("orientation") === "vertical") {
    return { x: usable.left + 8, y: Math.max(8, usable.top + (usable.height - rect.height) / 2) };
  }
  return { x: usable.left + (usable.width - rect.width) / 2, y: usable.top + 56 };
}

/** Puts the grip's top-left corner at the saved (or default) position, always on screen. */
export function place() {
  if (!element?.isConnected || dragging) return;
  const saved = setting("position");
  let target = saved && Number.isFinite(saved.x) ? { x: saved.x, y: saved.y } : defaultAnchor();
  if (saved?.centerX || saved?.centerY) {
    // Snapped to the middle of the screen: stay centred whatever the tracker's size now.
    const rect = element.getBoundingClientRect();
    const centre = centreLines();
    if (saved.centerX) target.x = centre.x - rect.width / 2;
    if (saved.centerY) target.y = centre.y - rect.height / 2;
  }
  moveTo(clampAnchor(target, viewport(), GRIP));
}

/** The dashed centre lines shown while a dragged tracker is snapped to the middle of the screen. */
function guides() {
  let v = document.getElementById("dxit-guide-v");
  let h = document.getElementById("dxit-guide-h");
  if (!v) {
    v = Object.assign(document.createElement("div"), { id: "dxit-guide-v", className: "dxit-guide dxit-guide--v" });
    h = Object.assign(document.createElement("div"), { id: "dxit-guide-h", className: "dxit-guide dxit-guide--h" });
    document.body.append(v, h);
  }
  const accent = Color.from(setting("accent") || "#ff6400").css;
  v.style.setProperty("--dxit-accent", accent);
  h.style.setProperty("--dxit-accent", accent);
  return { v, h };
}

function removeGuides() {
  document.getElementById("dxit-guide-v")?.remove();
  document.getElementById("dxit-guide-h")?.remove();
}

function applyLook() {
  const vertical = setting("orientation") === "vertical";
  element.className = [
    "dxit",
    `dxit--${vertical ? "vertical" : "horizontal"}`,
    `dxit--layout-${setting("layout")}`,
    `dxit--shape-${setting("shape")}`,
    `dxit--theme-${setting("theme")}`
  ].join(" ");
  element.style.setProperty("--dxit-size", `${clamp(setting("size"), 24, 96, 36)}px`);
  element.style.setProperty("--dxit-accent", Color.from(setting("accent") || "#ff6400").css);
  element.style.setProperty("--dxit-bg-alpha", String(clamp(setting("opacity"), 0, 100, 70) / 100));
}

/* -------------------------------------------- */
/*  Render                                      */
/* -------------------------------------------- */

async function render() {
  const id = ++renderId;
  const combat = trackedCombat();
  const show = setting("enabled") && combat
    && visibleCombatants(combat).length > 0
    && (combat.started || game.user.isGM);
  if (!show) {
    element?.remove();
    element = null;
    lastDefeated = null;
    lastDead = null;
    return;
  }
  const context = await prepareContext(combat);
  if (id !== renderId) return; // a newer render started while this one waited
  const renderTemplate = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  const html = await renderTemplate(`${TEMPLATE_PATH}/tracker.hbs`, context);
  if (id !== renderId) return;
  const fresh = !element?.isConnected;
  ensureElement();
  const before = fresh ? new Map() : chipRects();
  const leaving = fresh ? [] : arcChipsBefore();
  applyLook();
  element.innerHTML = html;
  attachFlameLayer(element);
  markNewDefeats(combat, fresh);
  fitArcEndTurn();
  bindChips();
  place();
  animateChips(before, fresh);
  slideArcChips(before, leaving, fresh);
  Hooks.callAll("dxcufgbsInitiativeTrackerRender", element, combat, context);
}

/**
 * Puts the semicircle's End turn button inside the arc: centred halfway between the current turn and the far edge
 * of the arc (or just inside the current turn if that is closer), then moved towards the circle's centre until it
 * touches no token. If that is beyond the arc's box, the box gets a margin so the
 * frame grows around the button. Works in CSS pixels (offsets), so page zoom doesn't matter.
 */
function fitArcEndTurn() {
  const box = element.querySelector(".dxit-arc-box");
  const button = box?.querySelector(".dxit-end-turn--arc");
  const current = box?.querySelector(".dxit-chip--active");
  if (!button) return;
  if (!current) return button.remove();
  const [dx, dy] = (button.dataset.inward ?? "0,-1").split(",").map(Number);
  const chips = [...box.querySelectorAll(".dxit-chip")].map(c => ({
    left: c.offsetLeft - 2, top: c.offsetTop - 2, right: c.offsetLeft + c.offsetWidth + 2, bottom: c.offsetTop + c.offsetHeight + 2
  }));
  const bw = button.offsetWidth;
  const bh = button.offsetHeight;
  const cx = current.offsetLeft + current.offsetWidth / 2;
  const cy = current.offsetTop + current.offsetHeight / 2;
  const half = dx ? bw / 2 : bh / 2;
  let dist = current.offsetWidth / 2 + 3 + half;
  if (dy) {
    // Horizontal: start halfway between the current turn and the far edge of the arc, so it isn't cramped.
    const edge = current.offsetTop + (dy < 0 ? 0 : current.offsetHeight);
    const far = dy < 0 ? 0 : box.offsetHeight;
    dist = Math.max(dist, Math.abs((edge + far) / 2 - cy));
  }
  let rect;
  for (let i = 0; i < 400; i++, dist += 1) {
    const x = cx + dx * dist - bw / 2;
    const y = cy + dy * dist - bh / 2;
    rect = { left: x, top: y, right: x + bw, bottom: y + bh };
    if (!chips.some(c => c.left < rect.right && c.right > rect.left && c.top < rect.bottom && c.bottom > rect.top)) break;
  }
  button.style.left = `${Math.round(rect.left)}px`;
  button.style.top = `${Math.round(rect.top)}px`;
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  box.style.margin = [
    Math.max(0, -rect.top), Math.max(0, rect.right - width), Math.max(0, rect.bottom - height), Math.max(0, -rect.left)
  ].map(v => `${Math.ceil(v)}px`).join(" ");
}

/** Everything that moves between renders: the chips (by combatant id) and [data-flip] parts, plus the frame size. */
const FLIP_SELECTOR = ".dxit-chip, [data-flip]";
const flipKey = el => el.dataset.flip ?? `c:${el.dataset.combatantId}`;

/** Screen rectangles of the moving parts, and the frame's size in CSS pixels. */
function chipRects() {
  const rects = new Map();
  for (const el of element.querySelectorAll(FLIP_SELECTOR)) {
    const rect = el.getBoundingClientRect();
    rects.set(flipKey(el), { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, rotate: Number(el.dataset.rotate) || 0 });
  }
  const frame = element.querySelector(".dxit-frame");
  if (frame) rects.set("frame", { width: frame.offsetWidth, height: frame.offsetHeight });
  return rects;
}

/**
 * Chips of combatants defeated or down since the last render fade to grey (CSS dxit-chip--dying); dead ones then get
 * their skull.
 */
function markNewDefeats(combat, fresh) {
  const now = new Set(combat.combatants.filter(c => c.isDefeated || isDown(c)).map(c => c.id));
  if (!fresh && lastDefeated) {
    for (const id of now) {
      if (lastDefeated.has(id)) continue;
      element.querySelector(`.dxit-chip[data-combatant-id="${CSS.escape(id)}"]`)?.classList.add("dxit-chip--dying");
    }
  }
  lastDefeated = now;

  // Flames for a combatant that has just died, on its chip if the chip is shown.
  const dead = new Set(combat.combatants.filter(c => isDead(c)).map(c => c.id));
  if (!fresh && lastDead && setting("deathFlames")) {
    for (const id of dead) if (!lastDead.has(id)) spawnFlames(element, id);
  }
  lastDead = dead;
}

/** The semicircle's chips before a render: their markup and side, so the ones that leave can slide out. */
function arcChipsBefore() {
  const arc = element?.querySelector(".dxit-list.dxit-arc");
  if (!arc) return [];
  return [...arc.querySelectorAll(".dxit-chip")].map(chip => ({
    id: chip.dataset.combatantId, side: Number(chip.dataset.side) || 0, html: chip.outerHTML
  }));
}

/** "x,y,d" -> {x, y, d} */
const parseSlot = value => {
  const [x, y, d] = String(value ?? "").split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(d) ? { x, y, d } : null;
};

/**
 * Semicircle only: tokens that join slide in along the arc from just past its end, and tokens that leave slide out
 * past the other end and fade, instead of popping in and out. The arc keeps its size, so old and new positions are in
 * the same box.
 */
function slideArcChips(before, leaving, fresh) {
  const arc = element.querySelector(".dxit-list.dxit-arc");
  if (fresh || !arc || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const exits = { [-1]: parseSlot(arc.dataset.exitBefore), [1]: parseSlot(arc.dataset.exitAfter) };
  const timing = { duration: MOVE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  const offsetTo = (chip, slot) => {
    const dx = slot.x + slot.d / 2 - (chip.offsetLeft + chip.offsetWidth / 2);
    const dy = slot.y + slot.d / 2 - (chip.offsetTop + chip.offsetHeight / 2);
    return `translate(${dx}px, ${dy}px) scale(${slot.d / (chip.offsetWidth || slot.d)})`;
  };
  // A token that went out one end and came back in at the other (a short fight wrapping round) does both, rather
  // than cutting straight across the arc.
  const oldSide = new Map(leaving.map(old => [old.id, old.side]));
  const wrapped = new Set();
  for (const chip of arc.querySelectorAll(".dxit-chip")) {
    const was = oldSide.get(chip.dataset.combatantId);
    const now = Number(chip.dataset.side) || 0;
    if (was && now && was !== now) wrapped.add(chip.dataset.combatantId);
  }
  // Joining: from the end it comes in at.
  for (const chip of arc.querySelectorAll(".dxit-chip")) {
    if (before.has(`c:${chip.dataset.combatantId}`) && !wrapped.has(chip.dataset.combatantId)) continue;
    const slot = exits[Number(chip.dataset.side)];
    if (!slot) continue;
    chip.getAnimations().forEach(a => a.cancel());
    chip.animate([{ transformOrigin: "center", transform: offsetTo(chip, slot), opacity: 0 },
      { transformOrigin: "center", transform: "none" }], timing);
  }
  // Leaving: a copy of the old chip slides past its end and fades, then goes away.
  const present = new Set([...arc.querySelectorAll(".dxit-chip")].map(c => c.dataset.combatantId));
  for (const old of leaving) {
    if ((present.has(old.id) && !wrapped.has(old.id)) || !old.side) continue;
    const slot = exits[old.side];
    if (!slot) continue;
    const holder = document.createElement("template");
    holder.innerHTML = old.html.trim();
    const ghost = holder.content.firstElementChild;
    if (!ghost) continue;
    ghost.classList.add("dxit-chip--leaving");
    ghost.removeAttribute("data-tooltip");
    arc.append(ghost);
    ghost.animate([{ transformOrigin: "center", transform: "none" },
      { transformOrigin: "center", transform: offsetTo(ghost, slot), opacity: 0 }], timing)
      .finished.finally(() => ghost.remove());
  }
}

/**
 * Slides every chip from where it was to where it is now, growing or shrinking on the way (FLIP); the End turn
 * button, the button row and the round number slide along, and the frame grows or shrinks smoothly to its new size.
 * New parts fade in. Nothing animates when the player prefers reduced motion.
 */
function animateChips(before, fresh) {
  if (fresh || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const timing = { duration: MOVE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  for (const el of element.querySelectorAll(FLIP_SELECTOR)) {
    const isChip = el.classList.contains("dxit-chip");
    const old = before.get(flipKey(el));
    const now = el.getBoundingClientRect();
    if (!now.width && !now.height) continue;
    if (el.classList.contains("dxit-divider")) {
      // The round line: slide its centre, and turn it from its old angle to its new one.
      const rotate = Number(el.dataset.rotate) || 0;
      if (!old) {
        el.animate([{ opacity: 0 }, {}], { duration: MOVE_MS, easing: "ease-out" });
        continue;
      }
      const dx = old.cx - (now.left + now.width / 2);
      const dy = old.cy - (now.top + now.height / 2);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && old.rotate === rotate) continue;
      el.animate(
        [{ transformOrigin: "center", transform: `translate(${dx}px, ${dy}px) rotate(${old.rotate}deg)` },
          { transformOrigin: "center", transform: `rotate(${rotate}deg)` }],
        timing
      );
      continue;
    }
    if (!old) {
      el.animate([{ opacity: 0, transform: isChip ? "scale(0.6)" : "none" }, {}], { duration: MOVE_MS, easing: "ease-out" });
      continue;
    }
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    const sx = isChip ? old.width / now.width : 1;
    const sy = isChip ? old.height / now.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    // Keep any transform the part already has (the semicircle's End turn has none; it is placed by left/top).
    el.animate(
      [{ transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: "top left", transform: "none" }],
      timing
    );
  }
  const frame = element.querySelector(".dxit-frame");
  const was = before.get("frame");
  if (frame && was) {
    const width = frame.offsetWidth;
    const height = frame.offsetHeight;
    if (Math.abs(was.width - width) > 0.5 || Math.abs(was.height - height) > 0.5) {
      frame.animate(
        [{ boxSizing: "border-box", width: `${was.width}px`, height: `${was.height}px` },
          { boxSizing: "border-box", width: `${width}px`, height: `${height}px` }],
        timing
      );
    }
  }
}

/** Re-renders the tracker, at most a few times a second. */
export const refresh = foundry.utils.debounce(() => {
  render().catch(err => console.error(`${MODULE_ID} | render failed`, err));
}, 50);

/** Shows or hides the tracker for this user (the "Show the tracker" setting). */
export async function toggle(force) {
  const value = typeof force === "boolean" ? force : !game.settings.get(MODULE_ID, "enabled");
  await game.settings.set(MODULE_ID, "enabled", value);
  return value;
}

/** Marks the chip of a hovered token on the canvas. */
export function markHovered(tokenDoc, hovered) {
  if (!element) return;
  const combat = trackedCombat();
  const ids = (combat?.combatants ?? []).filter(c => c.tokenId === tokenDoc?.id).map(c => c.id);
  for (const id of ids) {
    element.querySelector(`.dxit-chip[data-combatant-id="${CSS.escape(id)}"]`)?.classList.toggle("dxit-chip--hovered", !!hovered);
  }
}

/* -------------------------------------------- */
/*  Interaction                                 */
/* -------------------------------------------- */

function combatantOf(el) {
  const id = el?.closest?.(".dxit-chip")?.dataset.combatantId;
  return id ? trackedCombat()?.combatants.get(id) ?? null : null;
}

function bindChips() {
  for (const chip of element.querySelectorAll(".dxit-chip")) {
    chip.addEventListener("pointerenter", event => {
      const token = combatantOf(chip)?.token?.object;
      if (token?.visible && !token.controlled) token._onHoverIn?.(event, { hoverOutOthers: true });
    });
    chip.addEventListener("pointerleave", event => {
      const token = combatantOf(chip)?.token?.object;
      if (token?.hover) token._onHoverOut?.(event);
    });
  }
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (button) return onAction(event, button.dataset.action);
  const combatant = combatantOf(event.target);
  if (!combatant) return;
  event.preventDefault();
  const token = combatant.token?.object;
  if (!token || !token.visible || combatant.sceneId !== canvas.scene?.id) return;
  if (combatant.isOwner) token.control({ releaseOthers: true });
  return canvas.animatePan(token.center);
}

/** The combatant a context-menu entry was opened on (the menu passes the chip, as an element or jQuery). */
const menuCombatant = target => combatantOf(target?.[0] ?? target);

/**
 * Foundry's own context menu on the tracker's tokens (right-click). Bound once to the tracker element and delegated
 * to the chips, so it keeps working through re-renders. Entries only show when they apply; with none (players), no
 * menu opens.
 */
function createContextMenu(root) {
  const ContextMenu = foundry.applications?.ux?.ContextMenu?.implementation
    ?? foundry.applications?.ux?.ContextMenu ?? globalThis.ContextMenu;
  if (!ContextMenu) return;
  const entries = [{
    name: "DXIT.Menu.GoToTurn",
    icon: '<i class="fa-solid fa-forward"></i>',
    condition: target => {
      const combat = trackedCombat();
      const combatant = menuCombatant(target);
      return game.user.isGM && !!combat?.started && !!combatant && combatant.id !== combat.combatant?.id;
    },
    callback: target => goToTurn(menuCombatant(target))
  }];
  new ContextMenu(root, ".dxit-chip", entries, { jQuery: false, fixed: true });
}

/**
 * Foundry's context menu has no stacking order of its own, and the tracker sits above the interface, so the menu
 * would open behind it. Lift it above the tracker once it is on the page (it renders a moment after the click).
 */
function liftContextMenu(tries = 20) {
  const menu = document.getElementById("context-menu");
  if (menu) {
    menu.style.zIndex = "1000";
    return;
  }
  if (tries > 0) setTimeout(() => liftContextMenu(tries - 1), 16);
}

/** GM: make it the combatant's turn, in the current round. Never skipped, even if the combatant is dead. */
function goToTurn(combatant) {
  const combat = trackedCombat();
  if (!game.user.isGM || !combat?.started || !combatant) return;
  const turn = combat.turns.findIndex(c => c.id === combatant.id);
  if (turn < 0 || turn === combat.turn) return;
  return combat.update({ turn }, { [MODULE_ID]: { [JUMP_OPTION]: true } });
}

function onDoubleClick(event) {
  if (event.target.closest(".dxit-grip")) return game.settings.set(MODULE_ID, "position", null);
  const combatant = combatantOf(event.target);
  const actor = combatant?.actor;
  if (actor?.testUserPermission(game.user, "OBSERVER")) actor.sheet.render(true);
}

async function onAction(event, action) {
  event.preventDefault();
  const combat = trackedCombat();
  switch (action) {
    case "expand":
      expanded = !expanded;
      return refresh();
    case "previous":
      if (game.user.isGM) return combat?.previousTurn();
      return;
    case "next":
      if (game.user.isGM) return combat?.nextTurn();
      return;
    case "endTurn":
      if (combat?.started && combat.combatant?.isOwner) return combat.nextTurn();
      return;
    case "start":
      if (game.user.isGM) return combat?.startCombat();
      return;
    case "rollNPCs":
      // Core's own: rolls every NPC combatant without initiative in one go.
      if (game.user.isGM) return combat?.rollNPC();
      return;
    case "popout":
      if (game.user.isGM) return ui.combat?.renderPopout?.();
  }
}

/**
 * Dragging the grip moves the tracker; it stays anchored on the grip. Near the middle of the screen it snaps to the
 * centre lines (shown as guides). Dropping only saves the position: nothing re-renders, so nothing jumps.
 * Double-clicking the grip puts it back.
 */
function onGripDown(event) {
  const grip = event.target.closest(".dxit-grip");
  if (!grip || event.button !== 0) return;
  event.preventDefault();
  const rect = element.getBoundingClientRect();
  const start = { x: event.clientX, y: event.clientY };
  const base = { x: Math.round(rect.left), y: Math.round(rect.top) };
  let current = { ...base, centerX: false, centerY: false };
  let moved = false;
  dragging = true;
  const lines = guides();
  const move = e => {
    const size = element.getBoundingClientRect();
    const free = { x: base.x + e.clientX - start.x, y: base.y + e.clientY - start.y, width: size.width, height: size.height };
    const centre = centreLines();
    lines.v.style.left = `${centre.x}px`;
    lines.h.style.top = `${centre.y}px`;
    const snapped = snapToCentre(free, viewport(), 16, centre);
    const anchor = clampAnchor(snapped, viewport(), GRIP);
    current = { x: anchor.x, y: anchor.y, centerX: snapped.centerX, centerY: snapped.centerY };
    moved ||= current.x !== base.x || current.y !== base.y;
    lines.v.classList.toggle("dxit-guide--on", snapped.centerX);
    lines.h.classList.toggle("dxit-guide--on", snapped.centerY);
    moveTo(current);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    dragging = false;
    removeGuides();
    element?.classList.remove("dxit--dragging");
    if (moved) game.settings.set(MODULE_ID, "position", current);
  };
  element.classList.add("dxit--dragging");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
