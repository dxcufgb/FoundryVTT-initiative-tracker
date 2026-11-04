/**
 * Settings. Look and feel are client settings, so every player sets up the tracker their own way; what players are
 * allowed to see is a world setting (only shown to users who may change world settings).
 *
 * While the settings window is open, every change to this module's fields is previewed on the tracker right away
 * (through util.preview), before Save. Closing the window drops the unsaved values again.
 */
import { MODULE_ID, preview } from "./util.js";

/** Defaults of the client look settings, also used by resetLook() and the API. */
export const LOOK_DEFAULTS = Object.freeze({
  enabled: false,
  layout: "ribbon",
  orientation: "horizontal",
  placement: "start",
  centreFollowsSidebar: true,
  size: 36,
  sizing: "equal",
  maxVisible: 0,
  arcReach: 2,
  arcWidth: 100,
  arcFade: 60,
  arcFlip: false,
  shape: "circle",
  theme: "dark",
  opacity: 70,
  accent: "#ff6400",
  ringColor: "disposition",
  showRound: true,
  showHostiles: true,
  showInitiative: false,
  showHealth: true,
  showControls: true,
  tokenBadges: true,
  deathFlames: true,
  badgeScale: 100
});

/** Settings that only matter for one kind of tracker; the settings window hides the others. */
const ARC_ONLY = ["arcReach", "arcWidth", "arcFade", "arcFlip"];
const LINEAR_ONLY = ["placement", "maxVisible"];

/** Settings that change the token badges rather than (or as well as) the tracker. */
const BADGE_KEYS = new Set(["accent", "tokenBadges", "badgeScale"]);

let onLook = () => {};
let onBadges = () => {};
let onPlace = () => {};

/**
 * @param {() => void} onLookChange  re-renders the tracker
 * @param {() => void} onBadgeChange redraws the token badges
 * @param {() => void} onPositionChange moves the tracker to its saved position (no re-render)
 */
export function registerSettings(onLookChange, onBadgeChange, onPositionChange = onLookChange) {
  onLook = onLookChange;
  onBadges = onBadgeChange;
  onPlace = onPositionChange;
  const changed = key => () => {
    preview.delete(key);
    onLook();
    if (BADGE_KEYS.has(key)) onBadges();
  };
  const client = (key, data) => game.settings.register(MODULE_ID, key, {
    scope: "client",
    config: true,
    default: LOOK_DEFAULTS[key],
    onChange: changed(key),
    ...data
  });
  const choices = (key, values) => Object.fromEntries(values.map(v => [v, `DXIT.Settings.${key}.Choices.${v}`]));
  const named = key => ({ name: `DXIT.Settings.${key}.Name`, hint: `DXIT.Settings.${key}.Hint` });

  client("enabled", { ...named("enabled"), type: Boolean });
  client("layout", { ...named("layout"), type: String, choices: choices("layout", ["ribbon", "pill", "arc"]) });
  client("orientation", { ...named("orientation"), type: String, choices: choices("orientation", ["horizontal", "vertical"]) });
  client("centreFollowsSidebar", { ...named("centreFollowsSidebar"), type: Boolean });
  client("placement", { ...named("placement"), type: String, choices: choices("placement", ["start", "center", "end", "fixed"]) });
  client("size", { ...named("size"), type: Number, range: { min: 24, max: 96, step: 4 } });
  client("sizing", { ...named("sizing"), type: String, choices: choices("sizing", ["equal", "taper"]) });
  client("maxVisible", { ...named("maxVisible"), type: Number, range: { min: 0, max: 30, step: 1 } });
  client("arcReach", { ...named("arcReach"), type: Number, range: { min: 1, max: 3, step: 1 } });
  client("arcWidth", { ...named("arcWidth"), type: Number, range: { min: 100, max: 250, step: 10 } });
  client("arcFade", { ...named("arcFade"), type: Number, range: { min: 0, max: 90, step: 10 } });
  client("arcFlip", { ...named("arcFlip"), type: Boolean });
  client("shape", { ...named("shape"), type: String, choices: choices("shape", ["circle", "rounded", "square"]) });
  client("theme", { ...named("theme"), type: String, choices: choices("theme", ["dark", "light", "none"]) });
  client("opacity", { ...named("opacity"), type: Number, range: { min: 0, max: 100, step: 5 } });
  client("accent", {
    ...named("accent"),
    type: new foundry.data.fields.ColorField({ nullable: false, initial: LOOK_DEFAULTS.accent })
  });
  client("ringColor", { ...named("ringColor"), type: String, choices: choices("ringColor", ["disposition", "player", "none"]) });
  client("showRound", { ...named("showRound"), type: Boolean });
  client("showHostiles", { ...named("showHostiles"), type: Boolean });
  client("showInitiative", { ...named("showInitiative"), type: Boolean });
  client("showHealth", { ...named("showHealth"), type: Boolean });
  client("showControls", { ...named("showControls"), type: Boolean });
  client("tokenBadges", { ...named("tokenBadges"), type: Boolean });
  client("deathFlames", { ...named("deathFlames"), type: Boolean });
  client("badgeScale", { ...named("badgeScale"), type: Number, range: { min: 50, max: 200, step: 10 } });

  // Where the player dropped the tracker: {x, y} = the screen position of its top-left corner (the grip), plus
  // centerX / centerY when it was snapped to the middle of the screen (it then stays centred as it grows or
  // shrinks). null = the default spot. Reset by double-clicking the grip.
  game.settings.register(MODULE_ID, "position", {
    scope: "client",
    config: false,
    type: Object,
    default: null,
    onChange: () => onPlace()
  });

  game.settings.register(MODULE_ID, "skipDead", {
    ...named("skipDead"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "askEndEncounter", {
    ...named("askEndEncounter"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "playerHealth", {
    ...named("playerHealth"),
    scope: "world",
    config: true,
    type: String,
    default: "own",
    choices: choices("playerHealth", ["own", "friendly", "all"]),
    onChange: () => onLook()
  });

  Hooks.on("renderSettingsConfig", bindPreview);
  Hooks.on("closeSettingsConfig", endPreview);
}

/** The value a settings-window field holds, cast to the setting's type. */
function fieldValue(field, config) {
  if (config.type === Boolean) return !!field.checked;
  const raw = field.value;
  if (config.type === Number) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : config.default;
  }
  return raw === undefined || raw === null ? config.default : String(raw);
}

/** Previews this module's fields in the settings window on the tracker as soon as they change. */
function bindPreview(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  if (!root) return;
  showLayoutSettings(root);
  if (root.dataset.dxitPreview) return;
  root.dataset.dxitPreview = "1";
  const prefix = `${MODULE_ID}.`;
  const update = event => {
    const field = event.target?.closest?.(`[name^="${prefix}"]`);
    if (!field) return;
    const key = field.name.slice(prefix.length);
    const config = game.settings.settings.get(field.name);
    if (!config || config.scope !== "client" || !(key in LOOK_DEFAULTS)) return;
    preview.set(key, fieldValue(field, config));
    if (key === "layout") showLayoutSettings(root);
    onLook();
    if (BADGE_KEYS.has(key)) onBadges();
  };
  root.addEventListener("input", update);
  root.addEventListener("change", update);
}

/**
 * Shows only the settings for the layout picked in the settings window: the semicircle's own settings for the
 * semicircle, and the ribbon / now-next settings for those.
 */
function showLayoutSettings(root) {
  const layoutField = root.querySelector(`[name="${MODULE_ID}.layout"]`);
  if (!layoutField) return;
  const arc = layoutField.value === "arc";
  const toggle = (keys, show) => {
    for (const key of keys) {
      const group = root.querySelector(`[name="${MODULE_ID}.${key}"]`)?.closest(".form-group");
      if (group) group.style.display = show ? "" : "none";
    }
  };
  toggle(ARC_ONLY, arc);
  toggle(LINEAR_ONLY, !arc);
}

function endPreview() {
  if (!preview.size) return;
  preview.clear();
  onLook();
  onBadges();
}

/** Puts every client look setting back to its default (the player's own settings only). */
export async function resetLook() {
  for (const [key, value] of Object.entries(LOOK_DEFAULTS)) {
    await game.settings.set(MODULE_ID, key, value);
  }
  await game.settings.set(MODULE_ID, "position", null);
}
