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
