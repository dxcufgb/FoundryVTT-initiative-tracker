/**
 * Hostiles: the counter of hostile combatants still standing, and the question to the GM when the last one falls.
 *
 * A combatant is a hostile when its token's disposition is Hostile. It is still standing unless it is defeated
 * (the combat tracker's skull, or the system's defeated status) or down (its token's first bar, usually HP, at 0, or
 * the Unconscious or Dead status).
 * Players only count the hostiles they can see in the tracker, so the counter never gives away hidden ones.
 *
 * The question runs on the responsible GM's client only: when a started combat that had hostiles standing has none
 * left, it asks once whether to end the encounter. If a hostile gets back up and falls again, it asks again.
 */
import { MODULE_ID, t, isResponsibleGM } from "./util.js";
import { shouldAskToEnd, movedBackwards } from "./order.js";
import { crumb, errorName } from "./debug-recorder.js";

/** Is the combatant a hostile? */
export function isHostile(combatant) {
  return combatant.token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE;
}

/** Status effects that put a combatant down without it being marked defeated (dnd5e and most systems). */
const DOWN_STATUSES = ["dead", "unconscious"];

/**
 * Is the combatant down but not marked defeated: its token's first bar (usually HP) at 0, or Unconscious / Dead?
 */
export function isDown(combatant) {
  if (combatant.isDefeated) return false;
  const statuses = combatant.actor?.statuses;
  if (statuses?.has && DOWN_STATUSES.some(id => statuses.has(id))) return true;
  return atZero(combatant);
}

/** Is the combatant's token's first bar (usually HP) at 0? */
function atZero(combatant) {
  const bar = combatant.token?.getBarAttribute?.("bar1");
  const value = Number(bar?.value);
  const max = Number(bar?.max);
  return Number.isFinite(value) && Number.isFinite(max) && max > 0 && value <= 0;
}

/**
 * Has the combatant died: marked defeated, the Dead status, or an NPC (no player owner) at 0 on its first bar. A
 * player character at 0 is dying, not dead (death saves), so it doesn't count until it is marked defeated or dead.
 * Unconscious alone is not dead: an NPC knocked out (or asleep) with HP left keeps its turn.
 */
export function isDead(combatant) {
  if (combatant.isDefeated) return true;
  if (combatant.actor?.statuses?.has?.("dead")) return true;
  return !combatant.actor?.hasPlayerOwner && atZero(combatant);
}

/** Is the combatant still standing: not defeated and not down? */
export function isStanding(combatant) {
  if (combatant.isDefeated || isDown(combatant)) return false;
  return true;
}

/**
 * How many hostiles are still standing among `combatants` (pass the ones the user can see for a player's count).
 * @returns {{standing: number, total: number}}
 */
export function countHostiles(combatants) {
  let standing = 0;
  let total = 0;
  for (const c of combatants ?? []) {
    if (!isHostile(c)) continue;
    total++;
    if (isStanding(c)) standing++;
  }
  return { standing, total };
}

/** combat id -> the number of standing hostiles last time we looked (responsible GM only). */
const lastStanding = new Map();
let asking = false;

/** Called after anything that can change who is standing. Asks the GM to end the encounter when the last hostile falls. */
export const checkEncounter = foundry.utils.debounce(() => {
  check().catch(err => {
    console.error(`${MODULE_ID} | end-of-encounter check failed`, err);
    crumb("error.caught", { area: "encounterCheck", error: errorName(err) });
  });
}, 400);

async function check() {
  if (!isResponsibleGM() || !game.settings.get(MODULE_ID, "askEndEncounter")) return;
  const combat = game.combat;
  if (!combat?.started) return;
  const { standing, total } = countHostiles(combat.combatants);
  const before = lastStanding.get(combat.id);
  lastStanding.set(combat.id, standing);
  if (!shouldAskToEnd(before, standing, total) || asking) return;
  crumb("encounter.ask", { round: combat.round, turn: combat.turn, hostiles: total });
  asking = true;
  try {
    const DialogV2 = foundry.applications.api.DialogV2;
    const end = await DialogV2.confirm({
      window: { title: t("Encounter.Title"), icon: "fa-solid fa-flag-checkered" },
      content: `<p>${t("Encounter.Question")}</p>`,
      yes: { label: t("Encounter.End"), icon: "fa-solid fa-flag-checkered" },
      no: { label: t("Encounter.KeepGoing"), icon: "fa-solid fa-shield-halved", default: true },
      rejectClose: false
    });
    // Still the same combat, still nobody standing? Then end it (deleting the combat is what core's End Combat does).
    const still = game.combats.has(combat.id) && countHostiles(combat.combatants).standing === 0;
    crumb("encounter.answer", { end: !!end, ended: !!end && still });
    if (end && still) await combat.delete();
  } finally {
    asking = false;
  }
}

/** Remember the starting count when a combat starts or is viewed, so only a real "last one falls" asks. */
export function primeEncounter(combat = game.combat) {
  if (combat) lastStanding.set(combat.id, countHostiles(combat.combatants).standing);
}

export function forgetEncounter(combat) {
  if (combat) lastStanding.delete(combat.id);
}

let skipping = false;
/** combat id -> {round, turn} at the last update, to tell a step back from a step forward. */
const lastPosition = new Map();

/** Option on a turn change made by the tracker's right-click jump: never skipped. */
export const JUMP_OPTION = "jumpToTurn";

/**
 * When the turn moves forward onto a dead combatant (isDead: defeated, Dead, or an NPC at 0), the responsible GM
 * moves on, past every dead combatant in a row, to the next one that isn't (world setting "skipDead"). Each step is
 * a normal next turn, so turn-based effects and other modules see every turn. Not skipped: a step back onto a dead
 * combatant (the GM wants to be there), a jump from the tracker's right-click, and player characters at 0 (they make
 * death saves). Stops if everyone left is dead, so it can't loop forever.
 * @param {Combat} combat
 * @param {object} [options]  the update's options (core passes `direction`: 1 next, -1 previous)
 */
export function skipDeadTurn(combat, options = {}) {
  if (!combat) return;
  const before = lastPosition.get(combat.id);
  const now = { round: combat.round, turn: combat.turn };
  lastPosition.set(combat.id, now);
  if (!isResponsibleGM() || !game.settings.get(MODULE_ID, "skipDead") || skipping) return;
  if (options?.[MODULE_ID]?.[JUMP_OPTION]) return;
  if (movedBackwards(before, now, options?.direction)) return;
  if (!combat.started || !combat.combatant || !isDead(combat.combatant)) return;
  if (!combat.combatants.some(c => !isDead(c))) return;
  crumb("skipDead.start", { round: combat.round, turn: combat.turn });
  skipping = true;
  // After the update that brought the turn here has finished.
  setTimeout(async () => {
    try {
      let steps = combat.turns.length;
      let skipped = 0;
      while (steps-- > 0 && game.combats.has(combat.id) && combat.combatant && isDead(combat.combatant)
        && combat.combatants.some(c => !isDead(c))) {
        await combat.nextTurn();
        skipped++;
      }
      crumb("skipDead.done", { skipped, round: combat.round, turn: combat.turn });
    } catch (err) {
      console.error(`${MODULE_ID} | skipping a dead combatant's turn failed`, err);
      crumb("error.caught", { area: "skipDead", error: errorName(err) });
    } finally {
      skipping = false;
    }
  }, 0);
}

/** The encounter state for the Debug Recorder snapshot: counts and flags only. */
export function encounterDebugState() {
  return { trackedCombats: lastStanding.size, asking, skipping, positionsTracked: lastPosition.size };
}
