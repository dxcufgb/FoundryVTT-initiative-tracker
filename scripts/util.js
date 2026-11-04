export const MODULE_ID = "dxcufgbs-initiative-tracker";
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;

/** Localize a DXIT.* key, formatting when data is given. */
export function t(key, data) {
  const full = `DXIT.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The one GM client that does world-level work nobody clicked for. */
export function isResponsibleGM() {
  return game.user.isGM && !!game.users.activeGM?.isSelf;
}

/**
 * Unsaved values from the open settings window, so the tracker previews a change before it is saved.
 * Cleared when the settings window closes.
 */
export const preview = new Map();

/** Reads one of this module's settings (the unsaved preview value while the settings window is open). */
export function setting(key) {
  return preview.has(key) ? preview.get(key) : game.settings.get(MODULE_ID, key);
}

/** A finite number clamped to [min, max], or `fallback`. */
export function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
