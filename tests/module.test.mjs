// Consistency checks that need no Foundry: run with `node --test tests/*.test.mjs` (CI "lint").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const list = (dir, ext) => readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true })
  .filter(f => f.endsWith(ext)).map(f => `${dir}/${f.replaceAll("\\", "/")}`);
const manifest = JSON.parse(read("module.json"));
const lang = JSON.parse(read("lang/en.json"));
const lookup = key => key.split(".").reduce((o, k) => o?.[k], lang);
const has = key => typeof lookup(key) === "string";
const SECTIONS = Object.keys(lang.DXIT).join("|");

test("MODULE_ID matches module.json", () => {
  assert.match(read("scripts/util.js"), new RegExp(`MODULE_ID = "${manifest.id}"`));
});

test("every DXIT string used in scripts and templates exists in lang/en.json", () => {
  const missing = [];
  for (const file of [...list("scripts", ".js"), ...list("templates", ".hbs")]) {
    // Keys built in template literals (`DXIT.Settings.${key}.Name`) are checked by the settings test below.
    const src = read(file).replace(/`[^`]*\$\{[^`]*`/g, "``");
    for (const [, key] of src.matchAll(/(DXIT\.[A-Za-z0-9_.]*[A-Za-z0-9_])/g)) if (!has(key)) missing.push(`${file}: ${key}`);
    if (!file.endsWith(".js")) continue;
    // t("Section.Key")
    for (const [, key] of src.matchAll(new RegExp(`["'\`]((?:${SECTIONS})\\.[A-Za-z0-9_.]+)["'\`]`, "g"))) {
      if (!has(`DXIT.${key}`)) missing.push(`${file}: DXIT.${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("every visible setting has a name, a hint and labels for its choices", () => {
  const src = read("scripts/settings.js");
  const missing = [];
  for (const [, key] of src.matchAll(/named\("(\w+)"\)/g)) {
    for (const part of ["Name", "Hint"]) if (!has(`DXIT.Settings.${key}.${part}`)) missing.push(`${key}.${part}`);
  }
  for (const [, key, values] of src.matchAll(/choices\("(\w+)", \[([^\]]*)\]\)/g)) {
    for (const [, value] of values.matchAll(/"(\w+)"/g)) {
      if (!has(`DXIT.Settings.${key}.Choices.${value}`)) missing.push(`${key}.Choices.${value}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("every look default is a registered client setting", () => {
  const src = read("scripts/settings.js");
  const defaults = src.match(/LOOK_DEFAULTS = Object\.freeze\(\{([\s\S]*?)\}\)/)[1];
  for (const [, key] of defaults.matchAll(/^\s*(\w+):/gm)) {
    assert.match(src, new RegExp(`client\\("${key}"`), key);
  }
});

test("every template the scripts load exists", () => {
  const templates = new Set(list("templates", ".hbs"));
  for (const file of list("scripts", ".js")) {
    for (const [, name] of read(file).matchAll(/TEMPLATE_PATH\}\/([\w-]+\.hbs)/g)) {
      assert.ok(templates.has(`templates/${name}`), `${file}: templates/${name}`);
    }
  }
});

test("module.json ships the folders the code needs", () => {
  const include = JSON.parse(read(".github/foundry-module.json")).include;
  for (const dir of ["scripts", "styles", "lang", "templates"]) assert.ok(include.includes(dir), dir);
  assert.deepEqual(manifest.esmodules, ["scripts/main.js"]);
  for (const style of manifest.styles) assert.ok(read(style).length > 0, style);
});

test("the optional Debug Recorder helper is loaded and its breadcrumb keys are area.action", () => {
  assert.match(read("scripts/main.js"), /from "\.\/debug-recorder\.js"/);
  const bad = [];
  for (const file of list("scripts", ".js")) {
    for (const [, key] of read(file).matchAll(/\bcrumb\("([^"]*)"/g)) {
      if (!/^[a-z][A-Za-z]*(\.[a-z][A-Za-z]*)+$/.test(key)) bad.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("Debug Recorder: crumb records only while recording, and error names are a fixed list", async () => {
  const saved = { Hooks: globalThis.Hooks, game: globalThis.game };
  const calls = [];
  let recording = false;
  const rec = {
    register: () => {},
    isRecording: () => recording,
    breadcrumb: (...args) => calls.push(args)
  };
  try {
    globalThis.Hooks = { once: () => {} };
    globalThis.game = { modules: { get: id => (id === "dxcufgbs-debug-recorder" ? { api: rec } : undefined) } };
    const { registerDebugRecorder, crumb, errorName } = await import("../scripts/debug-recorder.js");
    registerDebugRecorder(() => ({}));
    let evaluated = false;
    crumb("test.idle", () => {
      evaluated = true;
      return {};
    });
    assert.equal(calls.length, 0);
    assert.equal(evaluated, false);
    recording = true;
    crumb("test.live", { count: 1 });
    assert.deepEqual(calls, [[manifest.id, "test.live", { count: 1 }]]);
    rec.breadcrumb = () => {
      throw new Error("recorder bug");
    };
    assert.doesNotThrow(() => crumb("test.broken"));
    assert.equal(errorName(new TypeError("x")), "TypeError");
    const custom = new Error("x");
    custom.name = "Scene of the Goblin King";
    assert.equal(errorName(custom), "Error");
    assert.equal(errorName("text"), "Error");
  } finally {
    globalThis.Hooks = saved.Hooks;
    globalThis.game = saved.game;
    globalThis.foundry = saved.foundry;
  }
});

test("Debug Recorder: a failed register() (false or a throw) leaves the recorder unset and is retried", async t => {
  t.mock.method(console, "warn", () => {});
  const saved = { Hooks: globalThis.Hooks, game: globalThis.game };
  const hooks = {};
  const attempts = [];
  const calls = [];
  let outcome = false;
  const rec = {
    register: id => {
      attempts.push(id);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    isRecording: () => true,
    breadcrumb: (...args) => calls.push(args)
  };
  const fire = (name, ...args) => (hooks[name] ?? []).forEach(fn => fn(...args));
  try {
    globalThis.Hooks = { once: (name, fn) => (hooks[name] ??= []).push(fn) };
    globalThis.game = { modules: { get: id => (id === "dxcufgbs-debug-recorder" ? { api: rec } : undefined) } };
    const { registerDebugRecorder, crumb } = await import("../scripts/debug-recorder.js?register-fails");
    registerDebugRecorder(() => ({}));
    crumb("test.unset");
    assert.equal(attempts.length, 1);
    assert.equal(calls.length, 0, "register() returned false: the recorder is not kept");

    outcome = new Error("recorder bug");
    assert.doesNotThrow(() => fire("dxcufgbs-debug-recorder.ready", rec));
    crumb("test.unset");
    assert.equal(attempts.length, 2, "retried on the recorder's ready hook");
    assert.equal(calls.length, 0, "register() threw: the recorder is not kept");

    outcome = true;
    fire("ready");
    assert.equal(attempts.length, 3, "retried on ready");
    crumb("test.live", { count: 1 });
    assert.deepEqual(calls, [[manifest.id, "test.live", { count: 1 }]]);
    registerDebugRecorder(() => ({}));
    assert.equal(attempts.length, 3, "a successful registration is not repeated");
  } finally {
    globalThis.Hooks = saved.Hooks;
    globalThis.game = saved.game;
    globalThis.foundry = saved.foundry;
  }
});

test("an unconscious NPC with HP left is not dead, so its turn isn't skipped", async () => {
  const saved = { Hooks: globalThis.Hooks, game: globalThis.game, foundry: globalThis.foundry };
  try {
    globalThis.Hooks = { once: () => {}, on: () => {} };
    globalThis.foundry = { utils: { debounce: fn => fn } };
    globalThis.game = { modules: { get: () => undefined } };
    const { isDead, isDown } = await import("../scripts/encounter.js?is-dead");
    const npc = (statuses, value, { owned = false, defeated = false } = {}) => ({
      isDefeated: defeated,
      actor: { hasPlayerOwner: owned, statuses: new Set(statuses) },
      token: { getBarAttribute: () => ({ value, max: 10 }) }
    });
    assert.equal(isDead(npc(["unconscious"], 5)), false);
    assert.equal(isDown(npc(["unconscious"], 5)), true);
    assert.equal(isDead(npc(["unconscious"], 0)), true);
    assert.equal(isDead(npc([], 0)), true);
    assert.equal(isDead(npc(["dead"], 5)), true);
    assert.equal(isDead(npc([], 5, { defeated: true })), true);
    assert.equal(isDead(npc(["unconscious"], 0, { owned: true })), false);
  } finally {
    globalThis.Hooks = saved.Hooks;
    globalThis.game = saved.game;
    globalThis.foundry = saved.foundry;
  }
});
