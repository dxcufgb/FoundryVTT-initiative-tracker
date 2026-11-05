/**
 * Turn-order numbers on the tokens themselves: a small numbered disc in the token's top-left corner, filled with the
 * accent colour for the token whose turn it is. Per client ("Turn order on tokens" setting).
 *
 * The badge is a child of the Token object, so it follows the token and is hidden with it. Foundry destroys a token's
 * children when it redraws the token, so the badges are re-attached from the drawToken hook.
 */
import { MODULE_ID, setting, clamp } from "./util.js";
import { orderNumbers } from "./order.js";
import { trackedCombat, visibleCombatants } from "./tracker.js";
import { crumb, errorName } from "./debug-recorder.js";

const BADGE_NAME = "dxitBadge";
/** tokenId -> badge container */
const badges = new Map();

function makeBadge() {
  const badge = new PIXI.Container();
  badge.name = BADGE_NAME;
  badge.eventMode = "none";
  badge.disc = badge.addChild(new PIXI.Graphics());
  const PreciseText = foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;
  badge.label = badge.addChild(new PreciseText("", new PIXI.TextStyle({
    fontFamily: CONFIG.canvasTextStyle?.fontFamily ?? "Signika",
    fontWeight: "bold",
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 2
  })));
  badge.label.anchor.set(0.5);
  return badge;
}

function drawBadge(badge, { number, active, defeated }) {
  const scale = clamp(setting("badgeScale"), 50, 200, 100) / 100;
  const radius = Math.max(8, (canvas.dimensions?.size ?? 100) * 0.16 * scale);
  const accent = Color.from(String(setting("accent") || "#ff6400"));
  badge.disc.clear()
    .lineStyle(Math.max(1.5, radius * 0.14), active ? 0xffffff : Number(accent), 1)
    .beginFill(active ? Number(accent) : 0x111111, 0.9)
    .drawCircle(0, 0, radius)
    .endFill();
  badge.label.text = String(number);
  badge.label.style.fontSize = Math.round(radius * 1.15);
  badge.position.set(radius * 0.55, radius * 0.55);
  badge.alpha = defeated ? 0.45 : 1;
}

function removeBadge(tokenId) {
  const badge = badges.get(tokenId);
  badges.delete(tokenId);
  if (badge && !badge.destroyed) badge.destroy({ children: true });
}

/** Which tokens on the viewed scene get which number. */
function wantedBadges() {
  const wanted = new Map();
  const combat = trackedCombat();
  if (!setting("tokenBadges") || !combat?.started || !canvas?.ready) return wanted;
  const turns = visibleCombatants(combat);
  const numbers = orderNumbers(turns);
  const currentId = combat.combatant?.id;
  for (const c of turns) {
    if (c.sceneId !== canvas.scene?.id || wanted.has(c.tokenId)) continue;
    const token = canvas.tokens?.get(c.tokenId);
    if (!token) continue;
    wanted.set(c.tokenId, { token, number: numbers.get(c.id), active: c.id === currentId, defeated: c.isDefeated });
  }
  return wanted;
}

function drawAll() {
  try {
    const wanted = wantedBadges();
    for (const id of [...badges.keys()]) if (!wanted.has(id)) removeBadge(id);
    for (const [id, data] of wanted) {
      let badge = badges.get(id);
      if (!badge || badge.destroyed || badge.parent !== data.token) {
        if (badge && !badge.destroyed) badge.destroy({ children: true });
        badge = makeBadge();
        data.token.addChild(badge);
        badges.set(id, badge);
      }
      drawBadge(badge, data);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | token badges failed`, err);
    crumb("error.caught", { area: "badges", error: errorName(err) });
  }
}

/** Redraws every badge, at most a few times a second. */
export const refreshBadges = foundry.utils.debounce(drawAll, 50);

/** The canvas is being torn down: forget the badges (their tokens are destroyed with it). */
export function clearBadges() {
  badges.clear();
}

/** How many badges are drawn (for the Debug Recorder snapshot). */
export function badgeCount() {
  return badges.size;
}
