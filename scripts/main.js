/**
 * Dxcufgb's Initiative Tracker – entry point.
 *
 * A compact initiative order over the map (a ribbon or edge rail with every visible combatant's token, or a now /
 * next pill) and optional turn-order numbers on the tokens. Look and feel are client settings, so every player sets
 * it up their own way. Follows the combat the core tracker shows (game.combat).
 *
 * API: game.modules.get("dxcufgbs-initiative-tracker").api
 *   refresh()                    re-render the tracker and the token badges
 *   toggle(force?)               show/hide the tracker for this user; returns the new state (Promise<boolean>)
 *   getOrder(combat?)            [{combatantId, tokenId, sceneId, name, initiative, position, active, defeated}]
 *                                for the combatants this user can see, in initiative order (position is 1-based;
 *                                initiative is null for players). Players see allies from the start and the others
 *                                once their turn has come up in round 1; once revealed, always. Combatants hidden
 *                                in the combat tracker (eye icon) are left out; a token hidden on the map isn't.
 *   resetLook()                  put this user's look settings back to the defaults (Promise)
 *   LOOK_DEFAULTS                the default look settings (frozen object)
 *
 * Hook: Hooks.on("dxcufgbsInitiativeTrackerRender", (element, combat, context) => …) after every render of the
 * tracker on this client; `element` is the tracker's HTMLElement.
 */
import { MODULE_ID } from "./util.js";
import { registerSettings, resetLook, LOOK_DEFAULTS } from "./settings.js";
import { refresh, toggle, place, markHovered, trackedCombat, visibleCombatants, forgetRevealed } from "./tracker.js";
import { refreshBadges, clearBadges } from "./badges.js";
import { orderNumbers } from "./order.js";
import { checkEncounter, primeEncounter, forgetEncounter, skipDeadTurn } from "./encounter.js";

function refreshAll() {
  refresh();
  refreshBadges();
}

function getOrder(combat = trackedCombat()) {
  const turns = visibleCombatants(combat);
  const numbers = orderNumbers(turns);
  const currentId = combat?.started ? combat.combatant?.id : null;
  return turns.map(c => ({
    combatantId: c.id,
    tokenId: c.tokenId,
    sceneId: c.sceneId,
    name: c.name,
    initiative: game.user.isGM ? c.initiative : null,
    position: numbers.get(c.id),
    active: c.id === currentId,
    defeated: c.isDefeated
  }));
}

Hooks.once("init", () => {
  registerSettings(refresh, refreshBadges, place);

  game.keybindings.register(MODULE_ID, "toggle", {
    name: "DXIT.Keybindings.toggle.Name",
    hint: "DXIT.Keybindings.toggle.Hint",
    editable: [],
    onDown: () => {
      toggle();
      return true;
    }
  });

  game.modules.get(MODULE_ID).api = {
    refresh: refreshAll,
    toggle,
    getOrder,
    resetLook,
    LOOK_DEFAULTS
  };
});

Hooks.once("ready", () => {
  refreshAll();
  primeEncounter();
  window.addEventListener("resize", () => place());
  // Follow the sidebar while it opens or closes (a tracker snapped to the centre line moves with it).
  const sidebar = document.getElementById("ui-right");
  if (sidebar && "ResizeObserver" in window) new ResizeObserver(() => place()).observe(sidebar);
});

Hooks.on("canvasTearDown", clearBadges);
Hooks.on("canvasReady", refreshAll);
Hooks.on("drawToken", () => refreshBadges());
Hooks.on("hoverToken", (token, hovered) => markHovered(token.document, hovered));
Hooks.on("collapseSidebar", () => place());
Hooks.on("renderSceneNavigation", () => place());

for (const hook of [
  "createCombat", "updateCombat", "deleteCombat", "combatStart",
  "createCombatant", "updateCombatant", "deleteCombatant"
]) Hooks.on(hook, refreshAll);

// Images, names, visibility and health of combatants.
Hooks.on("updateToken", (doc, changes) => {
  if (!trackedCombat()?.combatants.some(c => c.tokenId === doc.id)) return;
  refreshAll();
});
Hooks.on("updateActor", actor => {
  if (!trackedCombat()?.combatants.some(c => c.actorId === actor.id || c.actor === actor)) return;
  refresh();
});
// Status effects such as Invisible.
for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, effect => {
    const actor = effect.target ?? effect.parent;
    if (trackedCombat()?.combatants.some(c => c.actor === actor || c.actorId === actor?.id)) refreshAll();
  });
}
// The last hostile falling: defeated, at 0 on its first bar, removed from the fight, or no longer hostile.
for (const hook of ["updateCombatant", "deleteCombatant", "createCombatant", "updateToken", "updateActor",
  "createActiveEffect", "deleteActiveEffect"]) Hooks.on(hook, () => checkEncounter());
Hooks.on("combatStart", combat => primeEncounter(combat));
// A dead combatant's turn came up: the responsible GM moves on (setting "skipDead").
Hooks.on("updateCombat", (combat, changes, options) => {
  if ("turn" in changes || "round" in changes) skipDeadTurn(combat, options);
});
Hooks.on("combatStart", combat => skipDeadTurn(combat));
Hooks.on("deleteCombat", combat => {
  forgetEncounter(combat);
  forgetRevealed(combat);
});

// Player colours (ring colour "player") and who is online.
Hooks.on("updateUser", () => refresh());
