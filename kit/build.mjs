// Rebuilds lib/kit.ts from kit.css and kit.js. Run: node kit/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const css = readFileSync(here("./kit.css"), "utf8").trim();
const js = readFileSync(here("./kit.js"), "utf8").trim();
const icons = [...js.matchAll(/([a-z]+):'</g)].map((m) => m[1]).join(", ");
// Every class the kit styles, so pages can be stopped from restyling them.
const classes = [...new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))].sort();

writeFileSync(
  here("../lib/kit.ts"),
  `/**
 * The design kit: a small stylesheet and script added to every generated page.
 * The model writes markup against these classes instead of spending its limited
 * output on basic CSS, so pages come out consistent and polished.
 * Generated from kit/kit.css and kit/kit.js by kit/build.mjs. Edit those, not this file.
 */
export const KIT_CSS = ${JSON.stringify(css)};

export const KIT_JS = ${JSON.stringify(js)};

export const KIT_ICONS = ${JSON.stringify(icons)};

export const KIT_CLASSES = ${JSON.stringify(classes)};
`,
);
console.log("wrote lib/kit.ts");
